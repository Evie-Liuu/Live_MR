/**
 * license.ts
 *
 * 交付給外部測試的版本會在打包時寫入授權資訊（scripts/build-launcher.mjs --tester --expires）：
 * 測試者名稱、到期日與版本識別碼。一般開發與內部打包沒有這些資訊，不受限制。
 *
 * 到期日以當地時間當天結束為準。另外記錄最後一次執行的時間，
 * 電腦時鐘被調回去超過一天時也視為不可使用（擋住改時間繞過到期日）。
 */
import fs from 'node:fs'
import path from 'node:path'

export interface BuildLicense {
  tester: string
  /** YYYY-MM-DD，當天結束前可用 */
  expires: string
  id: string
}

/** esbuild define 注入的 JSON 字串；開發模式（tsx）沒有這個全域變數 */
declare const __LIVEMR_LICENSE__: string | undefined

export function readBuildLicense(raw: string | undefined = typeof __LIVEMR_LICENSE__ !== 'undefined' ? __LIVEMR_LICENSE__ : undefined): BuildLicense | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<BuildLicense>
    return v.tester && v.expires ? { tester: v.tester, expires: v.expires, id: v.id ?? '' } : null
  } catch {
    return null
  }
}

/** 到期時刻（當地時間當天 23:59:59.999）；格式錯誤回傳 NaN */
export function expiryTime(expires: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) return NaN
  // 不存在的日期（例如 11-31）Date 會進位成下個月，視為格式錯誤
  const [y, m, d] = expires.split('-').map(Number)
  const end = new Date(y, m - 1, d, 23, 59, 59, 999)
  return end.getMonth() === m - 1 && end.getDate() === d ? end.getTime() : NaN
}

export function isExpired(license: BuildLicense | null, now = Date.now()): boolean {
  if (!license) return false
  const t = expiryTime(license.expires)
  return Number.isNaN(t) || now > t
}

/** 允許的時鐘誤差（時區、校時）；比上次執行早超過這麼多就當作時鐘被調回去 */
const CLOCK_TOLERANCE_MS = 24 * 60 * 60 * 1000
const CLOCK_FILE = '.license-clock'

/**
 * 檢查並更新「最後一次執行時間」。時鐘比紀錄早超過一天回傳 false。
 * 紀錄檔讀寫失敗不擋（例如唯讀資料夾），只靠到期日把關。
 */
export function checkClock(dataDir: string, now = Date.now()): boolean {
  const file = path.join(dataDir, CLOCK_FILE)
  let last = 0
  try { last = Number(fs.readFileSync(file, 'utf8')) || 0 } catch { /* 第一次執行 */ }
  if (last && now < last - CLOCK_TOLERANCE_MS) return false
  try {
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(file, String(Math.max(last, now)))
  } catch { /* 寫不進去就算了 */ }
  return true
}
