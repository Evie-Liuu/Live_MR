// 驗證學生麥克風啟動失敗的自動重試與提示（不需真的弄壞麥克風）
//
//   node scripts/load-test/mic-fail.mjs --base https://192.168.1.20
//
// 情境 1：getUserMedia(audio) 失敗 2 次 → 自動重試應救回，不出現提示
// 情境 2：一直失敗 → 出現 .ss-mic-alert；恢復後按「重試」提示應消失
import { parseArgs } from 'node:util'
import { launchBrowser, log, makeApi, newStudentContext, sleep, startAutoApprove, studentJoin, DEFAULT_CA } from './lib.mjs'

const { values: opt } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://127.0.0.1:5173' },
    password: { type: 'string', default: 'EngTest123!' },
    ca: { type: 'string', default: DEFAULT_CA },
    shot: { type: 'string' },
  },
})
const BASE = opt.base.replace(/\/$/, '')
const api = makeApi(BASE, opt.ca)
const browser = await launchBrowser()
let failed = false

async function scenario(label, failTimes, username) {
  const room = (await api('/rooms', { method: 'POST' })).body
  const approver = startAutoApprove(api, room.roomId, room.hostToken, [])
  const ctx = await newStudentContext(browser)
  await ctx.addInitScript(n => {
    let left = n
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async c => {
      if (c?.audio && left-- > 0) {
        window.__micFails = (window.__micFails || 0) + 1
        throw new DOMException('Could not start audio source', 'NotReadableError')
      }
      return orig(c)
    }
    window.__setMicFails = k => { left = k }
  }, failTimes)
  const page = await ctx.newPage()
  await studentJoin(page, BASE, room.roomId, username, opt.password)
  await sleep(9000) // 自動重試 1 + 2 + 4 秒
  const alert = await page.locator('.ss-mic-alert').isVisible()
  const fails = await page.evaluate(() => window.__micFails || 0)
  const expectAlert = failTimes > 3
  log(`${label}：getUserMedia 失敗 ${fails} 次，提示${alert ? '出現' : '沒出現'} ${alert === expectAlert ? '✓' : '✗'}`)
  if (alert !== expectAlert) failed = true
  if (alert) {
    if (opt.shot) await page.screenshot({ path: opt.shot })
    await page.evaluate(() => window.__setMicFails(0))
    await page.locator('.ss-mic-alert-btn').click()
    const cleared = await page.locator('.ss-mic-alert').waitFor({ state: 'detached', timeout: 10000 }).then(() => true, () => false)
    log(`  按「重試」後提示${cleared ? '消失 ✓' : '仍在 ✗'}`)
    if (!cleared) failed = true
  }
  approver.stop()
  await ctx.close()
}

await scenario('失敗 2 次', 2, 'stu01')
await scenario('一直失敗', 99, 'stu02')
await browser.close()
process.exit(failed ? 1 : 0)
