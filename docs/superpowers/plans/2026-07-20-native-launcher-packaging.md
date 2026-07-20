# 原生封裝啟動器（去 Docker）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把老師端從「需要 Docker Desktop + Git + OpenSSL + nginx + Redis」的 `docker-compose` 部署，改成一個可攜式資料夾（`bin/node.exe` + `bin/livekit-server.exe` + `bin/ffmpeg.exe` + 打包好的 backend + 前端靜態檔），雙擊一個 `.bat` 啟動器即可執行，不需要使用者安裝任何額外軟體。

**Architecture:** 在既有 `backend/` package 內新增 `src/launcher/` 模組群（LAN IP 偵測、自簽憑證產生、LiveKit 設定產生 + 子行程管理、安全標頭 middleware），加一個新的 production entrypoint `backend/src/standalone.ts`：用 Node 內建 `https` 終止 TLS、serve 前端靜態檔、掛載既有 `createRouter` API、用 `http-proxy-middleware` 反代 `/livekit/*` 給本機 `livekit-server.exe` 子行程（單機模式，免 Redis）。另外新增 repo 根目錄 `scripts/`：下載 `livekit-server.exe`（LiveKit 官方 Windows release）與可攜式 `node.exe`（Node.js 官方 Windows zip），並用 esbuild 把 `standalone.ts` 打包成單一 JS 檔，組裝成最終可攜式 `LiveMR/` 資料夾。

**Tech Stack:** Node.js 22（既有）、TypeScript（既有）、新增 npm 依賴 `selfsigned`（自簽憑證）與 `http-proxy-middleware`（反向代理），建置期用 `esbuild`（bundle）；`livekit-server.exe` 取自 LiveKit 官方 GitHub Release Windows binary；可攜式 Node 執行環境取自 nodejs.org 官方 Windows zip；解壓縮透過 Windows 內建 PowerShell `Expand-Archive`（不額外加 npm unzip 依賴）。

## Global Constraints

- **只支援 Windows。** 不做 macOS/Linux 相容性處理。
- **只處理老師端主機**，不影響學生端（瀏覽器掃碼加入，本來就免安裝）。
- **不提供公網曝露功能**——`cloudflared`/`start-tunnel.*` 整條路徑移除，不做任何替代。
- **不把 Docker Desktop 靜默安裝進來**——見 spec 文件「評估過的替代方案」一節，已否決。
- **LiveKit 單機模式（免 Redis）**：新產生的 LiveKit 設定不含 `redis:` 區塊。
- **LAN 直連行為不變**：自簽憑證的 `subjectAltName` 綁老師電腦的區網 IP；其他裝置只要同一區網、開 `https://<LAN_IP>` 就能用，`getUserMedia` 只要求 secure context。
- **安全標頭不可退化**：現有 nginx 設定的 `Strict-Transport-Security`、`X-Content-Type-Options: nosniff`、`X-Frame-Options: SAMEORIGIN`、完整 CSP 字串（見 Task 4）必須原樣搬到 Express middleware，一個字都不能少。
- Commit 訊息不要加 `Co-Authored-By` 字樣。
- 沿用 Vitest 測試慣例；MediaRecorder/瀏覽器 API、真正 spawn 外部 binary（LiveKit/PowerShell）的部分不強求 unit test（比照本專案既有的 `ffmpeg-static`/`egress` 慣例），改用明確標注的手動驗證步驟把關；純函式/可注入依賴的部分（IP 偵測、憑證產生、LiveKit YAML 產生、安全標頭）一律要有 unit test。
- 新增的建置產物目錄需加進 `.gitignore`（見 Task 5、Task 6）。

---

### Task 1: LAN IP 偵測（`backend/src/launcher/network.ts`）

**Files:**
- Create: `backend/src/launcher/network.ts`
- Test: `backend/src/launcher/network.test.ts`

**Interfaces:**
- Produces: `detectLanIp(interfaces?: NodeJS.Dict<import('node:os').NetworkInterfaceInfo[]>): string | null` — 預設參數呼叫真實 `os.networkInterfaces()`，可注入假資料供測試。回傳偵測到的第一個候選 IPv4，找不到回 `null`。

- [ ] **Step 1: 寫失敗測試**

```typescript
// backend/src/launcher/network.test.ts
import { describe, it, expect } from 'vitest'
import { detectLanIp } from './network.js'
import type { NetworkInterfaceInfo } from 'node:os'

function iface(address: string, family: 'IPv4' | 'IPv6', internal: boolean): NetworkInterfaceInfo {
  return {
    address,
    netmask: '255.255.255.0',
    family,
    mac: '00:00:00:00:00:00',
    internal,
    cidr: `${address}/24`,
  } as NetworkInterfaceInfo
}

describe('detectLanIp', () => {
  it('picks the first non-internal IPv4 address', () => {
    const fake = {
      'Loopback': [iface('127.0.0.1', 'IPv4', true)],
      'Ethernet': [iface('192.168.1.50', 'IPv4', false)],
    }
    expect(detectLanIp(fake)).toBe('192.168.1.50')
  })

  it('excludes loopback (127.x)', () => {
    const fake = {
      'Loopback': [iface('127.0.0.1', 'IPv4', true)],
    }
    expect(detectLanIp(fake)).toBeNull()
  })

  it('excludes link-local (169.254.x)', () => {
    const fake = {
      'Ethernet': [iface('169.254.1.2', 'IPv4', false)],
    }
    expect(detectLanIp(fake)).toBeNull()
  })

  it('ignores IPv6-only interfaces', () => {
    const fake = {
      'Ethernet': [iface('fe80::1', 'IPv6', false)],
    }
    expect(detectLanIp(fake)).toBeNull()
  })

  it('when multiple candidates exist, deterministically picks the first key/entry in iteration order', () => {
    const fake = {
      'Wi-Fi': [iface('192.168.1.50', 'IPv4', false)],
      'Ethernet': [iface('10.0.0.5', 'IPv4', false)],
    }
    expect(detectLanIp(fake)).toBe('192.168.1.50')
  })

  it('returns null when no interfaces given', () => {
    expect(detectLanIp({})).toBeNull()
  })
})
```

- [ ] **Step 2: 執行測試,確認失敗**

Run: `cd backend && npx vitest run src/launcher/network.test.ts`
Expected: FAIL（找不到模組 `./network.js`）

- [ ] **Step 3: 實作 `backend/src/launcher/network.ts`**

```typescript
import os from 'node:os'

/**
 * 偵測本機區網 IPv4 位址。移植自 setup.ps1 的 Get-LanIP：排除 loopback（127.x）
 * 與 link-local（169.254.x），多個候選時取第一個（Node 不像 Windows
 * Get-NetIPAddress 能查 PrefixOrigin=Dhcp，這裡簡化為「第一個非內部 IPv4」）。
 */
export function detectLanIp(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): string | null {
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (
        iface.family === 'IPv4' &&
        !iface.internal &&
        !iface.address.startsWith('169.254.')
      ) {
        return iface.address
      }
    }
  }
  return null
}
```

- [ ] **Step 4: 執行測試,確認通過**

Run: `cd backend && npx vitest run src/launcher/network.test.ts`
Expected: PASS（6 tests）

- [ ] **Step 5: Commit**

```bash
git add backend/src/launcher/network.ts backend/src/launcher/network.test.ts
git commit -m "feat(launcher): 新增 LAN IP 偵測模組"
```

---

### Task 2: 自簽憑證產生（`backend/src/launcher/certs.ts`）

**Files:**
- Modify: `backend/package.json`（新增 `selfsigned` 依賴）
- Create: `backend/src/launcher/certs.ts`
- Test: `backend/src/launcher/certs.test.ts`

**Interfaces:**
- Consumes: `selfsigned` npm package（`generate` 為 async function，v3+ API）。
- Produces: `ensureCert(certsDir: string, ip: string): Promise<{ certPath: string; keyPath: string }>`（`backend/src/launcher/certs.ts`）。若 `certsDir` 下已有跟 `ip` 相符的憑證（用同目錄下的 `ip.txt` 側記檔比對）就直接回傳既有路徑，不重新產生；否則產生新的、SAN 綁 `ip` 的自簽憑證並寫入 `cert.pem`/`key.pem`/`ip.txt`。

- [ ] **Step 1: 安裝依賴**

Run: `cd backend && npm install selfsigned`

- [ ] **Step 2: 寫失敗測試**

```typescript
// backend/src/launcher/certs.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { X509Certificate } from 'node:crypto'
import { ensureCert } from './certs.js'

describe('ensureCert', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livemr-certs-test-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('generates cert.pem and key.pem bound to the given IP', async () => {
    const { certPath, keyPath } = await ensureCert(dir, '192.168.1.50')
    expect(fs.existsSync(certPath)).toBe(true)
    expect(fs.existsSync(keyPath)).toBe(true)

    const cert = new X509Certificate(fs.readFileSync(certPath))
    expect(cert.subjectAltName).toContain('IP Address:192.168.1.50')
  })

  it('reuses the existing cert when called again with the same IP', async () => {
    const first = await ensureCert(dir, '192.168.1.50')
    const firstContent = fs.readFileSync(first.certPath, 'utf8')

    const second = await ensureCert(dir, '192.168.1.50')
    const secondContent = fs.readFileSync(second.certPath, 'utf8')

    expect(secondContent).toBe(firstContent)
  })

  it('regenerates the cert when the IP changes', async () => {
    const first = await ensureCert(dir, '192.168.1.50')
    const firstContent = fs.readFileSync(first.certPath, 'utf8')

    const second = await ensureCert(dir, '10.0.0.5')
    const secondContent = fs.readFileSync(second.certPath, 'utf8')

    expect(secondContent).not.toBe(firstContent)
    const cert = new X509Certificate(fs.readFileSync(second.certPath))
    expect(cert.subjectAltName).toContain('IP Address:10.0.0.5')
  })
})
```

- [ ] **Step 3: 執行測試,確認失敗**

Run: `cd backend && npx vitest run src/launcher/certs.test.ts`
Expected: FAIL（找不到模組 `./certs.js`）

- [ ] **Step 4: 實作 `backend/src/launcher/certs.ts`**

```typescript
import fs from 'node:fs'
import path from 'node:path'
import selfsigned from 'selfsigned'

/**
 * 確保 certsDir 下有一份綁定 ip 的自簽憑證；若既有憑證的 ip.txt 側記檔案
 * 與目前 ip 相符就直接沿用，否則（IP 變更或憑證不存在）重新產生。
 * 取代 setup.ps1 呼叫 openssl.exe 的行為，改用純 JS，不需要 Git for Windows。
 */
export async function ensureCert(
  certsDir: string,
  ip: string,
): Promise<{ certPath: string; keyPath: string }> {
  const certPath = path.join(certsDir, 'cert.pem')
  const keyPath = path.join(certsDir, 'key.pem')
  const ipMarkerPath = path.join(certsDir, 'ip.txt')

  const existingIp = fs.existsSync(ipMarkerPath)
    ? fs.readFileSync(ipMarkerPath, 'utf8').trim()
    : null

  if (existingIp === ip && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return { certPath, keyPath }
  }

  fs.mkdirSync(certsDir, { recursive: true })

  const pems = await selfsigned.generate(
    [{ name: 'commonName', value: ip }],
    {
      days: 365,
      keySize: 2048,
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'subjectAltName', altNames: [{ type: 7, ip }] },
      ],
    },
  )

  fs.writeFileSync(certPath, pems.cert)
  fs.writeFileSync(keyPath, pems.private)
  fs.writeFileSync(ipMarkerPath, ip)

  return { certPath, keyPath }
}
```

- [ ] **Step 5: 執行測試,確認通過**

Run: `cd backend && npx vitest run src/launcher/certs.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/launcher/certs.ts backend/src/launcher/certs.test.ts
git commit -m "feat(launcher): 新增自簽憑證產生模組，取代 openssl.exe"
```

---

### Task 3: LiveKit 設定產生 + 子行程管理（`backend/src/launcher/livekit.ts`）

**Files:**
- Create: `backend/src/launcher/livekitConfig.ts`
- Test: `backend/src/launcher/livekitConfig.test.ts`
- Create: `backend/src/launcher/livekitProcess.ts`

**Interfaces:**
- Produces: `buildLivekitConfig(opts: { nodeIp: string; apiKey: string; apiSecret: string; port?: number; udpPortStart?: number; udpPortEnd?: number }): string`（`livekitConfig.ts`）——回傳 LiveKit YAML 設定文字，**不含 `redis:` 區塊**（單機模式）。`port`/`udpPortStart`/`udpPortEnd` 預設分別為 `7880`/`40000`/`40020`。
- Produces: `class LiveKitProcess`（`livekitProcess.ts`）— `start(opts: { binPath: string; configYaml: string; workDir: string; port?: number }): Promise<void>`（把 `configYaml` 寫到 `workDir/livekit.generated.yaml`、spawn `binPath --config <path>`、輪詢 `http://127.0.0.1:<port>/` 直到有回應或逾時 15 秒才 resolve）；`stop(): Promise<void>`（結束子行程）。
- Consumes: `buildLivekitConfig` 的輸出字串。

- [ ] **Step 1: 寫失敗測試（只測 `buildLivekitConfig`，`LiveKitProcess` 需要真的 binary，見 Step 5 後的手動驗證）**

```typescript
// backend/src/launcher/livekitConfig.test.ts
import { describe, it, expect } from 'vitest'
import { buildLivekitConfig } from './livekitConfig.js'

describe('buildLivekitConfig', () => {
  it('generates config with node_ip, keys, and default ports', () => {
    const yaml = buildLivekitConfig({
      nodeIp: '192.168.1.50',
      apiKey: 'devkey',
      apiSecret: 'devsecret1234567890devsecret1234567890',
    })
    expect(yaml).toContain('port: 7880')
    expect(yaml).toContain('node_ip: 192.168.1.50')
    expect(yaml).toContain('port_range_start: 40000')
    expect(yaml).toContain('port_range_end: 40020')
    expect(yaml).toContain('use_external_ip: false')
    expect(yaml).toContain('devkey: devsecret1234567890devsecret1234567890')
  })

  it('does not include a redis section (single-node mode)', () => {
    const yaml = buildLivekitConfig({
      nodeIp: '192.168.1.50',
      apiKey: 'devkey',
      apiSecret: 'devsecret1234567890devsecret1234567890',
    })
    expect(yaml).not.toContain('redis:')
  })

  it('honors custom port and udp range overrides', () => {
    const yaml = buildLivekitConfig({
      nodeIp: '10.0.0.5',
      apiKey: 'k',
      apiSecret: 's',
      port: 7999,
      udpPortStart: 41000,
      udpPortEnd: 41020,
    })
    expect(yaml).toContain('port: 7999')
    expect(yaml).toContain('port_range_start: 41000')
    expect(yaml).toContain('port_range_end: 41020')
  })
})
```

- [ ] **Step 2: 執行測試,確認失敗**

Run: `cd backend && npx vitest run src/launcher/livekitConfig.test.ts`
Expected: FAIL（找不到模組 `./livekitConfig.js`）

- [ ] **Step 3: 實作 `backend/src/launcher/livekitConfig.ts`**

```typescript
export interface LivekitConfigOptions {
  nodeIp: string
  apiKey: string
  apiSecret: string
  port?: number
  udpPortStart?: number
  udpPortEnd?: number
}

/**
 * 產生 LiveKit 執行期設定（YAML）。取代 docker-compose 用 envsubst 套
 * livekit.yaml.template 的做法，改在 JS 端組字串。刻意不寫 redis 區塊——
 * 單機教室場景不需要，LiveKit 沒有 redis 設定時會自動用單機模式。
 */
export function buildLivekitConfig(opts: LivekitConfigOptions): string {
  const port = opts.port ?? 7880
  const udpPortStart = opts.udpPortStart ?? 40000
  const udpPortEnd = opts.udpPortEnd ?? 40020

  return `port: ${port}
rtc:
  node_ip: ${opts.nodeIp}
  port_range_start: ${udpPortStart}
  port_range_end: ${udpPortEnd}
  use_external_ip: false
room:
  enable_remote_unmute: true
keys:
  ${opts.apiKey}: ${opts.apiSecret}
logging:
  level: info
`
}
```

- [ ] **Step 4: 執行測試,確認通過**

Run: `cd backend && npx vitest run src/launcher/livekitConfig.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: 實作 `backend/src/launcher/livekitProcess.ts`（子行程管理，無 unit test——需要真的 livekit-server.exe，見下方手動驗證）**

```typescript
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'

function waitForHttp(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1000 }, (res) => {
        res.resume()
        resolve()
      })
      req.on('error', () => {
        if (Date.now() > deadline) {
          reject(new Error(`LiveKit did not become ready on port ${port} within ${timeoutMs}ms`))
          return
        }
        setTimeout(attempt, 500)
      })
      req.on('timeout', () => req.destroy())
    }
    attempt()
  })
}

/** 管理 livekit-server.exe 子行程的生命週期。 */
export class LiveKitProcess {
  private child: ChildProcess | null = null

  async start(opts: {
    binPath: string
    configYaml: string
    workDir: string
    port?: number
  }): Promise<void> {
    fs.mkdirSync(opts.workDir, { recursive: true })
    const configPath = path.join(opts.workDir, 'livekit.generated.yaml')
    fs.writeFileSync(configPath, opts.configYaml)

    this.child = spawn(opts.binPath, ['--config', configPath], {
      stdio: 'inherit',
      windowsHide: true,
    })

    await waitForHttp(opts.port ?? 7880, 15_000)
  }

  async stop(): Promise<void> {
    const child = this.child
    this.child = null
    if (!child || child.exitCode !== null) return
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve())
      child.kill()
      // Windows 上 SIGTERM 對某些子行程無效，逾時後強制終止
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL')
      }, 3000)
    })
  }
}
```

- [ ] **Step 6: 執行完整 backend 測試套件**

Run: `cd backend && npm test`
Expected: 除既有的 2 個不相關 long-polling timeout 失敗外全數 PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src/launcher/livekitConfig.ts backend/src/launcher/livekitConfig.test.ts backend/src/launcher/livekitProcess.ts
git commit -m "feat(launcher): 新增 LiveKit 設定產生與子行程管理模組"
```

> **手動驗證（Step 5 的 `LiveKitProcess`，需要 Task 5 產出的 `livekit-server.exe` 才能執行）：** 待 Task 5 下載到 `livekit-server.exe` 後，寫一個暫時性腳本呼叫 `buildLivekitConfig` + `LiveKitProcess.start()`，確認能看到 LiveKit 的 log 輸出、`http://127.0.0.1:7880/` 有回應、呼叫 `stop()` 後行程確實結束（工作管理員/`Get-Process livekit-server` 查不到殘留行程）。此驗證併入 Task 4 的手動驗證一起做即可，不需要現在單獨執行。

---

### Task 4: 安全標頭 middleware + standalone HTTPS 伺服器

**Files:**
- Modify: `backend/package.json`（新增 `http-proxy-middleware` 依賴）
- Create: `backend/src/launcher/security.ts`
- Test: `backend/src/launcher/security.test.ts`
- Modify: `backend/src/routes.ts`（`recordingsDir` 改為可用環境變數覆蓋）
- Test: `backend/src/routes.recordingsDir.test.ts`
- Modify: `backend/src/merge.ts`（ffmpeg 執行檔路徑改為可用環境變數覆蓋）
- Create: `backend/src/standalone.ts`

**Interfaces:**
- Produces: `securityHeaders(serverName: string): import('express').RequestHandler`（`security.ts`）——回傳一個 Express middleware，對每個回應加上跟現有 nginx 設定逐字相同的安全標頭。
- Consumes: Task 1 的 `detectLanIp`、Task 2 的 `ensureCert`、Task 3 的 `buildLivekitConfig` / `LiveKitProcess`、既有的 `backend/src/rooms.ts`(`RoomStore`)、`backend/src/routes.ts`(`createRouter`)、`backend/src/recording.ts`(`RecordingStore`)、`backend/src/roomAdmin.ts`(`RoomAdminService`)。
- Produces: `backend/src/standalone.ts` — 新的 production entrypoint（不透過 nginx/docker-compose，直接跑 `node dist/standalone.js` 或打包後的 bundle）。

**為什麼需要 Step 6、7（`routes.ts`/`merge.ts` 的環境變數覆蓋）：**
`routes.ts` 現有的 `const recordingsDir = path.resolve(process.cwd(), '../recordings')`（模組頂層常數，import 當下就算好）假設 cwd 是 `backend/`，所以 `../recordings` 會落在 repo 根目錄——這在現有 `tsx watch`/Docker 開發流程下是對的。但打包後的 `LiveMR.bat` 用意是把資料放在 `LiveMR/data/recordings`，而不是 repo 根目錄，且這個值必須在 `standalone.ts` 的 `import { createRouter } from './routes.js'` **執行之前**就確定（ESM 的 `import` 一律先於模組內其他程式碼執行，所以沒辦法在 `standalone.ts` 的 `main()` 函式裡才設定這個 env var──必須由啟動它的父行程，也就是 `LiveMR.bat`，在呼叫 `node` 之前就用 `set` 設好）。`merge.ts` 的 ffmpeg 路徑同理，但因為那段是寫在函式內部（呼叫時才算），理論上可以晚一點設，這裡為了一致性一樣改用同一套「由 `.bat` 設定環境變數」的做法（見 Task 5 的 `LiveMR.bat` 樣板）。

- [ ] **Step 1: 寫失敗測試（安全標頭）**

```typescript
// backend/src/launcher/security.test.ts
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import express from 'express'
import { securityHeaders } from './security.js'

describe('securityHeaders', () => {
  it('sets all security headers matching the existing nginx config', async () => {
    const app = express()
    app.use(securityHeaders('192.168.1.50'))
    app.get('/', (_req, res) => res.send('ok'))

    const res = await request(app).get('/')

    expect(res.headers['strict-transport-security']).toBe('max-age=31536000')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN')
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' wss://192.168.1.50 blob:; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; upgrade-insecure-requests",
    )
  })

  it('interpolates the given server name into connect-src', async () => {
    const app = express()
    app.use(securityHeaders('10.0.0.5'))
    app.get('/', (_req, res) => res.send('ok'))

    const res = await request(app).get('/')
    expect(res.headers['content-security-policy']).toContain('wss://10.0.0.5')
  })
})
```

- [ ] **Step 2: 執行測試,確認失敗**

Run: `cd backend && npx vitest run src/launcher/security.test.ts`
Expected: FAIL（找不到模組 `./security.js`）

- [ ] **Step 3: 實作 `backend/src/launcher/security.ts`**

```typescript
import type { RequestHandler } from 'express'

/**
 * 對應現有 nginx/default.conf.template 443 server block 的安全標頭，逐字搬過來
 * （見 docs/superpowers/plans/2026-07-20-native-launcher-packaging.md 的 Global
 * Constraints）。serverName 對應 nginx 設定裡的 ${SERVER_NAME}，用於 CSP 的
 * connect-src wss:// 來源。
 */
export function securityHeaders(serverName: string): RequestHandler {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' wss://${serverName} blob:`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    'upgrade-insecure-requests',
  ].join('; ')

  return (_req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'SAMEORIGIN')
    res.setHeader('Content-Security-Policy', csp)
    next()
  }
}
```

- [ ] **Step 4: 執行測試,確認通過**

Run: `cd backend && npx vitest run src/launcher/security.test.ts`
Expected: PASS（2 tests）

- [ ] **Step 5: 安裝反向代理依賴**

Run: `cd backend && npm install http-proxy-middleware`

- [ ] **Step 6: 讓 `recordingsDir` 可用環境變數覆蓋（先寫測試）**

```typescript
// backend/src/routes.recordingsDir.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest'

describe('routes.ts recordingsDir resolution', () => {
  const ORIGINAL_ENV = process.env.RECORDINGS_DIR

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.RECORDINGS_DIR
    else process.env.RECORDINGS_DIR = ORIGINAL_ENV
  })

  it('falls back to process.cwd()/../recordings when RECORDINGS_DIR is unset', async () => {
    delete process.env.RECORDINGS_DIR
    vi.resetModules()
    const path = await import('node:path')
    const { __TEST_ONLY_recordingsDir } = await import('./routes.js')
    expect(__TEST_ONLY_recordingsDir()).toBe(path.resolve(process.cwd(), '../recordings'))
  })

  it('uses RECORDINGS_DIR when set', async () => {
    process.env.RECORDINGS_DIR = '/tmp/livemr-recordings'
    vi.resetModules()
    const path = await import('node:path')
    const { __TEST_ONLY_recordingsDir } = await import('./routes.js')
    expect(__TEST_ONLY_recordingsDir()).toBe(path.resolve('/tmp/livemr-recordings'))
  })
})
```

Run: `cd backend && npx vitest run src/routes.recordingsDir.test.ts`
Expected: FAIL（`__TEST_ONLY_recordingsDir` 尚未存在）

把 `backend/src/routes.ts` 第 11 行：

```typescript
const recordingsDir = path.resolve(process.cwd(), '../recordings')
```

改成：

```typescript
const recordingsDir = process.env.RECORDINGS_DIR
  ? path.resolve(process.env.RECORDINGS_DIR)
  : path.resolve(process.cwd(), '../recordings')

/** 供測試讀取目前解析出的 recordingsDir（模組頂層常數，import 當下就固定）。 */
export function __TEST_ONLY_recordingsDir(): string {
  return recordingsDir
}
```

Run: `cd backend && npx vitest run src/routes.recordingsDir.test.ts src/routes.recording.test.ts src/routes.test.ts`
Expected: PASS（新測試 2 個通過；既有 `routes.recording.test.ts`/`routes.test.ts` 行為不變，因為沒設 `RECORDINGS_DIR` 時走原本的 fallback）

- [ ] **Step 7: 讓 ffmpeg 執行檔路徑可用環境變數覆蓋**

把 `backend/src/merge.ts` 裡 `runFFmpeg` 函式中的：

```typescript
    const ffmpegExecutable = (ffmpegPath as unknown as string) || 'ffmpeg';
```

改成：

```typescript
    const ffmpegExecutable = process.env.FFMPEG_PATH || (ffmpegPath as unknown as string) || 'ffmpeg';
```

（用途：打包後 esbuild 會把 `ffmpeg-static` 一併 bundle 進單一檔案，導致它內部依賴 `__dirname` 去找 `ffmpeg.exe` 的邏輯失準——因為 bundle 後的 `__dirname` 指向 `app/`，不是原本 `node_modules/ffmpeg-static/`。與其修 esbuild 設定，直接讓 `LiveMR.bat` 用環境變數指到 Task 5 已經複製好的 `bin/ffmpeg.exe`，繞開這個問題。這段沒有專屬 unit test——`merge.ts` 本來就沒有 unit test，維持現況，改動只在 Task 5 的手動驗證裡一併確認錄製合成有正常產出 `output.mp4`。）

- [ ] **Step 8: 實作 `backend/src/standalone.ts`**

```typescript
import dotenv from 'dotenv'
import path from 'node:path'
import fs from 'node:fs'
import https from 'node:https'
import { fileURLToPath } from 'node:url'
import { exec } from 'node:child_process'
import express from 'express'
import cors from 'cors'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { RoomStore } from './rooms.js'
import { createRouter } from './routes.js'
import { RecordingStore } from './recording.js'
import { RoomAdminService } from './roomAdmin.js'
import { detectLanIp } from './launcher/network.js'
import { ensureCert } from './launcher/certs.js'
import { buildLivekitConfig } from './launcher/livekitConfig.js'
import { LiveKitProcess } from './launcher/livekitProcess.js'
import { securityHeaders } from './launcher/security.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 可攜式資料夾配置（見 scripts/build-launcher.mjs 組裝出的最終目錄結構）：
//   LiveMR/app/standalone.bundle.cjs  ← 本檔案打包後的位置（__dirname 即 app/）
//   LiveMR/app/frontend-dist/         ← 前端 build 產物
//   LiveMR/bin/livekit-server.exe
//   LiveMR/data/certs/
//   LiveMR/data/recordings/
const APP_DIR = __dirname
const ROOT_DIR = path.resolve(APP_DIR, '..')
const BIN_DIR = path.join(ROOT_DIR, 'bin')
const DATA_DIR = path.join(ROOT_DIR, 'data')
const FRONTEND_DIST = path.join(APP_DIR, 'frontend-dist')

const envPath = path.join(ROOT_DIR, 'launcher.env')
if (fs.existsSync(envPath)) dotenv.config({ path: envPath })

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey'
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'devsecret1234567890devsecret1234567890'
const LIVEKIT_PORT = 7880
const HTTPS_PORT = parseInt(process.env.LIVEMR_PORT || '443', 10)

async function main(): Promise<void> {
  const ip = detectLanIp()
  if (!ip) {
    console.error('無法偵測區網 IP，請確認已連上網路（Wi-Fi/網路線）。')
    process.exit(1)
  }

  const { certPath, keyPath } = await ensureCert(path.join(DATA_DIR, 'certs'), ip)

  const livekitConfig = buildLivekitConfig({
    nodeIp: ip,
    apiKey: LIVEKIT_API_KEY,
    apiSecret: LIVEKIT_API_SECRET,
    port: LIVEKIT_PORT,
  })
  const livekit = new LiveKitProcess()
  await livekit.start({
    binPath: path.join(BIN_DIR, 'livekit-server.exe'),
    configYaml: livekitConfig,
    workDir: DATA_DIR,
    port: LIVEKIT_PORT,
  })

  process.env.LIVEKIT_URL = `ws://127.0.0.1:${LIVEKIT_PORT}`
  process.env.LIVEKIT_API_KEY = LIVEKIT_API_KEY
  process.env.LIVEKIT_API_SECRET = LIVEKIT_API_SECRET

  const app = express()
  app.disable('x-powered-by')
  app.use(cors({ origin: [`https://${ip}`] }))
  app.use(securityHeaders(ip))
  app.use(express.json({ limit: '25mb' }))

  const store = new RoomStore()
  const recordingStore = new RecordingStore()
  const roomAdmin = new RoomAdminService()

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))
  app.use('/api', createRouter(store, { recordingStore, roomAdmin }))

  const livekitProxy = createProxyMiddleware({
    target: `http://127.0.0.1:${LIVEKIT_PORT}`,
    changeOrigin: true,
    ws: true,
    pathRewrite: { '^/livekit': '' },
  })
  app.use('/livekit', livekitProxy)

  app.use(express.static(FRONTEND_DIST))
  // Express 5（path-to-regexp v8）不再接受裸的 '*'，SPA fallback 要用具名萬用字元。
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(FRONTEND_DIST, 'index.html')))

  const CLEANUP_INTERVAL = 5 * 60 * 1000
  const ROOM_TTL = 2 * 60 * 60 * 1000
  setInterval(() => store.cleanup(ROOM_TTL), CLEANUP_INTERVAL)

  const credentials = {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  }
  const server = https.createServer(credentials, app)
  // http-proxy-middleware 的 WebSocket 代理需要手動接上 http server 的 upgrade 事件
  server.on('upgrade', livekitProxy.upgrade as never)

  server.listen(HTTPS_PORT, '0.0.0.0', () => {
    const url = `https://${ip}${HTTPS_PORT === 443 ? '' : ':' + HTTPS_PORT}`
    console.log(`\nLiveMR 已啟動：${url}\n（第一次連線瀏覽器會跳「不安全連線」警告，屬正常現象，按「進階」→「繼續」即可）\n`)
    if (!process.env.GEMINI_API_KEY) {
      console.warn('提醒：尚未設定 GEMINI_API_KEY，AI 助理功能將無法使用。請編輯 launcher.env 後重新啟動。')
    }
    exec(`start "" "${url}"`)
  })

  const shutdown = async (): Promise<void> => {
    console.log('\n正在關閉服務…')
    await livekit.stop()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 3000)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('啟動失敗：', err)
  process.exit(1)
})
```

- [ ] **Step 9: 執行完整 backend 測試套件與型別檢查**

Run: `cd backend && npm test && npx tsc --noEmit`
Expected: 測試除既有 2 個不相關失敗外全數 PASS（含新的 `routes.recordingsDir.test.ts`）；`tsc --noEmit` 無錯誤

- [ ] **Step 10: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/launcher/security.ts backend/src/launcher/security.test.ts backend/src/routes.ts backend/src/routes.recordingsDir.test.ts backend/src/merge.ts backend/src/standalone.ts
git commit -m "feat(launcher): 新增安全標頭 middleware 與 standalone HTTPS 伺服器入口，recordingsDir/ffmpeg 路徑可用環境變數覆蓋"
```

> **手動驗證（本任務 + Task 3 的 `LiveKitProcess`，需要 Task 5 的產物才能完整執行，先記錄步驟，實際執行排在 Task 5 之後）：**
> 1. 準備一份 `frontend/dist`（`cd frontend && npm run build`）複製到 `backend/dist-standalone-test/frontend-dist`（暫時手動放置，正式的資料夾組裝在 Task 5）。
> 2. 把 Task 5 下載好的 `livekit-server.exe` 放到對應 `bin/` 位置。
> 3. `cd backend && npx tsc && node dist/standalone.js`（或先用 `npx tsx src/standalone.ts` 快速跑，不用等 build）。
> 4. 確認終端機印出 `https://<你的區網IP>` 且瀏覽器自動開啟；用手機（同 Wi-Fi）開同一個網址，接受憑證警告後能看到首頁。
> 5. 建一個房間、用手機掃碼加入，確認鏡頭畫面能雙向看到（驗證 `/livekit` reverse proxy 的 WebSocket 代理有正常運作）。
> 6. Ctrl+C 關閉後，用工作管理員或 `Get-Process livekit-server -ErrorAction SilentlyContinue` 確認沒有殘留的 `livekit-server.exe` 行程。

---

### Task 5: 下載腳本 + 打包組裝

**Files:**
- Create: `scripts/fetch-livekit-server.mjs`
- Create: `scripts/fetch-portable-node.mjs`
- Create: `scripts/build-launcher.mjs`
- Create（若不存在）或 Modify（若已存在）: repo 根目錄 `package.json`（新增 `devDependencies.esbuild`）
- Modify: `.gitignore`

**Interfaces:**
- Produces（執行期產物，皆不進 git）：`.build-cache/livekit-server.exe`、`.build-cache/node-win-x64/`、`dist-launcher/LiveMR/`（最終可攜式資料夾）。
- Consumes: Task 4 的 `backend/src/standalone.ts`（作為 esbuild 的 entry point）、`frontend/dist`（`npm run build` 產物）。

- [ ] **Step 1: 更新 `.gitignore`**

在檔案的 `dist` / `dist-ssr` 那幾行附近加入：

```
.build-cache/
dist-launcher/
```

- [ ] **Step 2: 建立根目錄 `package.json` 並安裝 esbuild**

`scripts/build-launcher.mjs` 位於 repo 根目錄的 `scripts/`，Node 的 ESM 模組解析只會往上找 `<root>/node_modules`，不會找到裝在 `backend/node_modules` 裡的套件（兩者是平行目錄，不是父子關係）。所以 esbuild 要裝在根目錄，不是 `backend/`。

Run: `ls package.json 2>/dev/null || echo "not found"` — 確認 repo 根目錄目前沒有 `package.json`（若已存在，改成在既有檔案的 `devDependencies` 加 `esbuild`，跳過建立新檔案這步）。

建立根目錄 `package.json`：

```json
{
  "name": "live-mr-tooling",
  "private": true,
  "type": "module",
  "devDependencies": {
    "esbuild": "^0.24.0"
  }
}
```

Run: `npm install`（在 repo 根目錄執行）

- [ ] **Step 3: 建立 `scripts/fetch-livekit-server.mjs`**

```javascript
// 下載 LiveKit 官方 Windows binary release，解壓縮出 livekit-server.exe。
// 用法：node scripts/fetch-livekit-server.mjs
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CACHE_DIR = path.join(ROOT, '.build-cache')

const LIVEKIT_VERSION = '1.13.4'
const ASSET_NAME = `livekit_${LIVEKIT_VERSION}_windows_amd64.zip`
const URL = `https://github.com/livekit/livekit/releases/download/v${LIVEKIT_VERSION}/${ASSET_NAME}`

function download(url, destPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close()
        fs.unlinkSync(destPath)
        if (redirectsLeft <= 0) { reject(new Error('Too many redirects')); return }
        resolve(download(res.headers.location, destPath, redirectsLeft - 1))
        return
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${res.statusCode} for ${url}`))
        return
      }
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
    }).on('error', reject)
  })
}

async function main() {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  const zipPath = path.join(CACHE_DIR, ASSET_NAME)
  const exePath = path.join(CACHE_DIR, 'livekit-server.exe')

  if (fs.existsSync(exePath)) {
    console.log(`已存在 ${exePath}，略過下載。刪除該檔案可強制重新下載。`)
    return
  }

  console.log(`下載 ${URL} ...`)
  await download(URL, zipPath)

  console.log('解壓縮中...')
  execFileSync('powershell', [
    '-NoProfile', '-Command',
    `Expand-Archive -Path "${zipPath}" -DestinationPath "${CACHE_DIR}" -Force`,
  ])

  if (!fs.existsSync(exePath)) {
    throw new Error(`解壓縮後找不到 ${exePath}，請確認官方 zip 內容結構是否變更。`)
  }
  fs.unlinkSync(zipPath)
  console.log(`完成：${exePath}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
```

- [ ] **Step 4: 建立 `scripts/fetch-portable-node.mjs`**

```javascript
// 下載 Node.js 官方 Windows 可攜式 zip（免安裝），解壓縮成 .build-cache/node-win-x64/。
// 用法：node scripts/fetch-portable-node.mjs
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CACHE_DIR = path.join(ROOT, '.build-cache')

const NODE_VERSION = '22.18.0'
const DIST_NAME = `node-v${NODE_VERSION}-win-x64`
const URL = `https://nodejs.org/dist/v${NODE_VERSION}/${DIST_NAME}.zip`

function download(url, destPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close()
        fs.unlinkSync(destPath)
        if (redirectsLeft <= 0) { reject(new Error('Too many redirects')); return }
        resolve(download(res.headers.location, destPath, redirectsLeft - 1))
        return
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${res.statusCode} for ${url}`))
        return
      }
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
    }).on('error', reject)
  })
}

async function main() {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  const zipPath = path.join(CACHE_DIR, `${DIST_NAME}.zip`)
  const extractedDir = path.join(CACHE_DIR, DIST_NAME)
  const targetDir = path.join(CACHE_DIR, 'node-win-x64')

  if (fs.existsSync(targetDir)) {
    console.log(`已存在 ${targetDir}，略過下載。刪除該資料夾可強制重新下載。`)
    return
  }

  console.log(`下載 ${URL} ...`)
  await download(URL, zipPath)

  console.log('解壓縮中...')
  execFileSync('powershell', [
    '-NoProfile', '-Command',
    `Expand-Archive -Path "${zipPath}" -DestinationPath "${CACHE_DIR}" -Force`,
  ])
  fs.unlinkSync(zipPath)

  fs.renameSync(extractedDir, targetDir)
  console.log(`完成：${targetDir}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
```

- [ ] **Step 5: 建立 `scripts/build-launcher.mjs`**

```javascript
// 組裝最終可攜式 LiveMR/ 資料夾：esbuild 打包 backend standalone entry、
// build 前端、複製 livekit-server.exe / node.exe / ffmpeg.exe，產生 LiveMR.bat。
// 前置：先跑過 node scripts/fetch-livekit-server.mjs 與 node scripts/fetch-portable-node.mjs。
// 用法：node scripts/build-launcher.mjs
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CACHE_DIR = path.join(ROOT, '.build-cache')
const OUT_DIR = path.join(ROOT, 'dist-launcher', 'LiveMR')

function requireCached(relPath, hint) {
  const full = path.join(CACHE_DIR, relPath)
  if (!fs.existsSync(full)) {
    throw new Error(`找不到 ${full}。請先執行：${hint}`)
  }
  return full
}

async function main() {
  const livekitExe = requireCached('livekit-server.exe', 'node scripts/fetch-livekit-server.mjs')
  const nodeDir = requireCached('node-win-x64', 'node scripts/fetch-portable-node.mjs')

  fs.rmSync(OUT_DIR, { recursive: true, force: true })
  fs.mkdirSync(path.join(OUT_DIR, 'bin'), { recursive: true })
  fs.mkdirSync(path.join(OUT_DIR, 'app'), { recursive: true })
  fs.mkdirSync(path.join(OUT_DIR, 'data'), { recursive: true })

  console.log('打包 backend...')
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'backend', 'src', 'standalone.ts')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    // 輸出 CJS（而非 ESM）：backend 的依賴混雜 ESM/CJS，esbuild 對「bundle 成 CJS」
    // 的 interop 處理比「bundle 成 ESM 又要手動 shim require()」更成熟可靠。
    // .cjs 副檔名讓 Node 明確以 CommonJS 執行，不受旁邊任何 package.json 的
    // "type": "module" 影響。esbuild 會自動把原始碼裡的 import.meta.url 轉成
    // CJS 相容寫法，standalone.ts 不需要為了這件事改寫。
    format: 'cjs',
    outfile: path.join(OUT_DIR, 'app', 'standalone.bundle.cjs'),
  })

  console.log('Build 前端...')
  execFileSync('npm', ['run', 'build'], { cwd: path.join(ROOT, 'frontend'), stdio: 'inherit', shell: true })
  fs.cpSync(path.join(ROOT, 'frontend', 'dist'), path.join(OUT_DIR, 'app', 'frontend-dist'), { recursive: true })

  console.log('複製 binary...')
  fs.copyFileSync(livekitExe, path.join(OUT_DIR, 'bin', 'livekit-server.exe'))
  fs.cpSync(nodeDir, path.join(OUT_DIR, 'bin', 'node-runtime'), { recursive: true })
  // ffmpeg-static 下載時已把 binary 放進 backend/node_modules/ffmpeg-static/ffmpeg.exe
  const ffmpegSrc = path.join(ROOT, 'backend', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe')
  if (!fs.existsSync(ffmpegSrc)) {
    throw new Error(`找不到 ${ffmpegSrc}，請先在 backend/ 執行過 npm install。`)
  }
  fs.copyFileSync(ffmpegSrc, path.join(OUT_DIR, 'bin', 'ffmpeg.exe'))

  const launcherBat = `@echo off
chcp 65001 > nul
title LiveMR
cd /d "%~dp0"
set "RECORDINGS_DIR=%~dp0data\\recordings"
set "FFMPEG_PATH=%~dp0bin\\ffmpeg.exe"
"%~dp0bin\\node-runtime\\node.exe" "%~dp0app\\standalone.bundle.cjs"
pause
`
  fs.writeFileSync(path.join(OUT_DIR, 'LiveMR.bat'), launcherBat)

  // GEMINI_API_KEY 沒有預設值可用（不像 LIVEKIT_API_KEY/SECRET 有 devkey 這種本地
  // 開發用預設值），AI 助理功能沒設就完全無法運作。附一份範本檔 + 說明，
  // 讓老師知道要編輯這個檔案，而不是啟動後才發現 AI 助理悄悄壞掉。
  const launcherEnv = `# 編輯這個檔案設定 AI 助理需要的金鑰，存檔後重新啟動 LiveMR.bat 生效。
# 到 https://aistudio.google.com/apikey 免費取得金鑰。
GEMINI_API_KEY=
`
  fs.writeFileSync(path.join(OUT_DIR, 'launcher.env'), launcherEnv)

  console.log(`\n完成：${OUT_DIR}\n雙擊 LiveMR.bat 即可啟動。\n若要使用 AI 助理，記得先編輯 LiveMR/launcher.env 填入 GEMINI_API_KEY。`)
}

main().catch((err) => { console.error(err); process.exit(1) })
```

- [ ] **Step 6: 實際執行三個腳本,產生可攜式資料夾**

Run:
```bash
node scripts/fetch-livekit-server.mjs
node scripts/fetch-portable-node.mjs
node scripts/build-launcher.mjs
```
Expected: 三個指令依序成功，`dist-launcher/LiveMR/` 底下出現 `LiveMR.bat`、`launcher.env`、`bin/livekit-server.exe`、`bin/node-runtime/node.exe`、`bin/ffmpeg.exe`、`app/standalone.bundle.cjs`、`app/frontend-dist/index.html`

> 若這台開發機的 Node/curl 對外連線因 Avast TLS 攔截出現 `UNABLE_TO_VERIFY_LEAF_SIGNATURE` 或 `unable to verify the first certificate`，比照專案既有慣例（`env-node-avast-ca` memory）在跑腳本前設定 `NODE_OPTIONS=--use-system-ca`。

- [ ] **Step 7: 手動驗證完整啟動流程（銜接 Task 3、Task 4 標注的手動驗證）**

1. 先不動 `launcher.env`，雙擊（或在終端機執行）`dist-launcher/LiveMR/LiveMR.bat`，確認終端機印出「尚未設定 GEMINI_API_KEY」的提醒。關閉、編輯 `launcher.env` 填入一把真的 Gemini API key，再重新啟動一次，確認提醒不再出現。
2. 確認：自動偵測到區網 IP、產生憑證（`dist-launcher/LiveMR/data/certs/cert.pem` 出現）、LiveKit 子行程啟動、瀏覽器自動開啟 `https://<LAN_IP>`。
3. 用另一台裝置（手機/平板，同 Wi-Fi）開同一網址，接受憑證警告，掃碼加入房間，確認鏡頭雙向可見（WebRTC 媒體正常）。
4. 測試錄製：開始錄製 → 老師與學生各自說話 → 停止錄製 → 到 `dist-launcher/LiveMR/data/recordings/` 確認 `output.mp4` 產生且有兩人的聲音。
5. 測試 AI 助理：老師端切到「AI 助理」分頁、開始互動，確認能正常生成提示（驗證 `GEMINI_API_KEY` 真的有從 `launcher.env` 讀進來）。
6. 關閉終端機視窗（或 Ctrl+C），確認沒有殘留的 `livekit-server.exe` / `node.exe` 子行程。

- [ ] **Step 8: Commit**

```bash
git add scripts/fetch-livekit-server.mjs scripts/fetch-portable-node.mjs scripts/build-launcher.mjs package.json package-lock.json .gitignore
git commit -m "feat(launcher): 新增下載腳本與打包組裝腳本，產生可攜式 LiveMR 資料夾"
```

---

### Task 6: 移除 Docker/Compose/Tunnel 相關檔案，更新文件

**Files:**
- Delete: `docker-compose.yml`
- Delete: `nginx/`（整個目錄）
- Delete: `livekit.yaml.template`
- Delete: `setup.ps1`
- Delete: `start.bat`
- Delete: `start-tunnel.bat`
- Delete: `start-tunnel.ps1`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/TECH_STACK.md`
- Modify: `docs/dev-setup.md`
- Modify: `docs/USER_GUIDE.md`（僅「系統需求」/啟動方式相關描述，其餘不動）
- Modify: `README.md`

**Interfaces:** 無（純檔案移除與文件更新，不影響程式介面）。

- [ ] **Step 1: 確認沒有程式碼還在引用即將刪除的檔案**

Run: `grep -rn "docker-compose\|livekit.yaml.template\|nginx/default.conf" backend/src frontend/src scripts/ 2>/dev/null || echo "clean"`
Expected: 除了文件（`.md`）以外，`backend/src`、`frontend/src`、`scripts/` 底下沒有任何引用。

- [ ] **Step 2: 刪除 Docker/腳本檔案**

```bash
git rm -r docker-compose.yml nginx/ livekit.yaml.template setup.ps1 start.bat start-tunnel.bat start-tunnel.ps1
```

- [ ] **Step 3: 更新 `docs/ARCHITECTURE.md`**

把第 3 節「部署與執行拓撲」整節內容（含拓撲圖與服務職責表格）改成描述新架構：單一 `standalone.js`（Node/Express）負責 TLS 終止、serve 前端靜態檔、`/api/*` 路由、`/livekit/*` 反向代理；`livekit-server.exe` 為本機子行程、單機模式無 Redis。拓撲圖改成：

```
                       瀏覽器（老師 / 學生 / 大屏）
                              │  HTTPS / WSS  :443
                              ▼
                    ┌──────────────────────────┐
                    │  standalone.js（Node）     │  TLS 終止 + 路徑分流
                    │  serve 前端靜態檔           │
                    └──────────────────────────┘
            ┌─────────────┬──────────────────────┐
            │ /api/*      │ /livekit/*            │
            ▼             ▼                       │
   ┌────────────────┐ ┌──────────────────────┐   │
   │ 內建 Express    │ │ livekit-server.exe   │   │
   │ route（同行程）  │ │ （子行程，127.0.0.1）  │◀──┘
   └────────────────┘ └──────────────────────┘
```

第 9 節「外部相依與設定」表格裡 `mkcert` 那一列改成：「Node `selfsigned` 套件——本機/區網開發環境下之 HTTPS 憑證自動化產生（`backend/src/launcher/certs.ts`），取代 mkcert/openssl」。

第 10 節「已知技術債與重構規劃」加一條：「封裝細節：`docs/superpowers/specs/2026-07-17-local-only-packaging-design.md` 與 `docs/superpowers/plans/2026-07-20-native-launcher-packaging.md`」。

附錄「關鍵檔案速查」表格「部署」那一列改成 `backend/src/launcher/`、`backend/src/standalone.ts`、`scripts/build-launcher.mjs`。

- [ ] **Step 4: 更新 `docs/TECH_STACK.md`**

第 4 節「基礎設施與部署層」整段改寫：拿掉「容器化技術：Docker & Docker Compose」、「Web 伺服器/反向代理：Nginx」、「mkcert」、「OpenSSL」、「Cloudflare Tunnel」、「Git」這幾條，改成：

```markdown
* **執行環境封裝**: 可攜式資料夾（`bin/node-runtime`、`bin/livekit-server.exe`、`bin/ffmpeg.exe` + 打包後的 backend），雙擊 `LiveMR.bat` 啟動，不需安裝 Docker / Git / OpenSSL。
* **TLS 終止 / 反向代理**: Node 內建 `https` 模組直接終止 TLS，`http-proxy-middleware` 反代 `/livekit/*` 給本機 LiveKit 子行程。
* **憑證**: `selfsigned`（純 JS 產生自簽憑證，SAN 綁區網 IP）。
* **LiveKit 執行**: 原生 Windows binary（`livekit-server.exe`），單機模式（無 Redis）。
```

- [ ] **Step 5: 更新 `docs/dev-setup.md`**

讀取檔案內容後，把所有引用 `docker compose`、`setup.ps1`、`.env` 的 SERVER_NAME/NGINX_PORT 環境變數啟動流程段落，改成描述新的啟動方式：`cd backend && npx tsx src/standalone.ts`（開發模式，需先手動跑過 `node scripts/fetch-livekit-server.mjs`）。跨裝置憑證設定的說明改成「執行一次 standalone 入口，會自動在 `data/certs/` 產生綁定目前偵測到的區網 IP 的憑證」。

- [ ] **Step 6: 更新 `docs/USER_GUIDE.md`**

只改「系統需求」小節裡跟啟動方式相關的敘述（若有提到 docker/setup.ps1），加一句「老師端啟動：解壓縮後雙擊 `LiveMR.bat`，免安裝其他軟體」。不動其他教學內容章節。

- [ ] **Step 7: 更新 `README.md`**

把現有的 Vite 樣板內容替換成簡短的專案說明 + 指向 `docs/ARCHITECTURE.md`（技術文件）與 `docs/USER_GUIDE.md`（使用說明）的連結，並加一段「老師端啟動」：解壓縮 `LiveMR` 資料夾、雙擊 `LiveMR.bat`。

- [ ] **Step 8: 全文搜尋確認無殘留引用**

Run: `grep -rln "docker-compose\|docker compose\|setup\.ps1\|start-tunnel\|cloudflared\|mkcert" docs/*.md README.md 2>/dev/null`
Expected: 若有殘留，逐一確認是否為「明確歷史記錄/已移除說明」的合理保留（例如 `docs/recording-flow.md` 已有的「不再有 server-side Egress」歷史敘述），非此類的一律清掉。

- [ ] **Step 9: 執行完整測試套件（確認刪檔沒有動到程式邏輯）**

Run: `cd backend && npm test && cd ../frontend && npm test && npm run build`
Expected: 結果與 Task 5 執行前一致（backend 除 2 個既有不相關失敗外全綠、frontend 全綠、build 成功）

- [ ] **Step 10: Commit**

```bash
git add docs/ARCHITECTURE.md docs/TECH_STACK.md docs/dev-setup.md docs/USER_GUIDE.md README.md
git commit -m "docs+chore: 移除 Docker/Compose/Tunnel 相關檔案，更新文件反映原生封裝架構"
```
