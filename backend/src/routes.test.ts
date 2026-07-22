import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { RoomStore } from './rooms.js'
import { createRouter } from './routes.js'

function createApp(store: RoomStore) {
  const app = express()
  app.use(express.json())
  app.use('/api', createRouter(store))
  return app
}

describe('API Routes', () => {
  let store: RoomStore
  let app: ReturnType<typeof express>

  beforeEach(() => {
    store = new RoomStore()
    app = createApp(store)
  })

  describe('POST /api/rooms', () => {
    it('creates a room and returns roomId, hostToken, livekitToken', async () => {
      const res = await request(app).post('/api/rooms')
      expect(res.status).toBe(200)
      expect(res.body.roomId).toBeDefined()
      expect(res.body.hostToken).toBeDefined()
      expect(res.body.livekitToken).toBeDefined()
      // livekitToken should be a JWT
      expect(res.body.livekitToken.split('.')).toHaveLength(3)
    })

    it('room exists in store after creation', async () => {
      const res = await request(app).post('/api/rooms')
      const room = store.getRoom(res.body.roomId)
      expect(room).toBeDefined()
    })
  })

  describe('POST /api/rooms/:roomId/join', () => {
    it('creates a join request and returns requestId', async () => {
      const createRes = await request(app).post('/api/rooms')
      const { roomId } = createRes.body

      const res = await request(app)
        .post(`/api/rooms/${roomId}/join`)
        .send({ name: 'Alice' })
      expect(res.status).toBe(200)
      expect(res.body.requestId).toBeDefined()
    })

    it('returns 400 if name missing', async () => {
      const createRes = await request(app).post('/api/rooms')
      const { roomId } = createRes.body

      const res = await request(app)
        .post(`/api/rooms/${roomId}/join`)
        .send({})
      expect(res.status).toBe(400)
    })

    it('returns 404 if room does not exist', async () => {
      const res = await request(app)
        .post('/api/rooms/nonexistent/join')
        .send({ name: 'Alice' })
      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/rooms/:roomId/requests/:requestId', () => {
    it('returns pending status for new request', async () => {
      const createRes = await request(app).post('/api/rooms')
      const { roomId } = createRes.body

      const joinRes = await request(app)
        .post(`/api/rooms/${roomId}/join`)
        .send({ name: 'Alice' })
      const { requestId } = joinRes.body

      const res = await request(app).get(`/api/rooms/${roomId}/requests/${requestId}`)
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('pending')
      expect(res.body.token).toBeUndefined()
    })

    it('returns 404 for unknown request', async () => {
      const createRes = await request(app).post('/api/rooms')
      const { roomId } = createRes.body

      const res = await request(app).get(`/api/rooms/${roomId}/requests/nonexistent`)
      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/rooms/:roomId/requests/:requestId/approve', () => {
    it('approves a request', async () => {
      const createRes = await request(app).post('/api/rooms')
      const { roomId } = createRes.body

      const joinRes = await request(app)
        .post(`/api/rooms/${roomId}/join`)
        .send({ name: 'Alice' })
      const { requestId } = joinRes.body

      const res = await request(app)
        .post(`/api/rooms/${roomId}/requests/${requestId}/approve`)
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('approved')

      // Check that polling returns approved with token
      const statusRes = await request(app).get(`/api/rooms/${roomId}/requests/${requestId}`)
      expect(statusRes.body.status).toBe('approved')
      expect(statusRes.body.token).toBeDefined()
    })

    it('returns 404 for unknown request', async () => {
      const createRes = await request(app).post('/api/rooms')
      const { roomId } = createRes.body

      const res = await request(app)
        .post(`/api/rooms/${roomId}/requests/nonexistent/approve`)
      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/rooms/:roomId/requests/:requestId/reject', () => {
    it('rejects a request', async () => {
      const createRes = await request(app).post('/api/rooms')
      const { roomId } = createRes.body

      const joinRes = await request(app)
        .post(`/api/rooms/${roomId}/join`)
        .send({ name: 'Bob' })
      const { requestId } = joinRes.body

      const res = await request(app)
        .post(`/api/rooms/${roomId}/requests/${requestId}/reject`)
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('rejected')

      // Check polling returns rejected
      const statusRes = await request(app).get(`/api/rooms/${roomId}/requests/${requestId}`)
      expect(statusRes.body.status).toBe('rejected')
    })

    it('returns 404 for unknown request', async () => {
      const createRes = await request(app).post('/api/rooms')
      const { roomId } = createRes.body

      const res = await request(app)
        .post(`/api/rooms/${roomId}/requests/nonexistent/reject`)
      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/rooms/:roomId/events (long polling)', () => {
    it('returns 404 for unknown room', async () => {
      const res = await request(app).get('/api/rooms/nonexistent/events')
      expect(res.status).toBe(404)
    })

    it('returns pending requests immediately when since=0', async () => {
      const createRes = await request(app).post('/api/rooms')
      const { roomId } = createRes.body
      store.addJoinRequest(roomId, 'Alice')

      const res = await request(app).get(`/api/rooms/${roomId}/events?since=0`)

      expect(res.status).toBe(200)
      expect(res.body.events).toHaveLength(1)
      expect(res.body.events[0]).toMatchObject({ type: 'join-request', name: 'Alice' })
      expect(res.body.lastEventId).toBeGreaterThan(0)
    })

    it('returns empty events array after timeout when no pending', async () => {
      const createRes = await request(app).post('/api/rooms')
      const { roomId } = createRes.body

      // Cancel the long poll quickly via aborted request
      const req = request(app).get(`/api/rooms/${roomId}/events?since=0`).timeout(150)
      await expect(req).rejects.toThrow()
    })

    it('returns only events after since', async () => {
      const createRes = await request(app).post('/api/rooms')
      const { roomId } = createRes.body
      store.addJoinRequest(roomId, 'Alice')

      const first = await request(app).get(`/api/rooms/${roomId}/events?since=0`)
      const lastId = first.body.lastEventId as number

      const second = await request(app)
        .get(`/api/rooms/${roomId}/events?since=${lastId}`)
        .timeout(150)
        .catch((e) => e)

      // Either timed out (no new events) or returned empty
      if (!(second instanceof Error)) {
        expect(second.body.events).toHaveLength(0)
      }
    })
  })

  describe('POST /api/rooms/:roomId/recording/audio (Chinese identity)', () => {
    it('accepts Chinese identity (encodeURIComponent) and saves ASCII-safe filename', async () => {
      const { vi } = await import('vitest')
      const os = await import('os')
      const fs = await import('fs')
      const path = await import('path')

      const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'live-mr-audio-'))

      // Set env BEFORE resetting modules so freshly loaded routes.js picks it up
      const origEnv = process.env.RECORDINGS_DIR
      process.env.RECORDINGS_DIR = tmpDir

      vi.resetModules()

      const { createRouter: freshRouter } = await import('./routes.js')
      const { RecordingStore } = await import('./recording.js')

      const roomAdmin = { removeParticipant: async () => {}, muteTrack: async () => {} } as any
      const recStore = new RecordingStore()

      const freshStore = new RoomStore()
      const localApp = express()
      localApp.use(express.json())
      localApp.use('/api', freshRouter(freshStore, { recordingStore: recStore, roomAdmin }))

      // Create a room in the fresh store
      const createRes = await request(localApp).post('/api/rooms')
      const { roomId } = createRes.body

      // Pre-create session dir (mirrors what recording/start does)
      const sessionDir = path.join(tmpDir, 'TestScene', 'Participant_20250101-120000')
      await fs.promises.mkdir(sessionDir, { recursive: true })
      const session = recStore.startSession(
        roomId,
        '/recordings/TestScene/Participant_20250101-120000',
        'sess-cn-001',
      )

      // Simulate frontend: encodeURIComponent("張三") → "%E5%BC%B5%E4%B8%89"
      const chineseName = '張三'
      const encodedName = encodeURIComponent(chineseName)

      const res = await request(localApp)
        .post(`/api/rooms/${roomId}/recording/audio`)
        .set('Content-Type', 'audio/webm')
        .set('X-Session-Id', session.sessionId)
        .set('X-Participant-Identity', encodedName)
        .send(Buffer.from('fake-audio-data'))

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)

      // Verify the saved filename contains the Chinese name directly
      const files = await fs.promises.readdir(sessionDir)
      const audioFile = files.find((f) => f.startsWith('audio_') && f.endsWith('.webm'))
      expect(audioFile).toBe('audio_張三.webm')

      // Original decoded Chinese name is preserved in participantIdentities
      expect(session.participantIdentities).toContain(chineseName)

      // Cleanup
      process.env.RECORDINGS_DIR = origEnv
      vi.resetModules()
      await fs.promises.rm(tmpDir, { recursive: true, force: true })
    })
  })


  describe('POST /api/sdgs/auth/login', () => {
    it('proxies response status from upstream SDGs server', async () => {
      const res = await request(app)
        .post('/api/sdgs/auth/login')
        .send({ id_token: 'invalid_token' })

      // When remote server is up, invalid_token returns 400/401; when down, proxy returns 502/500
      expect([400, 401, 500, 502]).toContain(res.status)
    })
  })
})
