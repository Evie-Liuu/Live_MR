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
