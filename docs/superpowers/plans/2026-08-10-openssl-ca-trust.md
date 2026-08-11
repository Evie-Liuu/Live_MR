# OpenSSL CA 信任自動化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 LiveMR launcher 在每次啟動時，自動讓這台機器上的 OpenSSL 類工具同時信任 LiveMR 內部 CA 與一般公網根憑證，修正弱點掃描項目 num=19。

**Architecture:** 在 `backend/src/launcher/trustStore.ts` 新增 `trustCaForOpenSsl()`，透過 PowerShell 匯出 Windows `LocalMachine\Root` ∪ `CurrentUser\Root` 的公網根憑證，附加上內部 CA 憑證內容，寫成一份合併 PEM bundle，再用 `SSL_CERT_FILE` 環境變數（當次 process + `setx` 持久化）指向它。`standalone.ts` 在既有 `trustCaLocally()` 呼叫之後接著呼叫這個新 function。

**Tech Stack:** TypeScript / Node.js（`node:child_process` execFileSync、`node:fs`）、Vitest、PowerShell（Windows 內建）。

## Global Constraints

- 子行程呼叫一律用 `execFileSync(cmd, [args...])` 陣列參數形式，不得組字串丟給 shell（沿用 `trustCaLocally` 既有作法，避免注入風險）。
- 任何一步失敗（PowerShell 不存在、`setx` 失敗等）只印 `console.warn`，不得中斷 launcher 啟動流程（沿用 `trustCaLocally` 既有的「失敗不中斷、僅提示」原則）。
- 新函式與既有 `trustCaLocally` 放在同一個檔案 `backend/src/launcher/trustStore.ts`，維持這個檔案「讓本機信任 LiveMR CA」的單一主題。

---

### Task 1: `trustCaForOpenSsl()` — 匯出並合併 CA bundle、設定 SSL_CERT_FILE

**Files:**
- Modify: `backend/src/launcher/trustStore.ts`
- Modify: `backend/src/launcher/trustStore.test.ts`
- Modify: `backend/src/standalone.ts:50-51`

**Interfaces:**
- Consumes: 無（直接讀檔案系統與呼叫子行程）
- Produces: `export function trustCaForOpenSsl(caCertPath: string, certsDir: string): void` — 供 `standalone.ts` 呼叫。寫出 `<certsDir>/system-ca-bundle.pem`，並設定 `process.env.SSL_CERT_FILE`。

- [ ] **Step 1: 寫失敗的測試**

在 `backend/src/launcher/trustStore.test.ts` 現有內容之後（`trustCaLocally` 的 `describe` 區塊之後）加入：

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { trustCaForOpenSsl } from './trustStore.js'

describe('trustCaForOpenSsl', () => {
  let dir: string
  let caCertPath: string

  beforeEach(() => {
    vi.mocked(execFileSync).mockReset()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livemr-truststore-test-'))
    caCertPath = path.join(dir, 'ca-cert.pem')
    fs.writeFileSync(
      caCertPath,
      '-----BEGIN CERTIFICATE-----\nFAKE-CA-CERT\n-----END CERTIFICATE-----\n',
    )
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
    delete process.env.SSL_CERT_FILE
  })

  it('writes a merged bundle of exported public roots and the internal CA, and points SSL_CERT_FILE at it', () => {
    vi.mocked(execFileSync).mockImplementation((cmd) => {
      if (cmd === 'powershell.exe') {
        return '-----BEGIN CERTIFICATE-----\nFAKE-PUBLIC-ROOT\n-----END CERTIFICATE-----\n' as unknown as Buffer
      }
      return Buffer.from('')
    })

    trustCaForOpenSsl(caCertPath, dir)

    const bundlePath = path.join(dir, 'system-ca-bundle.pem')
    const bundle = fs.readFileSync(bundlePath, 'utf8')
    expect(bundle).toContain('FAKE-PUBLIC-ROOT')
    expect(bundle).toContain('FAKE-CA-CERT')

    expect(process.env.SSL_CERT_FILE).toBe(bundlePath)
    expect(execFileSync).toHaveBeenCalledWith(
      'setx',
      ['SSL_CERT_FILE', bundlePath],
      { stdio: 'ignore' },
    )
  })

  it('does not throw when powershell or setx fails', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('powershell not found')
    })

    expect(() => trustCaForOpenSsl(caCertPath, dir)).not.toThrow()
  })
})
```

Note：檔案最上面已有 `vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))`（既有 `trustCaLocally` 測試共用同一個 mock），不用重複加。若 `fs`/`os`/`path` 尚未在檔案頂部匯入，把上面的 `import` 搬到檔案最上方跟既有 import 放一起。

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd backend && npx vitest run src/launcher/trustStore.test.ts`
Expected: FAIL — `trustCaForOpenSsl` is not exported / not defined。

- [ ] **Step 3: 實作 `trustCaForOpenSsl`**

在 `backend/src/launcher/trustStore.ts` 的 `trustCaLocally` function 後面加入：

```ts
import path from 'node:path'

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
```

檔案頂部需要補上 `import fs from 'node:fs'`（目前 `trustStore.ts` 還沒有這個 import，只有 `certutil` 用到的 `execFileSync`）。

- [ ] **Step 4: 執行測試確認通過**

Run: `cd backend && npx vitest run src/launcher/trustStore.test.ts`
Expected: PASS（全部案例，含既有 `trustCaLocally` 測試）。

- [ ] **Step 5: 串接進 standalone.ts**

修改 `backend/src/standalone.ts` 第 15-16 行的 import：

```ts
import { trustCaLocally } from './launcher/trustStore.js'
```

改成：

```ts
import { trustCaLocally, trustCaForOpenSsl } from './launcher/trustStore.js'
```

修改第 50-51 行：

```ts
  const { certPath, keyPath, caCertPath } = await ensureCert(path.join(DATA_DIR, 'certs'), ip)
  trustCaLocally(caCertPath)
```

改成：

```ts
  const { certPath, keyPath, caCertPath } = await ensureCert(path.join(DATA_DIR, 'certs'), ip)
  trustCaLocally(caCertPath)
  trustCaForOpenSsl(caCertPath, path.join(DATA_DIR, 'certs'))
```

- [ ] **Step 6: 全專案測試 + 型別檢查**

Run: `cd backend && npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS，無型別錯誤。

- [ ] **Step 7: Commit**

```bash
git add backend/src/launcher/trustStore.ts backend/src/launcher/trustStore.test.ts backend/src/standalone.ts
git commit -m "fix(security): 弱點掃描修正之 OpenSSL 未信任內部 CA（num=19）"
```

---

## 驗證方式（人工，開發機上執行一次）

自動化測試都是 mock 掉 `execFileSync`，實際 PowerShell 匯出邏輯無法在單元測試涵蓋到。實作完成後，建議在這台 Windows 機器上手動跑一次 launcher（或直接呼叫 `trustCaForOpenSsl`）確認：

1. `data/certs/system-ca-bundle.pem` 有產生，內容同時包含 `-----BEGIN CERTIFICATE-----` 區塊的多張憑證（公網根憑證 + 內部 CA）。
2. 開一個新的終端機視窗（讓 `setx` 生效），執行 `echo %SSL_CERT_FILE%`（cmd）或 `$env:SSL_CERT_FILE`（PowerShell）應該指向上述路徑。
3. 在該新終端機用 `openssl s_client -connect <這台機器的LAN IP>:443 -CAfile "%SSL_CERT_FILE%"` 或直接不帶 `-CAfile`（讓 openssl 走環境變數預設）連線 LiveMR，鏈應驗證成功（`Verify return code: 0 (ok)`）。
4. 同一個終端機分別用 `openssl s_client -connect www.google.com:443` 和 `openssl s_client -connect aws.amazon.com:443` 確認公網憑證依然驗證成功，證明沒有把公網信任洗掉（不要只測一個網站——見下方 Addendum 的 Important #3）。

---

## Addendum（2026-08-11）：Task 1 fix wave — 方案 A → 方案 B

Task 1 的第一版實作完成並通過 task-level review 後，final whole-branch review 抓到一個設計層級的問題，並經 controller 在這台機器上獨立驗證為真：

**Important #3（已驗證為真）：Windows Root store 不是公開信任根憑證的完整清單。** 實測這台機器：`Cert:\LocalMachine\Root` 48 張、`Cert:\CurrentUser\Root` 50 張（含 12 張已過期），聯集裡**沒有** Google 的 `GTS Root R1`、也沒有 Amazon 的 `Amazon Root CA 1`。Windows 對很多根憑證是「按需下載」而非預先存好，所以拿這個 store 匯出當「公網信任來源」寫進靜態的 `SSL_CERT_FILE` bundle，實質上是**縮窄**了原本 OpenSSL 工具能驗證的公網憑證範圍，沒有達成 spec 的「同時信任內部 CA 與公網憑證（如 Google、AWS）」目標。

決定（人類拍板）：**改用方案 B**——不要再用 PowerShell 匯出 Windows Root store，改成在 repo 內建一份靜態的公開信任 CA bundle，啟動時與內部 CA 合併。

### 修訂後的需求（取代原本 Task 1 的 PowerShell 匯出邏輯）

**新增檔案：** `backend/src/launcher/public-ca-bundle.pem`
- Mozilla 維護、curl.se 發布的標準 CA bundle（`https://curl.se/ca/cacert.pem`），已下載並確認內含 `GTS Root R1`、`Amazon Root CA 1`（119 張憑證，SHA256 見檔案內的 `## SHA256:` 註解列）。
- 這是 repo 資產，跟著程式碼版控，日後要更新只需重新下載覆蓋這個檔案（不需要改程式邏輯）。

**修改 `trustStore.ts` 的 `trustCaForOpenSsl()`：**

1. **不再呼叫 PowerShell 匯出 Windows store。** 改成讀 `backend/src/launcher/public-ca-bundle.pem`（用 `import.meta.url` + `path` 定位到原始碼旁邊的這個檔案，跟打包後的路徑要一致——確認 `scripts/build-launcher.mjs` 有沒有把這個 `.pem` 一起複製進打包目錄，若沒有要一併加進去；先讀 `scripts/build-launcher.mjs` 確認現有的資產複製方式，仿照既有作法）。
2. **Critical #1 修正——驗證合併結果，不合理就別覆寫/別 setx：** 讀完 `public-ca-bundle.pem` 內容後，數一下 `-----BEGIN CERTIFICATE-----` 出現次數，低於一個合理下限（例如 50——這份 bundle 目前有 119 張，正常不會腰斬）就視為讀取異常，`console.warn` 後直接 return，不寫 bundle 檔、不設定任何環境變數、不呼叫 `setx`。這個檔案是 repo 內建資產，理論上讀取不該失敗，但這一步是防禦性檢查，避免萬一（例如打包腳本漏複製這個檔案）時靜默寫出一份空的信任清單。
3. **Important #4 修正——不要無條件覆蓋既有的 `SSL_CERT_FILE`：** `setx` 之前，用 `process.env.SSL_CERT_FILE` 檢查目前是否已經有值、且不是我們自己上次設定的那個路徑（可以用一個標記，例如檢查該路徑檔名是不是我們自己寫的 `system-ca-bundle.pem` 且內容開頭有沒有我們的識別註解）。如果偵測到是別的工具/使用者設定的既有值，`console.warn` 提醒有偵測到既有的 `SSL_CERT_FILE`、LiveMR 選擇不覆蓋，然後直接 return（不寫自己的 bundle，也不動環境變數）。如果目前的值就是我們自己上次寫的路徑（同一個 `certsDir` 下的 `system-ca-bundle.pem`），視為正常重跑，照常覆寫。
4. **Important #2 部分修正——避免每次啟動都重寫登錄檔：** `setx` 前先檢查 `process.env.SSL_CERT_FILE` 是否已經等於這次要設定的 `bundlePath`；相等就跳過 `setx`（只有內容真的變動或第一次設定時才寫登錄檔）。這無法完全解決「資料夾搬移後殘留一個指向不存在檔案的環境變數」的問題，但可以在文件裡加一段：`docs/dev-setup.md` 或這個函式的 JSDoc 補一句「解除設定方式：`setx SSL_CERT_FILE ""` 或刪除 `HKCU\Environment` 底下的 `SSL_CERT_FILE`」。
5. **Minor #7（非原子寫入）順手修正：** 合併結果先寫到 `<certsDir>/system-ca-bundle.pem.tmp`，再用 `fs.renameSync` 換成最終檔名，避免其他行程讀到寫到一半的檔案。
6. **Minor #8（JSDoc 用詞修正）：** 移除或修正「這次啟動流程內、及其 spawn 出的子行程立即可用」這句——Node 本身不吃 `SSL_CERT_FILE`（除非用 `--use-openssl-ca` 啟動），`livekit-server.exe`（Go）在 Windows 上也不吃這個環境變數，`process.env.SSL_CERT_FILE = bundlePath` 這行主要是為了維持既有慣例／未來可能的用途，不是「讓目前這個 process tree 立刻生效」。
7. **Minor #9（stderr 靜音）：** `execFileSync` 呼叫（如果還有殘留任何子行程呼叫）不要讓 stderr 直接噴到 launcher console；若這次改寫後已經完全不需要呼叫任何子行程（不再需要 PowerShell、`setx` 仍是唯一的子行程呼叫），只需注意 `setx` 那次呼叫本身的 `stdio` 設定維持 `{ stdio: 'ignore' }`（既有寫法已經是這樣，確認不要在修改過程中弄丟）。
8. 因為不再從 Windows store 匯出，Minor #5、#6（憑證重複收錄、prior review 行號對不上）不再適用，不用處理。

**測試（Task 1 rev2，`trustStore.test.ts`）：**
- 更新既有兩個 `trustCaForOpenSsl` 測試案例：不再需要 mock `execFileSync` 回傳 PowerShell 輸出（因為不再呼叫 PowerShell），改成驗證讀到的是 `public-ca-bundle.pem`（測試裡可以指向一個暫時建立的假 bundle 檔，或直接用真的 `public-ca-bundle.pem` 驗證合併結果同時包含其中已知內容與內部 CA 內容）。
- **Critical #1 的新測試：** bundle 檔內容被竄改成只有 1 張憑證時（模擬讀取異常），function 不應該寫出 `system-ca-bundle.pem`、不應該設定 `process.env.SSL_CERT_FILE`、不應該呼叫 `setx`。
- **Important #4 的新測試：** 呼叫前先手動設定一個「不是我們自己寫的」`process.env.SSL_CERT_FILE`（例如指向一個跟 `certsDir` 無關的路徑），呼叫後這個值應該維持不變（不被覆蓋），且不應該寫出 `system-ca-bundle.pem`（或依你實作選擇的行為——重點是不能靜默覆蓋別人的設定；若選擇「仍寫出 bundle 檔但不動環境變數」也可以，測試對應調整，但一定要驗證原本的 `SSL_CERT_FILE` 值沒被蓋掉）。
- **setx 冪等的新測試：** 連續呼叫兩次（`process.env.SSL_CERT_FILE` 在第一次呼叫後已經等於 `bundlePath`），第二次呼叫不應該再呼叫 `setx`（用 `execFileSync` mock 驗證呼叫次數）。
- 補上 argv 斷言：驗證 `setx` 呼叫時的完整參數陣列（沿用第一版已有的斷言方式即可，不需要新增測試，只要確認沒有在修改過程中弄丟）。
- Minor #10 提到的「setx 拋錯」路徑也要補一個測試案例：驗證 `setx` 拋錯時 function 不會 throw（沿用第一版「does not throw」測試的精神，改成觸發 `setx` 失敗而非 PowerShell 失敗）。

**`standalone.ts` 串接：** 不需要變動（呼叫方式不變，只有 `trustCaForOpenSsl` 內部實作改變）。

**建置腳本：** 檢查 `scripts/build-launcher.mjs`，確認 `backend/src/launcher/public-ca-bundle.pem` 會被複製進最終打包目錄（跟 `.ts` 編譯產物同一個相對位置，讓執行期用相對路徑找得到）。如果目前的複製清單是用副檔名或目錄樣式（例如只複製 `frontend-dist/`、`bin/`），要另外把這個 `.pem` 加進去；如果找不到現成的「複製額外資產」機制，在報告裡說明現況、不要自己發明一套新的打包機制。

修完後：
- 執行完整 backend 測試套件 + `npx tsc --noEmit`
- Commit（訊息例如：`fix(security): num=19 fix wave — 改用內建公網 CA bundle，修正驗證與覆蓋既有設定的問題`）
