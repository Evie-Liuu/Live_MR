// 壓測腳本共用：瀏覽器、API、老師接收端、學生登入流程
import os from 'node:os'
import https from 'node:https'
import tls from 'node:tls'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const LIVEKIT_UMD = path.join(ROOT, 'frontend/node_modules/livekit-client/dist/livekit-client.umd.js')

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean)

const t0 = Date.now()
export const elapsed = () => +((Date.now() - t0) / 1000).toFixed(1)
export const log = (...a) => console.log(String(elapsed()).padStart(6) + 's', ...a)
export const freeMb = () => Math.round(os.freemem() / 1048576)
export const pad2 = n => String(n).padStart(2, '0')
export const sleep = ms => new Promise(r => setTimeout(r, ms))

/** 打包版的自簽 CA（LiveMR.bat 第一次啟動時產生） */
export const DEFAULT_CA = path.join(ROOT, 'dist-launcher/LiveMR/data/certs/ca-cert.pem')

/**
 * 驗證打包版憑證用的 CA：打包版自己的 CA，加上系統憑證庫
 * （防毒軟體做 HTTPS 掃描時會改用它自己的根憑證簽，例如 Avast，系統庫裡才有）
 */
function trustedCas(caPath) {
  const cas = [...tls.rootCertificates]
  if (typeof tls.getCACertificates === 'function') cas.push(...tls.getCACertificates('system'))
  if (fs.existsSync(caPath)) cas.push(fs.readFileSync(caPath, 'utf8'))
  else console.warn(`找不到 ${caPath}，只用系統憑證庫驗證（可用 --ca 指定）`)
  return cas
}

/**
 * 呼叫後端 API。https（打包版）時照常驗證憑證，不關掉 TLS 驗證。
 * 回傳 { status, body, ms }
 */
export function makeApi(base, caPath = DEFAULT_CA) {
  const agent = base.startsWith('https:')
    ? new https.Agent({ ca: trustedCas(caPath), keepAlive: true, maxSockets: 64 })
    : null
  return async function api(p, opts = {}) {
    const start = Date.now()
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
    if (!agent) {
      const res = await fetch(base + '/api' + p, { ...opts, headers })
      const body = await res.json().catch(() => null)
      return { status: res.status, body, ms: Date.now() - start }
    }
    return new Promise((resolve, reject) => {
      const req = https.request(base + '/api' + p, { method: opts.method || 'GET', headers, agent }, res => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', c => { data += c })
        res.on('end', () => {
          let body = null
          try { body = JSON.parse(data) } catch { /* 非 JSON */ }
          resolve({ status: res.statusCode, body, ms: Date.now() - start })
        })
      })
      req.on('error', reject)
      if (opts.body) req.write(opts.body)
      req.end()
    })
  }
}

export async function launchBrowser() {
  const executablePath = CHROME_CANDIDATES.find(p => fs.existsSync(p))
  if (!executablePath) throw new Error('找不到 Chrome／Edge，請用 CHROME_PATH 指定')
  return chromium.launch({
    executablePath,
    headless: true,
    args: [
      '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    ],
  })
}

/**
 * 學生用的獨立 context（各自的 localStorage／登入狀態），允許鏡頭麥克風。
 * ignoreHTTPSErrors 只作用在這個測試用的無頭瀏覽器，連的是自己指定的 --base（打包版自簽憑證）。
 */
export function newStudentContext(browser) {
  return browser.newContext({
    permissions: ['camera', 'microphone'], ignoreHTTPSErrors: true, viewport: { width: 1024, height: 768 },
  })
}

/**
 * 老師接收端：注入 livekit-client UMD，以老師 token 連進房間、訂閱全部學生。
 * 回傳 stats()：人數、影像／聲音軌數、接收 kbps、掉包率、平均 fps。
 */
export async function connectHostReceiver(browser, base, livekitToken) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, bypassCSP: true })
  const page = await ctx.newPage()
  await page.goto(base + '/')
  await page.addScriptTag({ path: LIVEKIT_UMD })
  await page.evaluate(async token => {
    const lk = window.LivekitClient
    const room = new lk.Room({ adaptiveStream: false, dynacast: false })
    await room.connect(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/livekit`, token)
    window.__room = room
    window.__stats = async () => {
      let videoTracks = 0, audioTracks = 0, bytes = 0, lost = 0, recv = 0
      const fps = []
      for (const p of room.remoteParticipants.values()) {
        for (const pub of p.trackPublications.values()) {
          if (!pub.track) continue
          if (pub.kind === 'video') videoTracks++; else audioTracks++
          const report = await pub.track.getRTCStatsReport?.()
          report?.forEach(s => {
            if (s.type !== 'inbound-rtp') return
            bytes += s.bytesReceived || 0
            lost += s.packetsLost || 0
            recv += s.packetsReceived || 0
            if (s.kind === 'video' && s.framesPerSecond) fps.push(s.framesPerSecond)
          })
        }
      }
      const now = performance.now()
      const prev = window.__lastStat
      window.__lastStat = { bytes, t: now }
      return {
        participants: room.remoteParticipants.size, videoTracks, audioTracks,
        kbps: prev ? Math.round(((bytes - prev.bytes) * 8) / (now - prev.t)) : null,
        lossPct: recv + lost ? +(100 * lost / (recv + lost)).toFixed(2) : 0,
        avgFps: fps.length ? +(fps.reduce((a, b) => a + b, 0) / fps.length).toFixed(1) : null,
      }
    }
  }, livekitToken)
  return {
    page,
    stats: () => page.evaluate(() => window.__stats()),
    /** 指定哪些學生發布姿勢資料（同老師端 pose-publishers，每 3 秒重送） */
    setPosePublishers: ids => page.evaluate(list => {
      clearInterval(window.__poseTimer)
      const send = () => window.__room.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify({ type: 'pose-publishers', identities: list })), { reliable: true })
      send()
      window.__poseTimer = setInterval(send, 3000)
    }, ids),
  }
}

/** 老師自動核准：長輪詢加入申請，有就核准（模擬按「全部允許」）。回傳 stop() 與核准紀錄 */
export function startAutoApprove(api, roomId, hostToken, errors) {
  let running = true
  let since = 0
  const approvedAt = {}
  const latencies = []
  const headers = { 'X-Host-Token': hostToken }
  ;(async () => {
    while (running) {
      try {
        const r = await api(`/rooms/${roomId}/events?since=${since}`, { headers })
        if (typeof r.body?.lastEventId === 'number') since = r.body.lastEventId
        await Promise.all((r.body?.events ?? []).filter(e => e.type === 'join-request').map(async e => {
          const a = await api(`/rooms/${roomId}/requests/${e.requestId}/approve`, { method: 'POST', headers })
          approvedAt[e.name] = Date.now()
          latencies.push(a.ms)
          if (a.status !== 200) errors.push(`approve ${e.name}: ${a.status}`)
        }))
      } catch (err) {
        errors.push('events: ' + err.message)
        await sleep(1000)
      }
    }
  })()
  return { approvedAt, latencies, stop: () => { running = false } }
}

/** 學生流程：QR 深連結開頁 → 測試帳號登入 → （等待核准）→ 課堂顯示「已連線」 */
export async function studentJoin(page, base, roomId, username, password) {
  const begin = Date.now()
  await page.goto(`${base}/?roomId=${roomId}`, { timeout: 60000 })
  const user = page.locator('input[autocomplete="username"]')
  await user.waitFor({ timeout: 60000 })
  const pageLoadMs = Date.now() - begin
  await user.fill(username)
  await page.locator('input[placeholder="密碼"]').fill(password)
  const loginAt = Date.now()
  await page.locator('.login-submit-btn').click()
  // 核准很快時等待頁一閃而過，不等它，直接等課堂連線
  await page.locator('.connection-status-pill', { hasText: '已連線' }).waitFor({ timeout: 120000 })
  return { pageLoadMs, loginToConnectedMs: Date.now() - loginAt, totalMs: Date.now() - begin }
}

export function summarize(values) {
  const v = values.filter(x => x != null).sort((a, b) => a - b)
  if (!v.length) return null
  return { min: v[0], p50: v[v.length >> 1], max: v[v.length - 1] }
}
