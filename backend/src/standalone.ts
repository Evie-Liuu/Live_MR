import dotenv from 'dotenv'
import path from 'node:path'
import fs from 'node:fs'
import https from 'node:https'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import express from 'express'
import cors from 'cors'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { RoomStore } from './rooms.js'
import { createRouter } from './routes.js'
import { RecordingStore } from './recording.js'
import { RoomAdminService } from './roomAdmin.js'
import { detectLanIp } from './launcher/network.js'
import { ensureCert } from './launcher/certs.js'
import { trustCaLocally } from './launcher/trustStore.js'
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

  const { certPath, keyPath, caCertPath } = await ensureCert(path.join(DATA_DIR, 'certs'), ip)
  trustCaLocally(caCertPath)

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
  // 弱點掃描修正：明確限制允許的 HTTP 方法，僅開放 API 實際需要的項目，
  // 移除預設包含的 PUT、DELETE，避免 Access-Control-Allow-Methods 暴露不必要的高風險方法。
  app.use(cors({
    origin: [`https://${ip}`],
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  }))
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

  // 比照 frontend/nginx.conf（commit e25895c）：關閉 ETag/Last-Modified，避免洩漏 build 時間戳。
  // 弱點掃描修正 — 靜態資源快取分層策略：
  //   /assets/*：Vite 在 hash 化的檔名中已確保內容唯一，可長期快取（immutable）。
  //   其餘（含 index.html）：no-cache，強制瀏覽器每次向伺服器驗證，但允許重複使用已驗證的快取。
  // 兩者皆覆蓋 securityHeaders 設定的全域 Cache-Control: no-store，
  // 因為靜態資源不含敏感資料，允許較寬鬆的快取以提升效能。
  app.use(
    '/assets',
    express.static(path.join(FRONTEND_DIST, 'assets'), {
      etag: false,
      lastModified: false,
      setHeaders(res) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      },
    }),
  )
  app.use(
    express.static(FRONTEND_DIST, {
      etag: false,
      lastModified: false,
      setHeaders(res) {
        res.setHeader('Cache-Control', 'no-cache')
      },
    }),
  )
  // Express 5（path-to-regexp v8）不再接受裸的 '*'，SPA fallback 要用具名萬用字元。
  app.get('/{*splat}', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'))
  })

  const CLEANUP_INTERVAL = 5 * 60 * 1000
  const ROOM_TTL = 2 * 60 * 60 * 1000
  setInterval(() => store.cleanup(ROOM_TTL), CLEANUP_INTERVAL)

  const credentials: https.ServerOptions = {
    // leaf 憑證後面附上簽發它的 CA 憑證，讓交握時鏈是完整的（驗證端仍需自行信任
    // 這張 CA 才能真正驗證通過，但至少不會因為鏈不完整而多出「憑證鏈不完整」的弱掃項目）。
    cert: `${fs.readFileSync(certPath, 'utf8')}\n${fs.readFileSync(caCertPath, 'utf8')}`,
    key: fs.readFileSync(keyPath),
    // 弱點掃描修正：僅允許具前向保密的 AEAD 加密套件（ECDHE + GCM/ChaCha20-Poly1305），
    // 停用靜態 RSA 金鑰交換、AES-CBC 與 HMAC-SHA1 等已不建議使用的舊式套件。
    minVersion: 'TLSv1.2',
    honorCipherOrder: true,
    ciphers: [
      'TLS_AES_256_GCM_SHA384',
      'TLS_CHACHA20_POLY1305_SHA256',
      'TLS_AES_128_GCM_SHA256',
      'ECDHE-ECDSA-AES128-GCM-SHA256',
      'ECDHE-RSA-AES128-GCM-SHA256',
      'ECDHE-ECDSA-AES256-GCM-SHA384',
      'ECDHE-RSA-AES256-GCM-SHA384',
      'ECDHE-ECDSA-CHACHA20-POLY1305',
      'ECDHE-RSA-CHACHA20-POLY1305',
    ].join(':'),
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
    // spawn（argv 陣列）而非 exec（shell 字串），即使 url 目前只由本機偵測到的
    // IP/port 組成、並非外部可控輸入，仍避免任何字串經過 shell 解析的注入風險。
    spawn('cmd.exe', ['/c', 'start', '""', url], { shell: false, windowsHide: true })
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
