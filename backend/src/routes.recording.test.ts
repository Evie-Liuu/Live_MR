import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import { RoomStore } from './rooms.js'
import { RecordingStore } from './recording.js'
import { createRouter } from './routes.js'
import type { EgressService } from './egress.js'

function buildMockEgressService(overrides: Partial<EgressService> = {}): EgressService {
  return {
    startRecording: vi.fn().mockResolvedValue({
      compositeEgressId: 'egress-composite-1',
      trackEgressIds: { alice: 'egress-track-alice' },
    }),
    stopRecording: vi.fn().mockResolvedValue(undefined),
    muteTrack: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as EgressService
}

function createApp(
  store: RoomStore,
  recordingStore: RecordingStore,
  egressService: EgressService,
) {
  const app = express()
  app.use(express.json())
  app.use('/api', createRouter(store, { recordingStore, egressService }))
  return app
}

describe('Recording Routes', () => {
  let store: RoomStore
  let recordingStore: RecordingStore
  let egressService: EgressService
  let app: ReturnType<typeof express>
  let roomId: string

  beforeEach(async () => {
    store = new RoomStore()
    recordingStore = new RecordingStore()
    egressService = buildMockEgressService()
    app = createApp(store, recordingStore, egressService)
    const res = await request(app).post('/api/rooms')
    roomId = res.body.roomId
  })

  describe('POST /api/rooms/:roomId/recording/start', () => {
    it('returns sessionId and status recording', async () => {
      const res = await request(app).post(`/api/rooms/${roomId}/recording/start`)
      expect(res.status).toBe(200)
      expect(res.body.sessionId).toBeDefined()
      expect(res.body.status).toBe('recording')
    })

    it('calls egressService.startRecording', async () => {
      await request(app).post(`/api/rooms/${roomId}/recording/start`)
      expect(egressService.startRecording).toHaveBeenCalledWith(roomId, expect.any(String))
    })

    it('returns 409 if already recording', async () => {
      await request(app).post(`/api/rooms/${roomId}/recording/start`)
      const res = await request(app).post(`/api/rooms/${roomId}/recording/start`)
      expect(res.status).toBe(409)
    })

    it('returns 404 for unknown room', async () => {
      const res = await request(app).post('/api/rooms/nonexistent/recording/start')
      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/rooms/:roomId/recording/stop', () => {
    it('returns sessionId and status stopped', async () => {
      await request(app).post(`/api/rooms/${roomId}/recording/start`)
      const res = await request(app).post(`/api/rooms/${roomId}/recording/stop`)
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('stopped')
    })

    it('calls egressService.stopRecording', async () => {
      await request(app).post(`/api/rooms/${roomId}/recording/start`)
      await request(app).post(`/api/rooms/${roomId}/recording/stop`)
      expect(egressService.stopRecording).toHaveBeenCalledWith(
        'egress-composite-1',
        { alice: 'egress-track-alice' },
      )
    })

    it('returns 404 if no active recording', async () => {
      const res = await request(app).post(`/api/rooms/${roomId}/recording/stop`)
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
      await request(app).post(`/api/rooms/${roomId}/recording/start`)
      const res = await request(app).get(`/api/rooms/${roomId}/recordings`)
      expect(res.body.recordings).toHaveLength(1)
      expect(res.body.recordings[0].status).toBe('recording')
    })
  })

  describe('POST /api/rooms/:roomId/participants/:identity/mute', () => {
    it('calls egressService.muteTrack and returns success', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/participants/alice/mute`)
        .send({ trackType: 'audio', muted: true })
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(egressService.muteTrack).toHaveBeenCalledWith(roomId, 'alice', 'audio', true)
    })

    it('returns 400 if trackType missing', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/participants/alice/mute`)
        .send({ muted: true })
      expect(res.status).toBe(400)
    })

    it('returns 500 if muteTrack throws', async () => {
      vi.mocked(egressService.muteTrack).mockRejectedValueOnce(new Error('no track'))
      const res = await request(app)
        .post(`/api/rooms/${roomId}/participants/alice/mute`)
        .send({ trackType: 'audio', muted: true })
      expect(res.status).toBe(500)
    })
  })
})
