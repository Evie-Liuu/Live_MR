import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import fs from 'fs'
import { RoomStore } from './rooms.js'
import { RecordingStore } from './recording.js'
import { createRouter } from './routes.js'
import type { RoomAdminService } from './roomAdmin.js'

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  const promises = {
    ...actual.promises,
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  }
  // Node's real 'fs' module also exposes a `default` export equal to the whole
  // module object (CJS/ESM interop; not represented in @types/node's namespace
  // type, hence the cast) — `import fs from 'fs'` resolves through THIS, not the
  // named `promises` export below. Without patching it too, the override is dead
  // code: routes.ts's `import fs from 'fs'` (and this test file's own) would
  // silently fall through to the real, unmocked fs.promises and write actual
  // files to disk on every test run.
  const actualDefault = (actual as unknown as { default?: typeof actual }).default
  return {
    ...actual,
    promises,
    default: {
      ...actualDefault,
      promises,
    },
  }
})

function buildMockRoomAdmin(overrides: Partial<RoomAdminService> = {}): RoomAdminService {
  return {
    muteTrack: vi.fn().mockResolvedValue(undefined),
    removeParticipant: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as RoomAdminService
}

function createApp(
  store: RoomStore,
  recordingStore: RecordingStore,
  roomAdmin: RoomAdminService,
) {
  const app = express()
  app.use(express.json())
  app.use('/api', createRouter(store, { recordingStore, roomAdmin }))
  return app
}

describe('Recording Routes', () => {
  let store: RoomStore
  let recordingStore: RecordingStore
  let roomAdmin: RoomAdminService
  let app: ReturnType<typeof express>
  let roomId: string

  beforeEach(async () => {
    store = new RoomStore()
    recordingStore = new RecordingStore()
    roomAdmin = buildMockRoomAdmin()
    app = createApp(store, recordingStore, roomAdmin)
    vi.clearAllMocks()
    const res = await request(app).post('/api/rooms')
    roomId = res.body.roomId
  })

  describe('POST /api/rooms/:roomId/recording/start', () => {
    it('returns sessionId and status recording', async () => {
      const res = await request(app).post(`/api/rooms/${roomId}/recording/start`).send({})
      expect(res.status).toBe(200)
      expect(res.body.sessionId).toBeDefined()
      expect(res.body.status).toBe('recording')
    })

    it('returns 409 if already recording', async () => {
      await request(app).post(`/api/rooms/${roomId}/recording/start`).send({})
      const res = await request(app).post(`/api/rooms/${roomId}/recording/start`).send({})
      expect(res.status).toBe(409)
    })

    it('returns 404 for unknown room', async () => {
      const res = await request(app).post('/api/rooms/nonexistent/recording/start').send({})
      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/rooms/:roomId/recording/stop', () => {
    it('returns sessionId and status stopped', async () => {
      await request(app).post(`/api/rooms/${roomId}/recording/start`).send({})
      const res = await request(app).post(`/api/rooms/${roomId}/recording/stop`).send({})
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('stopped')
    })

    it('returns 404 if no active recording', async () => {
      const res = await request(app).post(`/api/rooms/${roomId}/recording/stop`).send({})
      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/rooms/:roomId/recordings', () => {
    it('returns empty array when no recordings', async () => {
      const res = await request(app).get(`/api/rooms/${roomId}/recordings`)
      expect(res.status).toBe(200)
      expect(res.body.recordings).toEqual([])
    })

    it('returns active session with status recording', async () => {
      await request(app).post(`/api/rooms/${roomId}/recording/start`).send({})
      const res = await request(app).get(`/api/rooms/${roomId}/recordings`)
      expect(res.body.recordings).toHaveLength(1)
      expect(res.body.recordings[0].status).toBe('recording')
    })

    it('stopped session has status stopped', async () => {
      await request(app).post(`/api/rooms/${roomId}/recording/start`).send({})
      const stopRes = await request(app).post(`/api/rooms/${roomId}/recording/stop`).send({})
      expect(stopRes.body.status).toBe('stopped')
      expect(stopRes.body.sessionId).toBeDefined()
    })
  })

  describe('POST /api/rooms/:roomId/recording/bigscreen', () => {
    it('returns 400 without X-Session-Id header', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/recording/bigscreen`)
        .set('Content-Type', 'video/webm')
        .send(Buffer.from('fake'))
      expect(res.status).toBe(400)
    })

    it('returns 200 and ok:true with valid upload', async () => {
      await request(app).post(`/api/rooms/${roomId}/recording/start`).send({})
      const sessionId = (
        await request(app).get(`/api/rooms/${roomId}/recordings`)
      ).body.recordings[0].sessionId

      const res = await request(app)
        .post(`/api/rooms/${roomId}/recording/bigscreen`)
        .set('Content-Type', 'video/webm')
        .set('X-Session-Id', sessionId)
        .send(Buffer.from('fake-webm-data'))
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
    })

    it('accepts Chinese participant identity in audio upload header', async () => {
      await request(app).post(`/api/rooms/${roomId}/recording/start`).send({})
      const sessionId = (
        await request(app).get(`/api/rooms/${roomId}/recordings`)
      ).body.recordings[0].sessionId

      const res = await request(app)
        .post(`/api/rooms/${roomId}/recording/audio`)
        .set('Content-Type', 'audio/webm')
        .set('X-Session-Id', sessionId)
        .set('X-Participant-Identity', encodeURIComponent('張小明'))
        .send(Buffer.from('fake-audio-data'))
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
    })

    it('saves iPad/Safari audio/mp4 upload with .mp4 extension, not .webm', async () => {
      await request(app).post(`/api/rooms/${roomId}/recording/start`).send({})
      const sessionId = (
        await request(app).get(`/api/rooms/${roomId}/recordings`)
      ).body.recordings[0].sessionId

      const res = await request(app)
        .post(`/api/rooms/${roomId}/recording/audio`)
        .set('Content-Type', 'audio/mp4')
        .set('X-Session-Id', sessionId)
        .set('X-Participant-Identity', encodeURIComponent('alice'))
        .send(Buffer.from('fake-mp4-audio-data'))

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)

      const writeFileMock = vi.mocked(fs.promises.writeFile)
      const savedPath = writeFileMock.mock.calls[0]![0] as string
      expect(savedPath).toMatch(/audio_alice\.mp4$/)
    })
  })

  describe('GET /api/recordings/:roomId/:sessionId/:filename', () => {
    it('returns 400 for path traversal attempt', async () => {
      const res = await request(app).get(
        `/api/recordings/${roomId}/sess-1/..%2F..%2Fetc%2Fpasswd`,
      )
      expect(res.status).toBe(400)
    })

    it('returns 404 for non-existent file', async () => {
      const res = await request(app).get(
        `/api/recordings/${roomId}/sess-1/bigscreen.webm`,
      )
      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/rooms/:roomId/participants/:identity/mute', () => {
    it('calls roomAdmin.muteTrack and returns success', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/participants/alice/mute`)
        .send({ trackType: 'audio', muted: true })
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(roomAdmin.muteTrack).toHaveBeenCalledWith(roomId, 'alice', 'audio', true)
    })

    it('returns 400 if trackType missing', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/participants/alice/mute`)
        .send({ muted: true })
      expect(res.status).toBe(400)
    })

    it('returns 500 if muteTrack throws', async () => {
      vi.mocked(roomAdmin.muteTrack).mockRejectedValueOnce(new Error('no track'))
      const res = await request(app)
        .post(`/api/rooms/${roomId}/participants/alice/mute`)
        .send({ trackType: 'audio', muted: true })
      expect(res.status).toBe(500)
    })
  })
})
