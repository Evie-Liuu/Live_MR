import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

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

const EXPORT_PUBLIC_ROOTS_SCRIPT = `
$paths = 'Cert:\\LocalMachine\\Root', 'Cert:\\CurrentUser\\Root'
$certs = Get-ChildItem -Path $paths -ErrorAction SilentlyContinue
foreach ($cert in $certs) {
  $b64 = [Convert]::ToBase64String($cert.RawData, [System.Base64FormattingOptions]::InsertLineBreaks)
  Write-Output '-----BEGIN CERTIFICATE-----'
  Write-Output $b64
  Write-Output '-----END CERTIFICATE-----'
}
`

/**
 * 產生一份「Windows 已信任的公網根憑證 + LiveMR 內部 CA」合併後的 PEM bundle，
 * 並用 SSL_CERT_FILE 環境變數指向它，讓走 OpenSSL（而非 CryptoAPI/Schannel）的
 * 工具──例如弱點掃描器、command-line openssl──也能同時信任兩者。
 *
 * 之所以要合併而非只指向內部 CA：SSL_CERT_FILE 是整批取代 OpenSSL 的預設信任
 * 來源，不是疊加，只指向內部 CA 會讓 OpenSSL 反而不再信任 Google/AWS 等公網憑證。
 *
 * 用 setx（User 層級，非 LocalMachine）持久化，跟 trustCaLocally 的 certutil -user
 * 一樣不跳 UAC；同時寫進 process.env 讓本次啟動流程內、及其 spawn 出的子行程立即
 * 可用。每次啟動都重新匯出＋覆寫，冪等，並跟著 Windows Update 更新的公網根憑證走。
 */
export function trustCaForOpenSsl(caCertPath: string, certsDir: string): void {
  const bundlePath = path.join(certsDir, 'system-ca-bundle.pem')
  try {
    const publicRootsPem = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', EXPORT_PUBLIC_ROOTS_SCRIPT],
      { encoding: 'utf8' },
    )
    const caCertPem = fs.readFileSync(caCertPath, 'utf8')
    fs.writeFileSync(bundlePath, `${publicRootsPem}\n${caCertPem}`)

    process.env.SSL_CERT_FILE = bundlePath
    execFileSync('setx', ['SSL_CERT_FILE', bundlePath], { stdio: 'ignore' })
  } catch (err) {
    console.warn(
      '提醒：無法自動設定這台電腦的 OpenSSL 信任清單，走 OpenSSL 的工具可能無法驗證 LiveMR 憑證：',
      (err as Error).message,
    )
  }
}
