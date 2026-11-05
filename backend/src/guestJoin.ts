/**
 * 免登入加入（展示、測試用）：學生掃 QR 或輸入房號後自己填名稱，仍要老師核准才進得了教室。
 * 只有設定 ENABLE_GUEST_JOIN=1 才啟用。
 *
 * 名稱會直接當 LiveKit identity，所以這裡要處理兩件事：
 *   - 同名的人會互相把連線踢掉 → 路由用 guestNameCandidate 自動編號
 *   - 程式靠 identity 前綴判斷老師與大屏靜態角色 → 不能讓人取這些前綴
 */

export const GUEST_NAME_MAX_LENGTH = 20
/** 同名最多編到幾號；再多大概是有人在亂試 */
export const GUEST_NAME_MAX_TRIES = 99

export function guestJoinEnabled(): boolean {
  return process.env.ENABLE_GUEST_JOIN === '1'
}

/** 這個名稱當 identity 會被誤認成老師或大屏靜態角色 */
export function isReservedName(name: string): boolean {
  const lower = name.trim().toLowerCase()
  return lower.startsWith('host-') || lower.startsWith('__placeholder__')
}

/** 整理訪客輸入的名稱（去控制字元、合併空白）；不能用時回傳 null */
export function normalizeGuestName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!name || [...name].length > GUEST_NAME_MAX_LENGTH || isReservedName(name)) return null
  return name
}

/** 第 n 個同名訪客的名稱：小明、小明 2、小明 3… */
export function guestNameCandidate(base: string, n: number): string {
  return n <= 1 ? base : `${base} ${n}`
}
