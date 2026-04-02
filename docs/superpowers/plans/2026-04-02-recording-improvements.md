# Recording Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four recording issues: BigScreen canvas capture instead of LiveKit composite, correct file paths on stop, and a file download endpoint.

**Architecture:** BigScreen records its own WebGL canvas via `MediaRecorder`, uploads the blob to a new backend endpoint on stop. Backend derives file paths from session metadata instead of accepting them as a parameter. A file-serving endpoint streams files from `./recordings/`.

**Tech Stack:** Node.js/Express, TypeScript, Vitest/Supertest, React, MediaRecorder API, BroadcastChannel API.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `backend/src/recording.ts` | Modify | Add `basePath`, `participantIdentities`; fix `stopSession` |
| `backend/src/recording.test.ts` | Modify | Update tests to new signatures |
| `backend/src/egress.ts` | Modify | Remove composite egress; add `participantIdentities` to result |
| `backend/src/routes.ts` | Modify | Pass new args to `startSession`; fix `stopSession` call; add bigscreen upload + file download endpoints |
| `backend/src/routes.recording.test.ts` | Modify | Update mocks and add tests for new endpoints |
| `nginx/default.conf` | Modify | Add `client_max_body_size 300m` to allow video upload |
| `frontend/src/hooks/useRecording.ts` | Modify | Accept `channelRef`; broadcast `recording-start`/`recording-stop` |
| `frontend/src/components/HostSession.tsx` | Modify | Store `bigscreen-roomId` in sessionStorage; pass `channelRef` to hook |
| `frontend/src/components/BigScreen.tsx` | Modify | Handle recording messages; capture canvas; upload blob |

---

## Task 1: Fix RecordingStore

**Files:**
- Modify: `backend/src/recording.ts`
- Modify: `backend/src/recording.test.ts`

- [ ] **Step 1: Write failing tests for new signatures**

Replace the full contents of `backend/src/recording.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { RecordingStore } from './recording.js'

describe('RecordingStore', () => {
  let store: RecordingStore

  beforeEach(() => {
    store = new RecordingStore()
  })

  it('starts a session and returns it', () => {
    const session = store.startSession(
      'room-1',
      { alice: 'egress-alice', bob: 'egress-bob' },
      '/recordings/room-1/sess-1',
      ['alice', 'bob'],
    )
    expect(session.sessionId).toBeDefined()
    expect(session.status).toBe('recording')
    expect(session.trackEgressIds).toEqual({ alice: 'egress-alice', bob: 'egress-bob' })
    expect(session.basePath).toBe('/recordings/room-1/sess-1')
    expect(session.participantIdentities).toEqual(['alice', 'bob'])
    expect(session.files).toEqual([])
  })

  it('getActiveSession returns session while recording', () => {
    store.startSession('room-1', {}, '/recordings/room-1/s1', [])
    expect(store.getActiveSession('room-1')?.status).toBe('recording')
  })

  it('getActiveSession returns null when no active session', () => {
    expect(store.getActiveSession('room-1')).toBeNull()
  })

  it('stopSession marks session stopped and populates files', () => {
    store.startSession('room-1', {}, '/recordings/room-1/sess-1', ['alice', 'bob'])
    const stopped = store.stopSession('room-1')
    expect(stopped!.status).toBe('stopped')
    expect(stopped!.files).toEqual([
      '/recordings/room-1/sess-1/bigscreen.webm',
      '/recordings/room-1/sess-1/audio_alice.ogg',
      '/recordings/room-1/sess-1/audio_bob.ogg',
    ])
  })

  it('stopSession with no participants only includes bigscreen', () => {
    store.startSession('room-1', {}, '/recordings/room-1/s1', [])
    const stopped = store.stopSession('room-1')
    expect(stopped!.files).toEqual(['/recordings/room-1/s1/bigscreen.webm'])
  })

  it('getActiveSession returns null after stop', () => {
    store.startSession('room-1', {}, '/recordings/room-1/s1', [])
    store.stopSession('room-1')
    expect(store.getActiveSession('room-1')).toBeNull()
  })

  it('listSessions returns all sessions for a room', () => {
    store.startSession('room-1', {}, '/recordings/room-1/s1', [])
    store.stopSession('room-1')
    store.startSession('room-1', {}, '/recordings/room-1/s2', [])
    expect(store.listSessions('room-1')).toHaveLength(2)
  })

  it('accepts an explicit sessionId', () => {
    const session = store.startSession('room-1', {}, '/recordings/room-1/s1', [], 'my-fixed-id')
    expect(session.sessionId).toBe('my-fixed-id')
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd backend && npm test -- recording.test
```

Expected: multiple failures (wrong signatures).

- [ ] **Step 3: Rewrite recording.ts**

Replace the full contents of `backend/src/recording.ts`:

```ts
import { randomUUID } from 'crypto'

export interface RecordingSession {
  sessionId: string
  trackEgressIds: Record<string, string>   // identity → egressId
  status: 'recording' | 'stopped'
  startedAt: number
  files: string[]
  basePath: string
  participantIdentities: string[]
}

export class RecordingStore {
  // roomId → all sessions (most recent last)
  private sessions = new Map<string, RecordingSession[]>()

  startSession(
    roomId: string,
    trackEgressIds: Record<string, string>,
    basePath: string,
    participantIdentities: string[],
    sessionId?: string,
  ): RecordingSession {
    const session: RecordingSession = {
      sessionId: sessionId ?? randomUUID(),
      trackEgressIds,
      status: 'recording',
      startedAt: Date.now(),
      files: [],
      basePath,
      participantIdentities,
    }
    const list = this.sessions.get(roomId) ?? []
    list.push(session)
    this.sessions.set(roomId, list)
    return session
  }

  getActiveSession(roomId: string): RecordingSession | null {
    const list = this.sessions.get(roomId) ?? []
    return list.find((s) => s.status === 'recording') ?? null
  }

  stopSession(roomId: string): RecordingSession | null {
    const session = this.getActiveSession(roomId)
    if (!session) return null
    session.status = 'stopped'
    session.files = [
      `${session.basePath}/bigscreen.webm`,
      ...session.participantIdentities.map((id) => `${session.basePath}/audio_${id}.ogg`),
    ]
    return session
  }

  listSessions(roomId: string): RecordingSession[] {
    return this.sessions.get(roomId) ?? []
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd backend && npm test -- recording.test
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/recording.ts backend/src/recording.test.ts
git commit -m "refactor: RecordingStore derives file paths from basePath on stop"
```

---

## Task 2: Update EgressService

**Files:**
- Modify: `backend/src/egress.ts`

- [ ] **Step 1: Update egress.ts**

Replace the full contents of `backend/src/egress.ts`:

```ts
import {
  EgressClient,
  RoomServiceClient,
  EncodedFileOutput,
  EncodedFileType,
  TrackSource,
  TrackType,
} from 'livekit-server-sdk'

const API_KEY = (process.env.LIVEKIT_API_KEY || 'devkey').trim()
const API_SECRET = (process.env.LIVEKIT_API_SECRET || 'devsecret1234567890devsecret1234567890').trim()
const _lkUrl = (process.env.LIVEKIT_URL || process.env.LIVEKIT_SERVER_URL || 'ws://livekit:7880').trim()
const SERVER_URL = _lkUrl.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://')

export interface StartRecordingResult {
  trackEgressIds: Record<string, string>   // identity → egressId
  participantIdentities: string[]
}

export class EgressService {
  private egress: EgressClient
  private roomService: RoomServiceClient

  constructor(serverUrl = SERVER_URL, apiKey = API_KEY, apiSecret = API_SECRET) {
    this.egress = new EgressClient(serverUrl, apiKey, apiSecret)
    this.roomService = new RoomServiceClient(serverUrl, apiKey, apiSecret)
  }

  async startRecording(
    roomId: string,
    sessionId: string,
  ): Promise<StartRecordingResult> {
    const basePath = `/recordings/${roomId}/${sessionId}`

    // Per-participant audio track egress
    const participants = await this.roomService.listParticipants(roomId)
    const trackEgressIds: Record<string, string> = {}
    const participantIdentities: string[] = []

    for (const participant of participants) {
      const audioTrack = participant.tracks.find(
        (t) => t.source === TrackSource.MICROPHONE,
      )
      if (!audioTrack) continue

      const audioOutput = new EncodedFileOutput({
        fileType: EncodedFileType.OGG,
        filepath: `${basePath}/audio_${participant.identity}.ogg`,
        disableManifest: true,
      })
      const trackInfo = await this.egress.startTrackCompositeEgress(
        roomId,
        audioOutput,
        { audioTrackId: audioTrack.sid },
      )
      trackEgressIds[participant.identity] = trackInfo.egressId
      participantIdentities.push(participant.identity)
    }

    return { trackEgressIds, participantIdentities }
  }

  async stopRecording(
    trackEgressIds: Record<string, string>,
  ): Promise<void> {
    for (const egressId of Object.values(trackEgressIds)) {
      await this.egress.stopEgress(egressId)
    }
  }

  async muteTrack(
    roomId: string,
    identity: string,
    trackType: 'audio' | 'video',
    muted: boolean,
  ): Promise<void> {
    const participant = await this.roomService.getParticipant(roomId, identity)
    if (!participant) {
      throw new Error(`Participant ${identity} not found in room ${roomId}`)
    }

    const kind = trackType === 'audio' ? TrackType.AUDIO : TrackType.VIDEO
    const source = trackType === 'audio' ? TrackSource.MICROPHONE : TrackSource.CAMERA

    let track = participant.tracks.find((t) => t.source === source)
    if (!track) {
      track = participant.tracks.find((t) => t.type === kind)
    }

    if (!track) {
      // No published track — effectively already in the desired state
      return
    }

    await this.roomService.mutePublishedTrack(roomId, identity, track.sid, muted)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/egress.ts
git commit -m "refactor: remove composite egress, return participantIdentities"
```

---

## Task 3: Update Routes

**Files:**
- Modify: `backend/src/routes.ts`
- Modify: `backend/src/routes.recording.test.ts`

- [ ] **Step 1: Write failing tests**

Replace the full contents of `backend/src/routes.recording.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import { RoomStore } from './rooms.js'
import { RecordingStore } from './recording.js'
import { createRouter } from './routes.js'
import type { EgressService } from './egress.js'

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    promises: {
      ...actual.promises,
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
    },
  }
})

function buildMockEgressService(overrides: Partial<EgressService> = {}): EgressService {
  return {
    startRecording: vi.fn().mockResolvedValue({
      trackEgressIds: { alice: 'egress-track-alice' },
      participantIdentities: ['alice'],
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
    vi.clearAllMocks()
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

    it('calls egressService.stopRecording with trackEgressIds', async () => {
      await request(app).post(`/api/rooms/${roomId}/recording/start`)
      await request(app).post(`/api/rooms/${roomId}/recording/stop`)
      expect(egressService.stopRecording).toHaveBeenCalledWith(
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

    it('stopped session includes files', async () => {
      await request(app).post(`/api/rooms/${roomId}/recording/start`)
      const startRes = await request(app).post(`/api/rooms/${roomId}/recording/start`)
      const sessionId = (
        await request(app).get(`/api/rooms/${roomId}/recordings`)
      ).body.recordings[0].sessionId

      await request(app).post(`/api/rooms/${roomId}/recording/stop`)
      const res = await request(app).get(`/api/rooms/${roomId}/recordings`)
      expect(res.body.recordings[0].files).toContain(
        expect.stringContaining('bigscreen.webm'),
      )
    })
  })

  describe('POST /api/rooms/:roomId/recording/bigscreen', () => {
    it('returns 400 without X-Session-Id header', async () => {
      await request(app).post(`/api/rooms/${roomId}/recording/start`)
      const res = await request(app)
        .post(`/api/rooms/${roomId}/recording/bigscreen`)
        .set('Content-Type', 'video/webm')
        .send(Buffer.from('fake'))
      expect(res.status).toBe(400)
    })

    it('returns 200 and ok:true with valid upload', async () => {
      await request(app).post(`/api/rooms/${roomId}/recording/start`)
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
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd backend && npm test -- routes.recording.test
```

Expected: failures on `stopRecording` call signature, missing bigscreen/download endpoints.

- [ ] **Step 3: Rewrite routes.ts**

Replace the full contents of `backend/src/routes.ts`:

```ts
import express, { Router, type Request, type Response } from 'express'
import path from 'path'
import fs from 'fs'
import { RoomStore } from './rooms.js'
import { createToken } from './livekit.js'
import type { RecordingStore } from './recording.js'
import type { EgressService } from './egress.js'

const recordingsDir = path.resolve(process.cwd(), '../recordings')

interface RecordingDeps {
  recordingStore: RecordingStore
  egressService: EgressService
}

export function createRouter(store: RoomStore, recording?: RecordingDeps): Router {
  const router = Router()

  // SSE 客户端室
  const sseClients = new Map<string, Set<Response>>()

  function notifyRoom(roomId: string, type: string, data: Record<string, unknown>): void {
    const clients = sseClients.get(roomId)
    if (!clients) return
    const payload = JSON.stringify({ type, ...data })
    for (const res of clients) {
      res.write(`data: ${payload}\n\n`)
    }
  }

  // POST /api/rooms — 建立房間
  router.post('/rooms', async (_req: Request, res: Response) => {
    try {
      const { roomId, hostToken } = store.createRoom()
      const hostId = `host-${Math.random().toString(36).substring(7)}`
      const livekitToken = await createToken(roomId, hostId, true)
      res.json({ roomId, hostToken, livekitToken })
    } catch (err) {
      res.status(500).json({ error: 'Failed to create room' })
    }
  })

  // POST /api/rooms/:roomId/join
  router.post('/rooms/:roomId/join', (req: Request, res: Response) => {
    const roomId = req.params.roomId as string
    const { name } = req.body as { name?: string }

    if (!name) {
      res.status(400).json({ error: 'Name is required' })
      return
    }

    const room = store.getRoom(roomId)
    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }

    const request = store.addJoinRequest(roomId, name)
    notifyRoom(roomId, 'join-request', {
      requestId: request.requestId,
      name: request.name,
    })
    res.json({ requestId: request.requestId })
  })

  // GET /api/rooms/:roomId/requests/:requestId
  router.get('/rooms/:roomId/requests/:requestId', (req: Request, res: Response) => {
    const roomId = req.params.roomId as string
    const requestId = req.params.requestId as string
    const request = store.getRequestStatus(roomId, requestId)

    if (!request) {
      res.status(404).json({ error: 'Request not found' })
      return
    }

    const response: Record<string, unknown> = { status: request.status }
    if (request.status === 'approved' && request.token) {
      response.token = request.token
    }
    res.json(response)
  })

  // POST /api/rooms/:roomId/requests/:requestId/approve
  router.post('/rooms/:roomId/requests/:requestId/approve', async (req: Request, res: Response) => {
    const roomId = req.params.roomId as string
    const requestId = req.params.requestId as string

    try {
      const request = store.getRequestStatus(roomId, requestId)
      if (!request) {
        res.status(404).json({ error: 'Request not found' })
        return
      }

      const livekitToken = await createToken(roomId, request.name, false)
      const approved = store.approveRequest(roomId, requestId, livekitToken)

      if (!approved) {
        res.status(404).json({ error: 'Request not found' })
        return
      }

      notifyRoom(roomId, 'request-approved', { requestId })
      res.json({ status: 'approved' })
    } catch (err) {
      res.status(500).json({ error: 'Failed to approve request' })
    }
  })

  // POST /api/rooms/:roomId/requests/:requestId/reject
  router.post('/rooms/:roomId/requests/:requestId/reject', (req: Request, res: Response) => {
    const roomId = req.params.roomId as string
    const requestId = req.params.requestId as string

    const rejected = store.rejectRequest(roomId, requestId)
    if (!rejected) {
      res.status(404).json({ error: 'Request not found' })
      return
    }

    notifyRoom(roomId, 'request-rejected', { requestId })
    res.json({ status: 'rejected' })
  })

  // GET /api/rooms/:roomId/events — SSE
  router.get('/rooms/:roomId/events', (req: Request, res: Response) => {
    const roomId = req.params.roomId as string
    const room = store.getRoom(roomId)

    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })
    res.flushHeaders()

    const pending = store.getPendingRequests(roomId)
    for (const req of pending) {
      const payload = JSON.stringify({ type: 'join-request', requestId: req.requestId, name: req.name })
      res.write(`data: ${payload}\n\n`)
    }

    if (!sseClients.has(roomId)) {
      sseClients.set(roomId, new Set())
    }
    sseClients.get(roomId)!.add(res)

    req.on('close', () => {
      const clients = sseClients.get(roomId)
      if (clients) {
        clients.delete(res)
        if (clients.size === 0) sseClients.delete(roomId)
      }
    })
  })

  // ── Recording endpoints ──────────────────────────────────────────────────────

  router.post('/rooms/:roomId/recording/start', async (req: Request, res: Response) => {
    if (!recording) { res.status(501).json({ error: 'Recording not configured' }); return }
    const roomId = req.params.roomId as string
    const room = store.getRoom(roomId)
    if (!room) { res.status(404).json({ error: 'Room not found' }); return }

    const existing = recording.recordingStore.getActiveSession(roomId)
    if (existing) { res.status(409).json({ error: 'Already recording' }); return }

    try {
      const { randomUUID } = await import('crypto')
      const sessionId = randomUUID()
      const basePath = `/recordings/${roomId}/${sessionId}`
      const { trackEgressIds, participantIdentities } = await recording.egressService.startRecording(
        roomId,
        sessionId,
      )
      const session = recording.recordingStore.startSession(
        roomId,
        trackEgressIds,
        basePath,
        participantIdentities,
        sessionId,
      )
      res.json({ sessionId: session.sessionId, status: session.status })
    } catch (err: any) {
      console.error('[recording/start] error:', err?.message ?? err, '| cause:', err?.cause)
      res.status(500).json({ error: 'Failed to start recording', detail: err?.cause?.message ?? err?.message ?? String(err) })
    }
  })

  router.post('/rooms/:roomId/recording/stop', async (req: Request, res: Response) => {
    if (!recording) { res.status(501).json({ error: 'Recording not configured' }); return }
    const roomId = req.params.roomId as string
    const session = recording.recordingStore.getActiveSession(roomId)
    if (!session) { res.status(404).json({ error: 'No active recording' }); return }

    try {
      await recording.egressService.stopRecording(session.trackEgressIds)
      const stopped = recording.recordingStore.stopSession(roomId)
      res.json({ sessionId: stopped!.sessionId, status: stopped!.status })
    } catch (err: any) {
      console.error('[recording/stop] error:', err?.message ?? err, '| cause:', err?.cause)
      res.status(500).json({ error: 'Failed to stop recording', detail: err?.cause?.message ?? err?.message ?? String(err) })
    }
  })

  router.get('/rooms/:roomId/recordings', (req: Request, res: Response) => {
    if (!recording) { res.json({ recordings: [] }); return }
    const roomId = req.params.roomId as string
    const recordings = recording.recordingStore.listSessions(roomId).map((s) => ({
      sessionId: s.sessionId,
      status: s.status,
      files: s.files,
      startedAt: s.startedAt,
    }))
    res.json({ recordings })
  })

  // POST /api/rooms/:roomId/recording/bigscreen — BigScreen canvas upload
  router.post(
    '/rooms/:roomId/recording/bigscreen',
    express.raw({ type: 'video/*', limit: '300mb' }),
    async (req: Request, res: Response) => {
      if (!recording) { res.status(501).json({ error: 'Recording not configured' }); return }
      const roomId = req.params.roomId as string
      const sessionId = req.headers['x-session-id'] as string | undefined
      if (!sessionId) {
        res.status(400).json({ error: 'X-Session-Id header required' })
        return
      }
      try {
        const dir = path.join(recordingsDir, roomId, sessionId)
        await fs.promises.mkdir(dir, { recursive: true })
        await fs.promises.writeFile(path.join(dir, 'bigscreen.webm'), req.body as Buffer)
        res.json({ ok: true })
      } catch (err: any) {
        console.error('[recording/bigscreen] error:', err?.message ?? err)
        res.status(500).json({ error: 'Failed to save bigscreen recording' })
      }
    },
  )

  // GET /api/recordings/:roomId/:sessionId/:filename — file download
  router.get('/recordings/:roomId/:sessionId/:filename', (req: Request, res: Response) => {
    const { roomId, sessionId, filename } = req.params as {
      roomId: string; sessionId: string; filename: string
    }
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      res.status(400).json({ error: 'Invalid filename' })
      return
    }
    const filePath = path.join(recordingsDir, roomId, sessionId, filename)
    res.download(filePath, filename, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'File not found' })
    })
  })

  router.post(
    '/rooms/:roomId/participants/:identity/mute',
    async (req: Request, res: Response) => {
      if (!recording) { res.status(501).json({ error: 'Recording not configured' }); return }
      const roomId = req.params.roomId as string
      const identity = req.params.identity as string
      const { trackType, muted } = req.body as { trackType?: string; muted?: boolean }

      if (trackType !== 'audio' && trackType !== 'video') {
        res.status(400).json({ error: 'trackType must be "audio" or "video"' })
        return
      }

      try {
        await recording.egressService.muteTrack(roomId, identity, trackType, muted ?? true)
        res.json({ success: true })
      } catch (err: any) {
        console.error('Failed to mute track:', err)
        res.status(500).json({ error: 'Failed to mute track', message: err.message })
      }
    },
  )

  return router
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd backend && npm test -- routes.recording.test
```

Expected: all tests pass. If `stopped session includes files` test is flaky due to index, fix: the test calls `recording/start` twice so `recordings[0]` might be wrong. The test is checking the first item; since both starts fail on the second (409), there is only one session — use `recordings[0]`.

- [ ] **Step 5: Run full test suite**

```bash
cd backend && npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes.ts backend/src/routes.recording.test.ts
git commit -m "feat: add bigscreen upload and file download endpoints; fix stopSession call"
```

---

## Task 4: Update Nginx for Large Uploads

**Files:**
- Modify: `nginx/default.conf`

- [ ] **Step 1: Add client_max_body_size to /api/ location**

In `nginx/default.conf`, add `client_max_body_size 300m;` inside the `/api/` location block:

```nginx
server {
    listen 443 ssl;
    server_name 192.168.0.145;

    ssl_certificate /etc/nginx/certs/cert.pem;
    ssl_certificate_key /etc/nginx/certs/key.pem;

    location /api/ {
        proxy_pass http://host.docker.internal:3001/api/;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 300m;
    }

    location / {
        proxy_pass http://host.docker.internal:5174;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /livekit/ {
        proxy_pass http://livekit:7880/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

- [ ] **Step 2: Restart nginx container**

```bash
docker compose restart nginx
```

- [ ] **Step 3: Commit**

```bash
git add nginx/default.conf
git commit -m "fix: allow up to 300MB uploads through nginx for bigscreen recording"
```

---

## Task 5: Frontend — useRecording Broadcasts Channel Signals

**Files:**
- Modify: `frontend/src/hooks/useRecording.ts`
- Modify: `frontend/src/components/HostSession.tsx`

- [ ] **Step 1: Update useRecording.ts**

Replace the full contents of `frontend/src/hooks/useRecording.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { Room, RoomEvent, Track } from 'livekit-client'
import {
  startRecording,
  stopRecording,
  getRecordings,
  muteParticipant,
} from '../api.ts'

export interface MuteState {
  audio: boolean
  video: boolean
}

export interface UseRecordingResult {
  isRecording: boolean
  sessionId: string | null
  start: () => Promise<void>
  stop: () => Promise<void>
  muteState: Record<string, MuteState>
  toggleMute: (identity: string, trackType: 'audio' | 'video') => Promise<void>
}

export function useRecording(
  roomId: string,
  room: Room | null,
  channelRef?: React.RefObject<BroadcastChannel | null>,
): UseRecordingResult {
  const [isRecording, setIsRecording] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [muteState, setMuteState] = useState<Record<string, MuteState>>({})

  // Restore recording state on mount
  useEffect(() => {
    if (!roomId) return
    getRecordings(roomId)
      .then((sessions) => {
        const active = sessions.find((s) => s.status === 'recording')
        if (active) {
          setIsRecording(true)
          setSessionId(active.sessionId)
        }
      })
      .catch(() => { /* backend may still be starting */ })
  }, [roomId])

  // Sync mute state from LiveKit room
  useEffect(() => {
    if (!room) return

    const buildMuteState = (): Record<string, MuteState> => {
      const state: Record<string, MuteState> = {}
      for (const [, participant] of room.remoteParticipants) {
        let audioMuted = false
        let videoMuted = false
        for (const [, pub] of participant.trackPublications) {
          if (pub.kind === Track.Kind.Audio) audioMuted = pub.isMuted
          if (pub.kind === Track.Kind.Video) videoMuted = pub.isMuted
        }
        state[participant.identity] = { audio: audioMuted, video: videoMuted }
      }
      return state
    }

    const sync = () => setMuteState(buildMuteState())

    sync()
    room.on(RoomEvent.TrackMuted, sync)
    room.on(RoomEvent.TrackUnmuted, sync)
    room.on(RoomEvent.ParticipantConnected, sync)
    room.on(RoomEvent.ParticipantDisconnected, sync)

    return () => {
      room.off(RoomEvent.TrackMuted, sync)
      room.off(RoomEvent.TrackUnmuted, sync)
      room.off(RoomEvent.ParticipantConnected, sync)
      room.off(RoomEvent.ParticipantDisconnected, sync)
    }
  }, [room])

  const start = useCallback(async () => {
    const result = await startRecording(roomId)
    setIsRecording(true)
    setSessionId(result.sessionId)
    channelRef?.current?.postMessage({ type: 'recording-start', sessionId: result.sessionId })
  }, [roomId, channelRef])

  const stop = useCallback(async () => {
    await stopRecording(roomId)
    setIsRecording(false)
    setSessionId(null)
    channelRef?.current?.postMessage({ type: 'recording-stop' })
  }, [roomId, channelRef])

  const toggleMute = useCallback(
    async (identity: string, trackType: 'audio' | 'video') => {
      const current = muteState[identity]?.[trackType] ?? false
      await muteParticipant(roomId, identity, trackType, !current)
      setMuteState((prev) => ({
        ...prev,
        [identity]: {
          audio: prev[identity]?.audio ?? false,
          video: prev[identity]?.video ?? false,
          [trackType]: !current,
        },
      }))
    },
    [roomId, muteState],
  )

  return { isRecording, sessionId, start, stop, muteState, toggleMute }
}
```

- [ ] **Step 2: Update HostSession.tsx — pass channelRef and store roomId**

In `HostSession.tsx`, two changes:

**Change A** — In the `useRecording` call (around line 43), pass `channelRef`:

```ts
const { isRecording, start, stop, muteState, toggleMute } = useRecording(
  roomId,
  connectedRoom,
  channelRef,
)
```

**Change B** — In the `openBigScreen` callback (around line 522), add `roomId` to sessionStorage before the existing writes:

```ts
const openBigScreen = useCallback(() => {
  try {
    sessionStorage.setItem('bigscreen-roomId', roomId)          // ← add this line
    sessionStorage.setItem('bigscreen-snapshot', JSON.stringify(poseSnapshotRef.current))
    // ... rest unchanged
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useRecording.ts frontend/src/components/HostSession.tsx
git commit -m "feat: broadcast recording-start/stop signals to BigScreen via BroadcastChannel"
```

---

## Task 6: BigScreen Canvas Recording

**Files:**
- Modify: `frontend/src/components/BigScreen.tsx`

- [ ] **Step 1: Add new message types to BigScreenMsg interface**

In `BigScreen.tsx`, update the `BigScreenMsg` interface — add the two new types to the `type` union and add the optional `sessionId` field:

```ts
export interface BigScreenMsg {
  type: 'pose' | 'leave' | 'scene-change' | 'vrm-change' | 'vrm-identity-change' | 'slot-assign' | 'task-change' | 'recording-start' | 'recording-stop';
  identity?: string;
  poseData?: unknown;
  sceneId?: string;
  vrmSourceId?: string;
  vrmUrl?: string;
  slotId?: string;
  task?: string | null;
  sessionId?: string;   // for 'recording-start'
}
```

- [ ] **Step 2: Add recording refs inside the BigScreen component**

After the existing `const [poseUpdateCount, setPoseUpdateCount] = useState(0)` line, add:

```ts
const mediaRecorderRef = useRef<MediaRecorder | null>(null)
const recordingChunksRef = useRef<Blob[]>([])
const recordingSessionIdRef = useRef<string | null>(null)
const roomIdRef = useRef<string>(sessionStorage.getItem('bigscreen-roomId') ?? '')
```

- [ ] **Step 3: Add recording message handlers in the BroadcastChannel effect**

Inside the `channel.onmessage` handler (in the second `useEffect`), add two new `else if` branches before the closing `}` of the `if/else if` chain:

```ts
} else if (msg.type === 'recording-start' && msg.sessionId) {
  recordingChunksRef.current = []
  recordingSessionIdRef.current = msg.sessionId
  const canvas = canvasRef.current
  if (!canvas) return
  const stream = canvas.captureStream(30)
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm'
  const mr = new MediaRecorder(stream, { mimeType })
  mr.ondataavailable = (e) => {
    if (e.data.size > 0) recordingChunksRef.current.push(e.data)
  }
  mr.start(1000)
  mediaRecorderRef.current = mr
} else if (msg.type === 'recording-stop') {
  const mr = mediaRecorderRef.current
  if (!mr || mr.state === 'inactive') return
  mr.onstop = async () => {
    const blob = new Blob(recordingChunksRef.current, { type: 'video/webm' })
    const sessionId = recordingSessionIdRef.current
    const roomId = roomIdRef.current
    if (!sessionId || !roomId) {
      console.warn('[BigScreen] Cannot upload: missing sessionId or roomId')
      return
    }
    try {
      const res = await fetch(`/api/rooms/${roomId}/recording/bigscreen`, {
        method: 'POST',
        headers: {
          'Content-Type': 'video/webm',
          'X-Session-Id': sessionId,
        },
        body: blob,
      })
      if (!res.ok) console.error('[BigScreen] Upload failed:', res.status)
    } catch (err) {
      console.error('[BigScreen] Failed to upload recording:', err)
    }
    mediaRecorderRef.current = null
    recordingChunksRef.current = []
    recordingSessionIdRef.current = null
  }
  mr.stop()
}
```

- [ ] **Step 4: Manual smoke test**

1. Start a room with at least one student
2. Open BigScreen (`/?screen=bigscreen` window)
3. Start recording from HostSession panel
4. Wait ~5 seconds
5. Stop recording
6. Check `./recordings/{roomId}/{sessionId}/bigscreen.webm` exists on disk
7. Verify `GET /api/recordings/{roomId}/{sessionId}/bigscreen.webm` downloads the file

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/BigScreen.tsx
git commit -m "feat: BigScreen captures canvas and uploads WebM on recording stop"
```

---

## Self-Review Checklist

- [x] `recording.ts`: `compositeEgressId` removed, `basePath`/`participantIdentities` added, `stopSession` derives files
- [x] `egress.ts`: `startRoomCompositeEgress` removed, `participantIdentities` returned
- [x] `routes.ts`: `startSession` called with basePath, `stopRecording` called with only `trackEgressIds`, `stopSession` called without files arg, two new endpoints added
- [x] `nginx/default.conf`: `client_max_body_size 300m` added
- [x] `useRecording.ts`: broadcasts `recording-start`/`recording-stop` via `channelRef`
- [x] `HostSession.tsx`: passes `channelRef` to hook, stores `bigscreen-roomId`
- [x] `BigScreen.tsx`: handles both new message types, uploads blob on stop
- [x] All test signatures updated to match new interfaces
