import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

// repo 內建、跟 trustStore.ts 放在同一個目錄的公網信任 CA bundle（Mozilla 維護、
// curl.se 發布：https://curl.se/ca/cacert.pem，已確認內含 GTS Root R1、Amazon Root
// CA 1，119 張憑證）。用 import.meta.url 而非 __dirname 定位，這樣不管是 tsx/vitest
// 直接跑原始碼、還是 esbuild 打包成單一 bundle 檔案，算出來的都是「這個模組自己
// 所在的目錄」，跟 scripts/build-launcher.mjs 把 .pem 複製進 app/（打包後 standalone
// bundle 所在目錄）的位置對得上。
const DEFAULT_PUBLIC_CA_BUNDLE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'public-ca-bundle.pem',
)

// 低於這個張數視為讀取/打包異常（repo 內建的 public-ca-bundle.pem 目前有 119 張，
// 正常情況不會腰斬）。
const MIN_EXPECTED_PUBLIC_CA_COUNT = 50

/**
 * 產生一份「repo 內建公網信任 CA bundle（backend/src/launcher/public-ca-bundle.pem）
 * + LiveMR 內部 CA」合併後的 PEM，並透過 SSL_CERT_FILE 環境變數（使用者層級，
 * setx）指向它，讓走 OpenSSL（而非 CryptoAPI/Schannel）驗證憑證鏈的工具──例如
 * 弱點掃描器、command-line openssl──也能同時信任內部 CA 與一般公網憑證
 * （如 Google、AWS）。
 *
 * 內建 bundle 而非即時匯出 Windows 憑證存放區：Windows 的 Root store 是「按需
 * 下載」，並非公開信任根憑證的完整清單（實測本機 LocalMachine\Root ∪
 * CurrentUser\Root 缺少 GTS Root R1、Amazon Root CA 1），拿它當公網信任來源
 * 反而會縮窄 OpenSSL 能驗證的範圍，違背「同時信任內部 CA 與公網憑證」的目標。
 * 改用 repo 內建的靜態 CA bundle（Mozilla/curl.se 發布），日後要更新只需重新
 * 下載覆蓋該檔案，不需要改程式邏輯。
 *
 * 寫出前會先驗證 bundle 內容（數 -----BEGIN CERTIFICATE----- 張數，過少視為
 * 讀取或打包異常，直接放棄，不寫出不完整的信任清單），並偵測 SSL_CERT_FILE
 * 是否已被其他工具或使用者設成別的路徑，若是則不覆蓋、直接跳過。合併結果
 * 先寫到 .tmp 再 rename 成最終檔名，做原子寫入，避免其他行程讀到寫一半的檔案。
 *
 * 注意：`process.env.SSL_CERT_FILE = bundlePath` 只是設定「這個 Node process
 * 自己」的環境變數副本——Node 本身並不會讀取 SSL_CERT_FILE（除非用
 * `--use-openssl-ca` 啟動這個 process），走 Go 的 livekit-server.exe 在 Windows
 * 上也不吃這個變數，所以這行對「這次啟動流程本身」沒有實質效果，純粹是保留
 * 慣例／供未來若有子行程真的讀這個變數時使用。真正會影響到其他程式的是
 * setx 寫入使用者層級登錄檔之後、下一個新開的終端機視窗。若要解除設定：
 * `setx SSL_CERT_FILE ""` 或手動刪除 `HKCU\Environment` 底下的 `SSL_CERT_FILE`。
 *
 * setx 只在「目前 SSL_CERT_FILE 還沒指向這次要設定的 bundlePath」時才呼叫，
 * 避免每次啟動都重寫登錄檔；bundle 檔內容本身仍每次啟動都重新合併覆寫，冪等。
 */
export function trustCaForOpenSsl(
  caCertPath: string,
  certsDir: string,
  publicCaBundlePath: string = DEFAULT_PUBLIC_CA_BUNDLE_PATH,
): void {
  const bundlePath = path.join(certsDir, 'system-ca-bundle.pem')
  try {
    const publicRootsPem = fs.readFileSync(publicCaBundlePath, 'utf8')
    const certCount = (publicRootsPem.match(/-----BEGIN CERTIFICATE-----/g) || []).length
    if (certCount < MIN_EXPECTED_PUBLIC_CA_COUNT) {
      console.warn(
        `提醒：內建公網 CA bundle（${publicCaBundlePath}）只讀到 ${certCount} 張憑證，` +
          `低於預期下限（${MIN_EXPECTED_PUBLIC_CA_COUNT}），可能是讀取或打包異常。` +
          '為避免寫出不完整的信任清單，這次啟動不設定 OpenSSL 信任來源。',
      )
      return
    }

    const existingSslCertFile = process.env.SSL_CERT_FILE
    if (existingSslCertFile && existingSslCertFile !== bundlePath) {
      console.warn(
        `提醒：偵測到 SSL_CERT_FILE 已經指向其他位置（${existingSslCertFile}），` +
          '可能是其他工具或使用者自行設定，LiveMR 選擇不覆蓋，跳過 OpenSSL 信任設定。',
      )
      return
    }

    const caCertPem = fs.readFileSync(caCertPath, 'utf8')
    const tmpPath = `${bundlePath}.tmp`
    fs.writeFileSync(tmpPath, `${publicRootsPem}\n${caCertPem}`)
    fs.renameSync(tmpPath, bundlePath)

    process.env.SSL_CERT_FILE = bundlePath
    if (existingSslCertFile !== bundlePath) {
      execFileSync('setx', ['SSL_CERT_FILE', bundlePath], { stdio: 'ignore' })
    }
  } catch (err) {
    console.warn(
      '提醒：無法自動設定這台電腦的 OpenSSL 信任清單，走 OpenSSL 的工具可能無法驗證 LiveMR 憑證：',
      (err as Error).message,
    )
  }
}
