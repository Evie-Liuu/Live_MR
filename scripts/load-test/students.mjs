// 多位測試帳號同時走完整學生流程的壓力測試。用法見 docs/load-test.md
//
//   node scripts/load-test/students.mjs --base https://192.168.1.20 --count 29
//
// 老師：API 建房、自動核准；另開一頁以老師身分訂閱全部學生，每 5 秒記錄接收狀況
// 學生：各自獨立的瀏覽器 context，用假鏡頭／麥克風走 QR 深連結 → 登入 → 進課堂
// 最後：指定前 N 位發布姿勢資料，量模型就緒時間；並統計畫面上出現麥克風提示的人數
import fs from 'node:fs'
import os from 'node:os'
import { parseArgs } from 'node:util'
import {
  connectHostReceiver, elapsed, freeMb, launchBrowser, log, makeApi, newStudentContext,
  pad2, sleep, startAutoApprove, studentJoin, summarize,
  DEFAULT_CA,
} from './lib.mjs'

const { values: opt } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://127.0.0.1:5173' },
    count: { type: 'string', default: '29' },
    password: { type: 'string', default: 'EngTest123!' },
    ca: { type: 'string', default: DEFAULT_CA },
    prefix: { type: 'string', default: 'stu' },
    hold: { type: 'string', default: '60' },
    pose: { type: 'string', default: '4' },
    'min-free-mb': { type: 'string', default: '700' },
    out: { type: 'string', default: `load-test-${new Date().toISOString().replace(/[:.]/g, '-')}.json` },
  },
})
const BASE = opt.base.replace(/\/$/, '')
const COUNT = +opt.count
const HOLD_S = +opt.hold
const POSE = Math.min(+opt.pose, COUNT)
const MIN_FREE_MB = +opt['min-free-mb']

const api = makeApi(BASE, opt.ca)
const result = { base: BASE, startedAt: new Date().toISOString(), count: COUNT, students: {}, samples: [], errors: [] }
const pages = {}

let lastCpu = cpuTimes()
function cpuTimes() {
  return os.cpus().reduce((a, c) => {
    const t = c.times
    a.idle += t.idle; a.total += t.user + t.nice + t.sys + t.idle + t.irq
    return a
  }, { idle: 0, total: 0 })
}
function cpuPct() {
  const now = cpuTimes()
  const pct = 100 * (1 - (now.idle - lastCpu.idle) / Math.max(1, now.total - lastCpu.total))
  lastCpu = now
  return Math.round(pct)
}

const room = await api('/rooms', { method: 'POST' })
if (room.status !== 200) throw new Error(`建房失敗 ${room.status}（確認 --base 正確、伺服器已啟動）`)
const { roomId, hostToken, livekitToken } = room.body
result.roomId = roomId
log(`房號 ${roomId}，可用記憶體 ${freeMb()} MB`)

const approver = startAutoApprove(api, roomId, hostToken, result.errors)
const browser = await launchBrowser()
const host = await connectHostReceiver(browser, BASE, livekitToken)
log('老師接收端已連線')

let finishing = false
const memGuard = setInterval(() => {
  if (freeMb() < MIN_FREE_MB) {
    log(`可用記憶體剩 ${freeMb()} MB（< ${MIN_FREE_MB}），中止以免拖垮這台電腦`)
    result.aborted = 'low memory'
    void finish(1)
  }
}, 1000)
const sampler = setInterval(async () => {
  try {
    const st = await host.stats()
    const health = await api('/health')
    const s = { t: elapsed(), ...st, apiMs: health.ms, cpuPct: cpuPct(), freeMb: freeMb() }
    result.samples.push(s)
    log(`老師收到 ${st.participants} 人／影像 ${st.videoTracks}／聲音 ${st.audioTracks}，${st.kbps ?? '-'} kbps，掉包 ${st.lossPct}%，fps ${st.avgFps ?? '-'}｜API ${health.ms}ms｜CPU ${s.cpuPct}%｜可用 ${s.freeMb} MB`)
  } catch (err) { if (!finishing) result.errors.push('sample: ' + err.message) }
}, 5000)

async function runStudent(i) {
  const username = `${opt.prefix}${pad2(i)}`
  const s = result.students[username] = {}
  try {
    const ctx = await newStudentContext(browser)
    const page = pages[username] = await ctx.newPage()
    page.on('pageerror', e => result.errors.push(`${username} pageerror: ${e.message}`))
    page.on('console', m => {
      const text = m.text()
      if (m.type() === 'error') (s.consoleErrors ??= []).push(text.slice(0, 200))
      const ready = text.match(/\[PoseDetection\] (\w+) model ready in (\d+) ms/)
      if (ready) { s.poseReadyAt = Date.now(); s.poseModel = ready[1]; s.poseInitMs = +ready[2] }
      if (text.includes('[PoseDetection] Failed')) s.poseFailed = text.slice(0, 200)
    })
    Object.assign(s, await studentJoin(page, BASE, roomId, username, opt.password))
    s.name = await page.locator('.user-initials-circle').innerText().catch(() => null)
    s.ok = true
  } catch (err) {
    s.ok = false
    s.error = err.message.split('\n')[0]
    if (!finishing) log(`✗ ${username}：${s.error}`)
  }
}

log(`同時啟動 ${COUNT} 位學生…`)
const joinStart = Date.now()
await Promise.all(Array.from({ length: COUNT }, (_, k) => runStudent(k + 1)))
result.allJoinedMs = Date.now() - joinStart
const okCount = Object.values(result.students).filter(s => s.ok).length
log(`連線完成 ${okCount}/${COUNT}，耗時 ${(result.allJoinedMs / 1000).toFixed(1)}s`)

log(`維持 ${HOLD_S}s…`)
await sleep(HOLD_S * 1000)

result.micAlerts = []
for (const [u, page] of Object.entries(pages)) {
  if (result.students[u].ok && await page.locator('.ss-mic-alert').isVisible().catch(() => false)) result.micAlerts.push(u)
}
log(`畫面出現麥克風提示：${result.micAlerts.length} 人 ${result.micAlerts.join(' ')}`)

if (POSE > 0) {
  // 學生在 LiveKit 的 identity 是顯示名稱（測試帳號 = S01…）
  const ids = Array.from({ length: POSE }, (_, k) => `S${pad2(k + 1)}`)
  log(`指定 ${ids.join(', ')} 發布姿勢資料`)
  const poseStart = Date.now()
  await host.setPosePublishers(ids)
  result.pose = {}
  await Promise.all(ids.map(async (id, k) => {
    const username = `${opt.prefix}${pad2(k + 1)}`
    const s = result.students[username]
    if (!s?.ok) return
    try {
      await pages[username].locator('.pose-role-pill.is-active').waitFor({ timeout: 30000 })
      const pillMs = Date.now() - poseStart
      // 假鏡頭畫面裡沒有人，量不到骨架；量模型就緒（usePoseDetection 的 console 計時）
      const deadline = Date.now() + 60000
      while (!s.poseReadyAt && !s.poseFailed && Date.now() < deadline) await sleep(200)
      result.pose[id] = s.poseReadyAt
        ? { pillMs, modelReadyMs: s.poseReadyAt - poseStart, model: s.poseModel }
        : { pillMs, error: s.poseFailed || 'model not ready in 60s' }
    } catch (err) { result.pose[id] = { error: err.message.split('\n')[0] } }
  }))
  log('姿勢：' + JSON.stringify(result.pose))
  await sleep(30000)
}

await finish(0)

async function finish(code) {
  if (finishing) return
  finishing = true
  clearInterval(memGuard)
  clearInterval(sampler)
  approver.stop()
  const students = Object.values(result.students)
  const steady = result.samples.slice(-6)
  const consoleErrors = {}
  for (const s of students) for (const e of s.consoleErrors ?? []) {
    const key = e.slice(0, 100)
    consoleErrors[key] = (consoleErrors[key] || 0) + 1
  }
  result.summary = {
    connected: `${students.filter(s => s.ok).length}/${COUNT}`,
    pageLoadMs: summarize(students.map(s => s.pageLoadMs)),
    loginToConnectedMs: summarize(students.map(s => s.loginToConnectedMs)),
    approveMs: summarize(approver.latencies),
    steady: steady.length ? {
      kbps: summarize(steady.map(s => s.kbps)), lossPct: Math.max(...steady.map(s => s.lossPct)),
      videoTracks: steady.at(-1).videoTracks, audioTracks: steady.at(-1).audioTracks,
    } : null,
    micAlerts: result.micAlerts?.length ?? null,
    consoleErrors,
  }
  fs.writeFileSync(opt.out, JSON.stringify(result, null, 2))
  console.log('\n摘要', JSON.stringify(result.summary, null, 2))
  log(`完整結果：${opt.out}`)
  await browser.close().catch(() => {})
  process.exit(code)
}
