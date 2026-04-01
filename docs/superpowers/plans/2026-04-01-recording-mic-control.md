# Recording & Mic/Camera Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side recording (composite + per-participant audio tracks) and Host mic/camera force-mute controls via LiveKit Egress and Admin API.

**Architecture:** LiveKit Egress runs as a new Docker service, coordinated via Redis; the backend gains `egress.ts` and `recording.ts` modules plus 4 new REST endpoints; the frontend gains a `useRecording` hook, `RecordingPanel` component embedded in the header, and mute overlay buttons on each StudentTile. `HostSession` is only minimally changed.

**Tech Stack:** livekit-server-sdk v2.13.1 (EgressClient + RoomServiceClient), Docker Compose, Vitest + supertest (backend tests), React + TypeScript (frontend)

**Spec:** `docs/superpowers/specs/2026-04-01-recording-mic-control-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `docker-compose.yml` | Add `redis` + `livekit-egress` services, `recordings` bind-mount volume |
| Create | `egress.yaml` | Egress service config (API key, Redis address, WS URL) |
| Modify | `livekit.yaml` | Add Redis address for LiveKit ↔ Egress coordination |
| Create | `backend/src/recording.ts` | In-memory `RecordingStore` holding active session state |
| Create | `backend/src/egress.ts` | `EgressService` wrapping `EgressClient` + `RoomServiceClient` |
| Modify | `backend/src/routes.ts` | Accept optional `RecordingDeps`; add 4 recording/mute endpoints |
| Create | `backend/src/routes.recording.test.ts` | Vitest tests for the 4 new endpoints with mocked deps |
| Modify | `backend/src/index.ts` | Wire `RecordingStore` + `EgressService` into `createRouter` |
| Modify | `frontend/src/api.ts` | Add recording + mute API types and fetch functions |
| Create | `frontend/src/hooks/useRecording.ts` | Recording state + mute state hook |
| Create | `frontend/src/components/RecordingPanel.tsx` | Start/Stop recording UI for header |
| Modify | `frontend/src/components/StudentTile.tsx` | Add optional `onToggleMute` prop + overlay buttons |
| Modify | `frontend/src/components/HostSession.tsx` | Wire `useRecording`, render `RecordingPanel`, pass mute props |

---

## Task 1: Infrastructure — Redis + Egress in Docker Compose

**Files:**
- Modify: `docker-compose.yml`
- Create: `egress.yaml`
- Modify: `livekit.yaml`
- Create: `recordings/` directory (gitignored)

- [ ] **Step 1: Add `redis` service to docker-compose.yml**

Open `docker-compose.yml`. Add `redis` service before `livekit`:

```yaml
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3
```

- [ ] **Step 2: Add `livekit-egress` service to docker-compose.yml**

After the `redis` service block, add:

```yaml
  livekit-egress:
    image: livekit/egress:latest
    restart: unless-stopped
    environment:
      - EGRESS_CONFIG_FILE=/etc/egress.yaml
    volumes:
      - ./egress.yaml:/etc/egress.yaml:ro
      - ./recordings:/recordings
    depends_on:
      livekit:
        condition: service_healthy
      redis:
        condition: service_healthy
    cap_add:
      - SYS_ADMIN
```

Also update `livekit` service to add `redis` dependency:

```yaml
  livekit:
    ...
    depends_on:
      redis:
        condition: service_healthy
```

- [ ] **Step 3: Create `egress.yaml`**

Create file at project root `egress.yaml`:

```yaml
api_key: devkey
api_secret: devsecret1234567890devsecret1234567890
ws_url: ws://livekit:7880
redis:
  address: redis:6379
health_port: 8080
log_level: info
```

- [ ] **Step 4: Add Redis to `livekit.yaml`**

Open `livekit.yaml`. Add after the `keys:` block:

```yaml
redis:
  address: redis:6379
```

- [ ] **Step 5: Create recordings directory + gitignore**

```bash
mkdir -p recordings
echo "recordings/" >> .gitignore
```

- [ ] **Step 6: Commit infrastructure config**

```bash
git add docker-compose.yml egress.yaml livekit.yaml .gitignore
git commit -m "feat: add Redis and LiveKit Egress services to docker-compose"
```

---

## Task 2: Backend — `recording.ts` (In-Memory Session Store)

**Files:**
- Create: `backend/src/recording.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/recording.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { RecordingStore } from './recording.js'

describe('RecordingStore', () => {
  let store: RecordingStore

  beforeEach(() => {
    store = new RecordingStore()
  })

  it('starts a session and returns it', () => {
    const session = store.startSession('room-1', 'egress-composite', {
      alice: 'egress-alice',
      bob: 'egress-bob',
    })
    expect(session.sessionId).toBeDefined()
    expect(session.status).toBe('recording')
    expect(session.compositeEgressId).toBe('egress-composite')
    expect(session.trackEgressIds).toEqual({ alice: 'egress-alice', bob: 'egress-bob' })
  })

  it('getActiveSession returns session while recording', () => {
    store.startSession('room-1', 'egress-composite', {})
    const session = store.getActiveSession('room-1')
    expect(session).toBeDefined()
    expect(session!.status).toBe('recording')
  })

  it('getActiveSession returns null when no active session', () => {
    expect(store.getActiveSession('room-1')).toBeNull()
  })

  it('stopSession marks session as stopped and stores files', () => {
    store.startSession('room-1', 'egress-c', {})
    const stopped = store.stopSession('room-1', ['composite.mp4'])
    expect(stopped!.status).toBe('stopped')
    expect(stopped!.files).toEqual(['composite.mp4'])
  })

  it('getActiveSession returns null after stop', () => {
    store.startSession('room-1', 'egress-c', {})
    store.stopSession('room-1', [])
    expect(store.getActiveSession('room-1')).toBeNull()
  })

  it('listSessions returns all sessions for a room', () => {
    store.startSession('room-1', 'e1', {})
    store.stopSession('room-1', [])
    store.startSession('room-1', 'e2', {})
    const sessions = store.listSessions('room-1')
    expect(sessions).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx vitest run src/recording.test.ts
```

Expected: FAIL — `Cannot find module './recording.js'`

- [ ] **Step 3: Implement `recording.ts`**

Create `backend/src/recording.ts`:

```ts
import { randomUUID } from 'crypto'

export interface RecordingSession {
  sessionId: string
  compositeEgressId: string
  trackEgressIds: Record<string, string>   // identity → egressId
  status: 'recording' | 'stopped'
  startedAt: number
  files: string[]
}

export class RecordingStore {
  // roomId → all sessions (most recent last)
  private sessions = new Map<string, RecordingSession[]>()

  startSession(
    roomId: string,
    compositeEgressId: string,
    trackEgressIds: Record<string, string>,
  ): RecordingSession {
    const session: RecordingSession = {
      sessionId: randomUUID(),
      compositeEgressId,
      trackEgressIds,
      status: 'recording',
      startedAt: Date.now(),
      files: [],
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

  stopSession(roomId: string, files: string[]): RecordingSession | null {
    const session = this.getActiveSession(roomId)
    if (!session) return null
    session.status = 'stopped'
    session.files = files
    return session
  }

  listSessions(roomId: string): RecordingSession[] {
    return this.sessions.get(roomId) ?? []
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npx vitest run src/recording.test.ts
```

Expected: all 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/recording.ts backend/src/recording.test.ts
git commit -m "feat: add RecordingStore for in-memory session management"
```

---

## Task 3: Backend — `egress.ts` (EgressService Wrapper)

**Files:**
- Create: `backend/src/egress.ts`

> Note: `EgressClient` and `RoomServiceClient` make real network calls to LiveKit server. This module is not unit-tested directly; it is mocked in route tests (Task 4).

- [ ] **Step 1: Create `egress.ts`**

```ts
import {
  EgressClient,
  RoomServiceClient,
  EncodedFileOutput,
  EncodedFileType,
  TrackSource,
} from 'livekit-server-sdk'

const API_KEY = (process.env.LIVEKIT_API_KEY || 'devkey').trim()
const API_SECRET = (process.env.LIVEKIT_API_SECRET || 'devsecret1234567890devsecret1234567890').trim()
const SERVER_URL = (process.env.LIVEKIT_SERVER_URL || 'http://livekit:7880').trim()

export interface StartRecordingResult {
  compositeEgressId: string
  trackEgressIds: Record<string, string>   // identity → egressId
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

    // 1. Room composite egress (video + audio)
    const compositeOutput = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath: `${basePath}/composite.mp4`,
      disableManifest: true,
    })
    const compositeInfo = await this.egress.startRoomCompositeEgress(roomId, compositeOutput)

    // 2. Per-participant audio track egress
    const participants = await this.roomService.listParticipants(roomId)
    const trackEgressIds: Record<string, string> = {}

    for (const participant of participants) {
      const audioTrack = participant.tracks.find(
        (t) => t.source === TrackSource.MICROPHONE,
      )
      if (!audioTrack) continue

      const audioOutput = new EncodedFileOutput({
        fileType: EncodedFileType.OGG_OPUS,
        filepath: `${basePath}/audio_${participant.identity}.ogg`,
        disableManifest: true,
      })
      const trackInfo = await this.egress.startTrackCompositeEgress(
        roomId,
        { audioTrackId: audioTrack.sid },
        audioOutput,
      )
      trackEgressIds[participant.identity] = trackInfo.egressId
    }

    return {
      compositeEgressId: compositeInfo.egressId,
      trackEgressIds,
    }
  }

  async stopRecording(
    compositeEgressId: string,
    trackEgressIds: Record<string, string>,
  ): Promise<void> {
    await this.egress.stopEgress(compositeEgressId)
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
    const source = trackType === 'audio' ? TrackSource.MICROPHONE : TrackSource.CAMERA
    const track = participant.tracks.find((t) => t.source === source)
    if (!track) throw new Error(`No ${trackType} track found for ${identity}`)
    await this.roomService.mutePublishedTrack(roomId, identity, track.sid, muted)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/egress.ts
git commit -m "feat: add EgressService wrapping LiveKit EgressClient and RoomServiceClient"
```

---

## Task 4: Backend — Recording Routes (4 endpoints)

**Files:**
- Modify: `backend/src/routes.ts`
- Create: `backend/src/routes.recording.test.ts`

- [ ] **Step 1: Write failing tests for recording routes**

Create `backend/src/routes.recording.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify tests fail**

```bash
cd backend && npx vitest run src/routes.recording.test.ts
```

Expected: FAIL — `createRouter` doesn't accept second argument yet

- [ ] **Step 3: Update `routes.ts` to accept optional recording deps**

Open `backend/src/routes.ts`. Change the function signature and add the 4 new endpoints:

```ts
import { Router, type Request, type Response } from 'express'
import { RoomStore } from './rooms.js'
import { createToken } from './livekit.js'
import type { RecordingStore } from './recording.js'
import type { EgressService } from './egress.js'

interface RecordingDeps {
  recordingStore: RecordingStore
  egressService: EgressService
}

export function createRouter(store: RoomStore, recording?: RecordingDeps): Router {
  const router = Router()
  // ... all existing code unchanged ...
```

Then add these 4 endpoints before the final `return router`:

```ts
  // ── Recording endpoints (only active when recording deps injected) ──

  router.post('/rooms/:roomId/recording/start', async (req: Request, res: Response) => {
    if (!recording) { res.status(501).json({ error: 'Recording not configured' }); return }
    const roomId = req.params.roomId as string
    const room = store.getRoom(roomId)
    if (!room) { res.status(404).json({ error: 'Room not found' }); return }

    const existing = recording.recordingStore.getActiveSession(roomId)
    if (existing) { res.status(409).json({ error: 'Already recording' }); return }

    try {
      const { compositeEgressId, trackEgressIds } = await recording.egressService.startRecording(
        roomId,
        // temporary sessionId placeholder — real one set by store
        'temp',
      )
      const session = recording.recordingStore.startSession(roomId, compositeEgressId, trackEgressIds)
      res.json({ sessionId: session.sessionId, status: session.status })
    } catch (err) {
      res.status(500).json({ error: 'Failed to start recording' })
    }
  })

  router.post('/rooms/:roomId/recording/stop', async (req: Request, res: Response) => {
    if (!recording) { res.status(501).json({ error: 'Recording not configured' }); return }
    const roomId = req.params.roomId as string
    const session = recording.recordingStore.getActiveSession(roomId)
    if (!session) { res.status(404).json({ error: 'No active recording' }); return }

    try {
      await recording.egressService.stopRecording(session.compositeEgressId, session.trackEgressIds)
      const stopped = recording.recordingStore.stopSession(roomId, [])
      res.json({ sessionId: stopped!.sessionId, status: stopped!.status })
    } catch (err) {
      res.status(500).json({ error: 'Failed to stop recording' })
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
      } catch (err) {
        res.status(500).json({ error: 'Failed to mute track' })
      }
    },
  )
```

> ⚠️ Important: The `startRecording` call above passes `'temp'` as sessionId but the actual sessionId comes from `recordingStore.startSession`. Fix this by splitting: generate sessionId first, then call egress with it:

Replace the start endpoint body with:

```ts
    try {
      // Generate sessionId first so egress output paths use the correct directory
      const { randomUUID } = await import('crypto')
      const sessionId = randomUUID()
      const { compositeEgressId, trackEgressIds } = await recording.egressService.startRecording(
        roomId,
        sessionId,
      )
      const session = recording.recordingStore.startSession(roomId, compositeEgressId, trackEgressIds)
      // Override sessionId to match what was sent to egress
      session.sessionId = sessionId
      res.json({ sessionId: session.sessionId, status: session.status })
    } catch (err) {
      res.status(500).json({ error: 'Failed to start recording' })
    }
```

> Note: Since `RecordingStore.startSession` already calls `randomUUID()` internally, the cleanest fix is to update `RecordingStore` to accept an optional `sessionId` parameter. Update `recording.ts`:

```ts
  startSession(
    roomId: string,
    compositeEgressId: string,
    trackEgressIds: Record<string, string>,
    sessionId?: string,
  ): RecordingSession {
    const session: RecordingSession = {
      sessionId: sessionId ?? randomUUID(),
      ...
```

And then the route becomes:

```ts
    try {
      const { randomUUID } = await import('crypto')
      const sessionId = randomUUID()
      const { compositeEgressId, trackEgressIds } = await recording.egressService.startRecording(
        roomId,
        sessionId,
      )
      const session = recording.recordingStore.startSession(roomId, compositeEgressId, trackEgressIds, sessionId)
      res.json({ sessionId: session.sessionId, status: session.status })
    } catch (err) {
      res.status(500).json({ error: 'Failed to start recording' })
    }
```

Update `recording.ts` test to cover the optional sessionId:

```ts
  it('accepts an explicit sessionId', () => {
    const session = store.startSession('room-1', 'e1', {}, 'my-fixed-id')
    expect(session.sessionId).toBe('my-fixed-id')
  })
```

- [ ] **Step 4: Run recording route tests**

```bash
cd backend && npx vitest run src/routes.recording.test.ts
```

Expected: all tests PASS

- [ ] **Step 5: Run existing route tests to confirm no regressions**

```bash
cd backend && npx vitest run src/routes.test.ts
```

Expected: all existing tests PASS (since `recording` param is optional)

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes.ts backend/src/routes.recording.test.ts backend/src/recording.ts
git commit -m "feat: add recording and mute REST endpoints to routes"
```

---

## Task 5: Backend — Wire New Deps into `index.ts`

**Files:**
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Update `index.ts`**

Replace the current content of `backend/src/index.ts` with:

```ts
import express from 'express'
import cors from 'cors'
import { RoomStore } from './rooms.js'
import { RecordingStore } from './recording.js'
import { EgressService } from './egress.js'
import { createRouter } from './routes.js'

const app = express()
app.use(cors())
app.use(express.json())

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
```

- [ ] **Step 2: Run all backend tests**

```bash
cd backend && npx vitest run
```

Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat: wire RecordingStore and EgressService into backend router"
```

---

## Task 6: Frontend — Extend `api.ts` with Recording Functions

**Files:**
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Add recording types and functions to `api.ts`**

Append to the end of `frontend/src/api.ts`:

```ts
// ── Recording ────────────────────────────────────────────────────────────────

export interface RecordingSession {
  sessionId: string
  status: 'recording' | 'stopped'
  files: string[]
  startedAt: number
}

export interface StartRecordingResponse {
  sessionId: string
  status: 'recording'
}

export interface StopRecordingResponse {
  sessionId: string
  status: 'stopped'
}

export async function startRecording(roomId: string): Promise<StartRecordingResponse> {
  const res = await fetch(`/api/rooms/${roomId}/recording/start`, { method: 'POST' })
  if (!res.ok) throw new Error(`startRecording failed: ${res.status}`)
  return res.json() as Promise<StartRecordingResponse>
}

export async function stopRecording(roomId: string): Promise<StopRecordingResponse> {
  const res = await fetch(`/api/rooms/${roomId}/recording/stop`, { method: 'POST' })
  if (!res.ok) throw new Error(`stopRecording failed: ${res.status}`)
  return res.json() as Promise<StopRecordingResponse>
}

export async function getRecordings(roomId: string): Promise<RecordingSession[]> {
  const res = await fetch(`/api/rooms/${roomId}/recordings`)
  if (!res.ok) throw new Error(`getRecordings failed: ${res.status}`)
  const data = await res.json() as { recordings: RecordingSession[] }
  return data.recordings
}

export async function muteParticipant(
  roomId: string,
  identity: string,
  trackType: 'audio' | 'video',
  muted: boolean,
): Promise<void> {
  const res = await fetch(`/api/rooms/${roomId}/participants/${identity}/mute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trackType, muted }),
  })
  if (!res.ok) throw new Error(`muteParticipant failed: ${res.status}`)
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat: add recording and mute API functions to frontend api.ts"
```

---

## Task 7: Frontend — `useRecording` Hook

**Files:**
- Create: `frontend/src/hooks/useRecording.ts`

- [ ] **Step 1: Create `useRecording.ts`**

Create `frontend/src/hooks/useRecording.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { Room, RoomEvent, type RemoteTrackPublication, Track } from 'livekit-client'
import {
  startRecording,
  stopRecording,
  getRecordings,
  muteParticipant,
} from '../api.ts'

export interface MuteState {
  audio: boolean   // true = muted
  video: boolean   // true = muted
}

export interface UseRecordingResult {
  isRecording: boolean
  sessionId: string | null
  start: () => Promise<void>
  stop: () => Promise<void>
  muteState: Record<string, MuteState>
  toggleMute: (identity: string, trackType: 'audio' | 'video') => Promise<void>
}

export function useRecording(roomId: string, room: Room | null): UseRecordingResult {
  const [isRecording, setIsRecording] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [muteState, setMuteState] = useState<Record<string, MuteState>>({})
  const roomRef = useRef(room)
  roomRef.current = room

  // Restore recording state on mount / reconnect
  useEffect(() => {
    if (!roomId) return
    getRecordings(roomId).then((sessions) => {
      const active = sessions.find((s) => s.status === 'recording')
      if (active) {
        setIsRecording(true)
        setSessionId(active.sessionId)
      }
    }).catch(() => { /* ignore — backend may be starting */ })
  }, [roomId])

  // Sync mute state from LiveKit room events
  useEffect(() => {
    if (!room) return

    const handleMuted = (_pub: RemoteTrackPublication, ...args: unknown[]) => {
      const participant = args[0] as { identity: string } | undefined
      if (!participant) return
      syncMuteStateForRoom(room)
    }

    const handleUnmuted = (_pub: RemoteTrackPublication, ...args: unknown[]) => {
      const participant = args[0] as { identity: string } | undefined
      if (!participant) return
      syncMuteStateForRoom(room)
    }

    // Initialise mute state from current participants
    syncMuteStateForRoom(room)

    room.on(RoomEvent.TrackMuted, handleMuted as never)
    room.on(RoomEvent.TrackUnmuted, handleUnmuted as never)

    return () => {
      room.off(RoomEvent.TrackMuted, handleMuted as never)
      room.off(RoomEvent.TrackUnmuted, handleUnmuted as never)
    }
  }, [room])

  const start = useCallback(async () => {
    const result = await startRecording(roomId)
    setIsRecording(true)
    setSessionId(result.sessionId)
  }, [roomId])

  const stop = useCallback(async () => {
    await stopRecording(roomId)
    setIsRecording(false)
  }, [roomId])

  const toggleMute = useCallback(
    async (identity: string, trackType: 'audio' | 'video') => {
      const current = muteState[identity]?.[trackType] ?? false
      await muteParticipant(roomId, identity, trackType, !current)
      // Optimistic update; LiveKit event will confirm
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

function syncMuteStateForRoom(room: Room): void {
  // This function updates the caller's muteState — but since it's outside the hook
  // we need to handle this differently. The hook uses a callback ref pattern instead.
  // (Implementation note: syncMuteState is triggered by the event handlers above
  // which call setMuteState directly. This helper is inlined into the effect.)
}
```

> Note: The `syncMuteStateForRoom` pattern needs refinement. Replace the `useEffect` block with this cleaner version that inlines the sync:

```ts
  useEffect(() => {
    if (!room) return

    const buildMuteState = (): Record<string, MuteState> => {
      const state: Record<string, MuteState> = {}
      for (const [, participant] of room.remoteParticipants) {
        let audioMuted = true
        let videoMuted = true
        for (const [, pub] of participant.trackPublications) {
          if (pub.kind === Track.Kind.Audio) audioMuted = pub.isMuted
          if (pub.kind === Track.Kind.Video) videoMuted = pub.isMuted
        }
        state[participant.identity] = { audio: audioMuted, video: videoMuted }
      }
      return state
    }

    const handleTrackChange = () => setMuteState(buildMuteState())

    setMuteState(buildMuteState())
    room.on(RoomEvent.TrackMuted, handleTrackChange)
    room.on(RoomEvent.TrackUnmuted, handleTrackChange)
    room.on(RoomEvent.ParticipantConnected, handleTrackChange)
    room.on(RoomEvent.ParticipantDisconnected, handleTrackChange)

    return () => {
      room.off(RoomEvent.TrackMuted, handleTrackChange)
      room.off(RoomEvent.TrackUnmuted, handleTrackChange)
      room.off(RoomEvent.ParticipantConnected, handleTrackChange)
      room.off(RoomEvent.ParticipantDisconnected, handleTrackChange)
    }
  }, [room])
```

Write the final clean version of `useRecording.ts` combining both parts:

```ts
import { useCallback, useEffect, useState } from 'react'
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

export function useRecording(roomId: string, room: Room | null): UseRecordingResult {
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
        let audioMuted = true
        let videoMuted = true
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
  }, [roomId])

  const stop = useCallback(async () => {
    await stopRecording(roomId)
    setIsRecording(false)
  }, [roomId])

  const toggleMute = useCallback(
    async (identity: string, trackType: 'audio' | 'video') => {
      const current = muteState[identity]?.[trackType] ?? false
      await muteParticipant(roomId, identity, trackType, !current)
      // Optimistic update — LiveKit events will confirm truth
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

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/useRecording.ts
git commit -m "feat: add useRecording hook for recording state and mute control"
```

---

## Task 8: Frontend — `RecordingPanel` Component

**Files:**
- Create: `frontend/src/components/RecordingPanel.tsx`

- [ ] **Step 1: Create `RecordingPanel.tsx`**

```tsx
import React from 'react'

interface RecordingPanelProps {
  isRecording: boolean
  onStart: () => Promise<void>
  onStop: () => Promise<void>
}

export default function RecordingPanel({ isRecording, onStart, onStop }: RecordingPanelProps) {
  const [loading, setLoading] = React.useState(false)

  const handleClick = async () => {
    setLoading(true)
    try {
      if (isRecording) {
        await onStop()
      } else {
        await onStart()
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="recording-panel">
      {isRecording && (
        <span className="recording-indicator">● 錄製中</span>
      )}
      <button
        className={`control-btn ${isRecording ? 'recording-stop' : 'recording-start'}`}
        onClick={handleClick}
        disabled={loading}
      >
        {loading ? '...' : isRecording ? '⏹ 停止錄製' : '▶ 開始錄製'}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Add CSS for recording panel and indicator**

Open `frontend/src/App.css` (or the relevant CSS file your project uses). Add:

```css
.recording-panel {
  display: flex;
  align-items: center;
  gap: 8px;
}

.recording-indicator {
  color: #ff4444;
  font-size: 13px;
  font-weight: 600;
  animation: blink 1.2s step-start infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.recording-start {
  background: #1a6b1a;
  color: #fff;
}

.recording-stop {
  background: #6b1a1a;
  color: #fff;
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/RecordingPanel.tsx frontend/src/App.css
git commit -m "feat: add RecordingPanel component with start/stop and recording indicator"
```

---

## Task 9: Frontend — Extend `StudentTile` with Mute Overlay

**Files:**
- Modify: `frontend/src/components/StudentTile.tsx`

- [ ] **Step 1: Add `onToggleMute` prop and mute overlay to `StudentTile.tsx`**

The current `StudentTileProps` interface and component need two additions:
1. Optional `muteState` prop `{ audio: boolean; video: boolean }` 
2. Optional `onToggleMute` callback

Replace the current content of `StudentTile.tsx` with:

```tsx
import { useEffect, useRef, useState } from 'react'
import type { RemoteParticipant, RemoteTrackPublication } from 'livekit-client'
import { useVrmAvatar } from '../hooks/useVrmAvatar'
import type { PoseFrame } from '../types/vrm'
import type { MuteState } from '../hooks/useRecording'

interface StudentTileProps {
  participant: RemoteParticipant
  videoTrack: RemoteTrackPublication | null
  poseData: PoseFrame | null
  vrmSourceId?: string | null
  muteState?: MuteState
  onToggleMute?: (identity: string, trackType: 'audio' | 'video') => void
}

export default function StudentTile({
  participant,
  videoTrack,
  poseData,
  vrmSourceId,
  muteState,
  onToggleMute,
}: StudentTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { applyPose } = useVrmAvatar(canvasRef, { vrmSourceId })
  const [_, setVideoSize] = useState({ width: 320, height: 240 })

  // Attach video track
  useEffect(() => {
    const el = videoRef.current
    if (!el || !videoTrack?.track) return
    const mediaTrack = videoTrack.track.mediaStreamTrack
    const stream = new MediaStream([mediaTrack])
    el.srcObject = stream
    const handleLoadedMetadata = () => {
      if (el.clientWidth > 0) {
        setVideoSize({ width: el.clientWidth, height: el.clientHeight })
      }
    }
    el.addEventListener('loadedmetadata', handleLoadedMetadata)
    return () => {
      el.srcObject = null
      el.removeEventListener('loadedmetadata', handleLoadedMetadata)
    }
  }, [videoTrack])

  // Apply pose data to VRM
  useEffect(() => {
    if (poseData) applyPose(poseData)
  }, [poseData, applyPose])

  return (
    <div className="student-tile" style={{ position: 'relative' }}>
      <video ref={videoRef} autoPlay playsInline muted className="tile-video" />
      {vrmSourceId !== null && (
        <canvas
          ref={canvasRef}
          className="avatar-canvas"
          style={{ position: 'absolute', top: 0, left: 0, opacity: 0.8 }}
        />
      )}
      <div
        className="student-name"
        style={{
          position: 'absolute',
          bottom: 5,
          right: 5,
          background: 'rgba(0,0,0,0.5)',
          color: '#fff',
          padding: '2px 5px',
        }}
      >
        {participant.identity}
      </div>

      {onToggleMute && (
        <div
          className="mute-controls"
          style={{
            position: 'absolute',
            bottom: 5,
            left: 5,
            display: 'flex',
            gap: 4,
          }}
        >
          <button
            className={`mute-btn ${muteState?.audio ? 'muted' : 'active'}`}
            onClick={() => onToggleMute(participant.identity, 'audio')}
            title={muteState?.audio ? '取消靜音' : '靜音'}
          >
            {muteState?.audio ? '🔇' : '🎤'}
          </button>
          <button
            className={`mute-btn ${muteState?.video ? 'muted' : 'active'}`}
            onClick={() => onToggleMute(participant.identity, 'video')}
            title={muteState?.video ? '開啟鏡頭' : '關閉鏡頭'}
          >
            {muteState?.video ? '📷' : '📹'}
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add CSS for mute buttons**

Append to the same CSS file used in Task 8:

```css
.mute-btn {
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px;
  color: #fff;
  cursor: pointer;
  font-size: 14px;
  padding: 2px 5px;
  line-height: 1;
}

.mute-btn.muted {
  background: rgba(180, 0, 0, 0.7);
  border-color: #ff4444;
}

.mute-btn:hover {
  background: rgba(60, 60, 60, 0.9);
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/StudentTile.tsx frontend/src/App.css
git commit -m "feat: add optional mute overlay buttons to StudentTile"
```

---

## Task 10: Frontend — Wire Everything into `HostSession`

**Files:**
- Modify: `frontend/src/components/HostSession.tsx`

- [ ] **Step 1: Add `useRecording` import and hook call**

Open `HostSession.tsx`. Add the import near the top with the other imports:

```ts
import { useRecording } from '../hooks/useRecording.ts'
import RecordingPanel from './RecordingPanel.tsx'
```

After the `useState` declarations (around line 35), add:

```ts
  const { isRecording, start, stop, muteState, toggleMute } = useRecording(
    roomId,
    connectedRoom,
  )
```

- [ ] **Step 2: Add `RecordingPanel` to the session header**

Find the `<div className="session-header">` block. After the `<span className="count-badge">` line, add:

```tsx
        <RecordingPanel
          isRecording={isRecording}
          onStart={start}
          onStop={stop}
        />
```

- [ ] **Step 3: Pass mute props to StudentTile**

Find the `<StudentTile` usage inside the student grid (around line 769). Change from:

```tsx
                  <StudentTile
                    participant={info.participant}
                    videoTrack={info.videoTrack}
                    poseData={info.poseData}
                    vrmSourceId={hasSlots && !assignedSlot ? null : currentVrmId}
                  />
```

To:

```tsx
                  <StudentTile
                    participant={info.participant}
                    videoTrack={info.videoTrack}
                    poseData={info.poseData}
                    vrmSourceId={hasSlots && !assignedSlot ? null : currentVrmId}
                    muteState={muteState[info.participant.identity]}
                    onToggleMute={toggleMute}
                  />
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/HostSession.tsx
git commit -m "feat: integrate RecordingPanel and mute controls into HostSession"
```

---

## Task 11: End-to-End Verification

- [ ] **Step 1: Start full Docker stack**

```bash
docker compose up --build
```

Verify all services start: `nginx`, `redis`, `livekit`, `livekit-egress`, `backend`, `frontend`

- [ ] **Step 2: Check Egress service health**

```bash
docker compose ps
```

Expected: all services `healthy` or `running`. Egress does not have a healthcheck but should not be `exited`.

- [ ] **Step 3: Smoke test recording start/stop**

1. Open browser → create a room as Host
2. Click **▶ 開始錄製** → button changes to **⏹ 停止錄製**, red ● 錄製中 appears
3. Wait 5 seconds
4. Click **⏹ 停止錄製** → button reverts

- [ ] **Step 4: Verify recording files exist**

```bash
ls recordings/
```

Expected: a directory `{roomId}/{sessionId}/` containing `composite.mp4` and `audio_*.ogg` files.

- [ ] **Step 5: Smoke test mute controls**

1. Join room as a second participant (student)
2. In Host console, click 🎤 on the student tile
3. Verify the student's audio track is muted (icon changes to 🔇)
4. Click again to unmute

- [ ] **Step 6: Test reconnect recovery**

1. Start recording
2. Close Host browser tab and reopen → navigate back to host session
3. Expected: `● 錄製中` indicator appears automatically (restored from `GET /recordings`)

- [ ] **Step 7: Run all backend tests one final time**

```bash
cd backend && npx vitest run
```

Expected: all tests PASS

---

## Summary of New Files

| File | Type |
|------|------|
| `egress.yaml` | Config |
| `backend/src/recording.ts` | New module |
| `backend/src/recording.test.ts` | New test |
| `backend/src/egress.ts` | New module |
| `backend/src/routes.recording.test.ts` | New test |
| `frontend/src/hooks/useRecording.ts` | New hook |
| `frontend/src/components/RecordingPanel.tsx` | New component |
