import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootEnvPath = path.resolve(__dirname, '../../.env')
const localEnvPath = path.resolve(__dirname, '../../.env.development.local')

// Try loading .env.development.local first, then .env
if (fs.existsSync(localEnvPath)) {
  dotenv.config({ path: localEnvPath })
} else if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath })
}
import express from 'express'
import cors from 'cors'
import { RoomStore } from './rooms.js'
import { createRouter } from './routes.js'
import { RecordingStore } from './recording.js'
import { EgressService } from './egress.js'

const app = express()
app.disable('x-powered-by')

// Derive allowed origins from env.
// ALLOWED_ORIGINS overrides (comma-separated list, e.g. for Cloudflare Tunnel domains).
// Falls back to https://<SERVER_NAME>[:<NGINX_PORT>] when SERVER_NAME is present.
const rawOrigins = process.env.ALLOWED_ORIGINS
  ?? (() => {
    const host = process.env.SERVER_NAME
    if (!host) return ''
    const port = process.env.NGINX_PORT ?? '443'
    return port === '443' ? `https://${host}` : `https://${host}:${port}`
  })()
const allowedOrigins = rawOrigins.split(',').map(o => o.trim()).filter(Boolean)

app.use(cors({ origin: allowedOrigins.length > 0 ? allowedOrigins : false }))
app.use(express.json({ limit: '25mb' }))

const store = new RoomStore()
const recordingStore = new RecordingStore()
const egressService = new EgressService()

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api', createRouter(store, { recordingStore, egressService }))

// Cleanup expired rooms every 5 minutes (TTL = 2 hours)
const CLEANUP_INTERVAL = 5 * 60 * 1000
const ROOM_TTL = 2 * 60 * 60 * 1000
setInterval(() => store.cleanup(ROOM_TTL), CLEANUP_INTERVAL)

const PORT = parseInt(process.env.PORT || '3001', 10)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend listening on port ${PORT} at 0.0.0.0`)
})

export { app, store }
