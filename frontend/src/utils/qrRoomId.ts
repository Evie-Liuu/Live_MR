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
    return roomId ? roomId : null;
  } catch {
    return trimmed;
  }
}
