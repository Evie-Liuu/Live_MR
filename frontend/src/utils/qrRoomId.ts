/**
 * 房號工具：房號為 6 位數字（例如 482913），學生可用數字鍵盤輸入，也可掃 QR / 開加入連結。
 */

/** 正規化輸入：去掉前後空白；全為數字（可含空白、-）時去掉分隔符號，例如「482 913」→「482913」 */
export function normalizeRoomId(input: string): string {
  const trimmed = input.trim();
  return /^[\d\s-]+$/.test(trimmed) ? trimmed.replace(/[\s-]/g, '') : trimmed;
}

/** 顯示用：6 位數房號分成兩段（「482 913」）方便唸給學生聽；其他格式（舊版 UUID）原樣顯示 */
export function formatRoomId(roomId: string): string {
  return /^\d{6}$/.test(roomId) ? `${roomId.slice(0, 3)} ${roomId.slice(3)}` : roomId;
}

/**
 * 從掃描到的 QR 內容抽出房間 ID。
 * 先嘗試當作網址解析出 `roomId` 查詢參數（對應 HostLobby/ShareScreen 產生的加入連結）；
 * 不是合法網址時，把整段文字當作房號本身（相容「QR 裡直接放房號」的情況）。
 * 是合法網址卻沒有 roomId 參數，或內容整個是空白，視為無法辨識，回傳 null。
 */
export function extractRoomId(scannedText: string): string | null {
  const trimmed = scannedText.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    const roomId = url.searchParams.get('roomId');
    return roomId ? normalizeRoomId(roomId) : null;
  } catch {
    return normalizeRoomId(trimmed);
  }
}
