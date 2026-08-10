# OpenSSL CA 信任自動化設計

## 背景

弱點掃描項目 num=19：本機（走 OpenSSL 的）掃描工具連到 LiveMR 的 HTTPS 端點時，因為驗證不到 `backend/src/launcher/certs.ts` 簽發的內部 CA（`LiveMR Local CA`）而回報憑證不受信任。

現有 `backend/src/launcher/trustStore.ts` 的 `trustCaLocally()` 已經在每次 `standalone.ts` 啟動時把內部 CA 加進 Windows `CurrentUser\Root`，但這只解決走 CryptoAPI/Schannel 驗證的用戶端（Chrome、Edge）。OpenSSL 在 Windows 上不讀 CryptoAPI 憑證庫，而是用自己的信任來源（編譯內建路徑，或 `SSL_CERT_FILE`/`SSL_CERT_DIR` 環境變數），所以內部 CA 對 OpenSSL 類工具仍是不受信任的狀態。

## 目標

隨 LiveMR launcher 啟動，自動讓**每一台安裝 LiveMR 的電腦**上的 OpenSSL 類工具，同時信任：
1. LiveMR 內部 CA（`LiveMR Local CA`）
2. 一般公網憑證（Google、AWS 等既有公開信任的根憑證）

## 非目標

- 不處理 `SSL_CERT_DIR`（雜湊目錄格式的信任來源）——一般 OpenSSL 工具讀 `SSL_CERT_FILE` 即可。
- 不影響 Node.js 自身發出的 HTTPS 請求（如 AI 助理呼叫 Gemini API）。Node 有自己一套 CA 處理機制（`NODE_OPTIONS=--use-system-ca` 或 `NODE_EXTRA_CA_CERTS`），不吃 `SSL_CERT_FILE`，是分開的既有機制（見記憶 `env-node-avast-ca`）。
- 不處理 Windows Root store 本身缺根憑證的情況（少見，通常靠 Windows Update AIA 自動補齊），此為 Windows 憑證管理範疇。
- 不修改機器上個別 OpenSSL 安裝（Git for Windows、Strawberry Perl 等）自帶的 `cacert.pem`。

## 設計

### 為什麼不能只把內部 CA 指給 `SSL_CERT_FILE`

`SSL_CERT_FILE` 是**整批取代**預設信任來源，不是疊加。若只指向內部 CA，會讓 OpenSSL 不再信任 Google/AWS 等公網憑證，因此必須產生「公網根憑證 + 內部 CA」合併後的 bundle。

### 架構

在 `backend/src/launcher/trustStore.ts` 新增 `trustCaForOpenSsl()`，與既有 `trustCaLocally()` 並列，由 `standalone.ts` 依序呼叫：

```ts
trustCaLocally(caCertPath)                          // 既有：CurrentUser\Root（CryptoAPI 類工具）
trustCaForOpenSsl(caCertPath, path.join(DATA_DIR, 'certs'))  // 新增：OpenSSL 類工具
```

### 元件與資料流

`trustCaForOpenSsl(caCertPath, certsDir)`：

1. **匯出目前信任的公網根憑證**：用 `execFileSync('powershell.exe', [...])`（陣列參數，非 shell 字串，比照既有 `certutil` 呼叫方式避免注入）匯出 `Cert:\LocalMachine\Root` ∪ `Cert:\CurrentUser\Root` 的所有憑證，轉成 PEM 文字。
2. **合併內部 CA**：直接讀 `caCertPath`（`ca-cert.pem`）內容附加在匯出結果之後——不依賴 `trustCaLocally()` 一定先成功，兩者獨立保證內部 CA 一定在合併結果裡。
3. **寫出合併檔並設定環境變數**：
   - 寫到 `<certsDir>/system-ca-bundle.pem`
   - `process.env.SSL_CERT_FILE = bundlePath`（供本次啟動流程與其 spawn 出的子行程使用）
   - `execFileSync('setx', ['SSL_CERT_FILE', bundlePath])`（User 層級持久化，不跳 UAC，讓之後開啟的新終端機/掃描工具也讀得到）

每次 launcher 啟動都重新執行一次，與 `trustCaLocally()` 一樣冪等（PowerShell 匯出 + 覆寫檔案 + `setx` 皆可重複執行，無副作用累積）。

### 錯誤處理

整段包在 try/catch：PowerShell 或 `setx` 不存在/失敗時，僅印警告、不中斷啟動流程，沿用 `trustCaLocally()` 現有「失敗不中斷、僅提示」原則。

### 測試

比照 `trustStore.test.ts` 既有寫法：mock `execFileSync`/`fs`，驗證：
- PowerShell 匯出指令與 `setx` 有被正確呼叫（含參數）
- `SSL_CERT_FILE` 有被寫入 `process.env`
- 任一步驟失敗時 function 不拋錯

## 影響檔案

- `backend/src/launcher/trustStore.ts`（新增 `trustCaForOpenSsl`）
- `backend/src/launcher/trustStore.test.ts`（新增測試）
- `backend/src/standalone.ts`（呼叫新 function）
