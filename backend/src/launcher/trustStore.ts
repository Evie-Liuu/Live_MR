import { execFileSync } from 'node:child_process'

/**
 * 把本機 CA 憑證加入「目前 Windows 使用者」的信任根憑證存放區，讓這台機器上
 * 讀 Windows 憑證存放區的用戶端（Chrome/Edge、多數走 CryptoAPI/Schannel 驗證
 * 的工具）不再判定為未受信任。用 -user（CurrentUser\Root）而非 LocalMachine，
 * 避免每次啟動都跳 UAC 提權視窗；Firefox 走自己的 NSS 信任庫，不受此影響。
 * 每次啟動都會呼叫（certutil -addstore 對同一張憑證是冪等的），失敗僅記錄
 * 警告、不中斷啟動流程——瀏覽器連線本來就有「不安全連線」警告可以繼續使用。
 */
export function trustCaLocally(caCertPath: string): void {
  try {
    execFileSync('certutil', ['-user', '-addstore', '-f', 'ROOT', caCertPath], { stdio: 'ignore' })
  } catch (err) {
    console.warn(
      '提醒：無法自動把本機 CA 加入這台電腦的憑證信任清單，瀏覽器仍會顯示不安全連線警告：',
      (err as Error).message,
    )
  }
}
