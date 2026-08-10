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
4. 同一個終端機用 `openssl s_client -connect www.google.com:443` 確認公網憑證依然驗證成功，證明沒有把公網信任洗掉。
