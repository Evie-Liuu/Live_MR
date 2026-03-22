import express from 'express'
import cors from 'cors'
import { RoomStore } from './rooms.js'
import { createRouter } from './routes.js'

const app = express()
app.use(cors())
app.use(express.json())

const store = new RoomStore()

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api', createRouter(store))

// Cleanup expired rooms every 5 minutes (TTL = 2 hours)
const CLEANUP_INTERVAL = 5 * 60 * 1000
const ROOM_TTL = 2 * 60 * 60 * 1000
setInterval(() => store.cleanup(ROOM_TTL), CLEANUP_INTERVAL)

const PORT = parseInt(process.env.PORT || '3001', 10)
app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`)
})

export { app, store }
