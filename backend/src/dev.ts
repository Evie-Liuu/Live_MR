import express from 'express'
import cors from 'cors'
import { RoomStore } from './rooms.js'
import { createRouter } from './routes.js'
import { RecordingStore } from './recording.js'
import { RoomAdminService } from './roomAdmin.js'

// 對應 scripts/dev-livekit.ts 起的 dev 用 LiveKit（僅 localhost，devkey/devsecret 為固定值）。
process.env.LIVEKIT_URL = 'ws://127.0.0.1:7880'
process.env.LIVEKIT_API_KEY = 'devkey'
process.env.LIVEKIT_API_SECRET = 'devsecret1234567890devsecret1234567890'

const app = express()
app.disable('x-powered-by')
// Vite dev server（:5173）用 proxy 轉發 /api，瀏覽器本身視角是同源請求；
// 這裡的 CORS 設定只在有人直接對 :3001 發請求（例如用 curl/Postman 除錯）時才用得到。
app.use(cors({ origin: 'http://localhost:5173' }))
app.use(express.json({ limit: '25mb' }))

const store = new RoomStore()
const recordingStore = new RecordingStore()
const roomAdmin = new RoomAdminService()

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))
app.use('/api', createRouter(store, { recordingStore, roomAdmin }))

const CLEANUP_INTERVAL = 5 * 60 * 1000
const ROOM_TTL = 2 * 60 * 60 * 1000
setInterval(() => store.cleanup(ROOM_TTL), CLEANUP_INTERVAL)

const PORT = 3001
app.listen(PORT, () => {
  console.log(`Dev backend listening on http://localhost:${PORT}（配合 frontend 的 Vite dev server 使用，不要直接打開這個網址）`)
})
