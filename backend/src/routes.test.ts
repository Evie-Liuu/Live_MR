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

  describe('GET /api/rooms/:roomId/events (SSE)', () => {
    it('returns 404 for unknown room', async () => {
      const res = await request(app).get('/api/rooms/nonexistent/events')
      expect(res.status).toBe(404)
    })

    it('returns SSE headers for existing room', async () => {
      const createRes = await request(app).post('/api/rooms')
      const { roomId } = createRes.body

      // We need to handle the SSE connection carefully - it stays open
      // Use a short timeout approach
      const res = await new Promise<request.Response>((resolve) => {
        const req = request(app)
          .get(`/api/rooms/${roomId}/events`)
          .buffer(true)
          .parse((res, cb) => {
            let data = ''
            res.on('data', (chunk: Buffer) => { data += chunk.toString() })
            // Resolve after getting headers
            setTimeout(() => {
              (res as any).destroy();
              cb(null, data)
            }, 100)
          })
        req.then(resolve)
      })

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('text/event-stream')
      expect(res.headers['cache-control']).toBe('no-cache')
    })

    it('sends pending requests on connect', async () => {
      const createRes = await request(app).post('/api/rooms')
      const { roomId } = createRes.body

      // Add a pending request before connecting SSE
      store.addJoinRequest(roomId, 'Alice')

      const body = await new Promise<string>((resolve) => {
        const req = request(app)
          .get(`/api/rooms/${roomId}/events`)
          .buffer(true)
          .parse((res, cb) => {
            let data = ''
            res.on('data', (chunk: Buffer) => { data += chunk.toString() })
            setTimeout(() => {
              (res as any).destroy();
              cb(null, data)
            }, 100)
          })
        req.then((res) => resolve(res.body as string))
      })

      expect(body).toContain('"type":"join-request"')
      expect(body).toContain('Alice')
    })
  })
})
