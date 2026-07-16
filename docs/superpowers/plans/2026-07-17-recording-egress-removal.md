# 移除 LiveKit Egress 錄製路徑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除後端對 LiveKit Egress（server-side 逐人 `.ogg` 錄音）的依賴，改為每位參與者（含學生）用瀏覽器端 `MediaRecorder` 錄自己的麥克風並上傳，讓錄製功能完全不再需要 LiveKit Egress（也連帶不再需要 Redis），為後續「去 Docker 封裝」鋪路。

**Architecture:** 老師端「開始/停止錄製」時，除了現有的 `BroadcastChannel`（轉給大屏）之外，額外透過 LiveKit `publishData(reliable)` 廣播一個 `recording-signal` 訊息給所有學生；學生端收到後用本機 `MediaRecorder` 錄自己的麥克風，停止時呼叫既有的 `POST /recording/audio` 端點上傳（這個端點已存在，目前只有老師端在用）。後端拿掉 `EgressClient`／`.ogg` 這條路徑，`RoomServiceClient`（踢人/靜音）保留但獨立成 `RoomAdminService`。

**Tech Stack:** 沿用現有 Node/Express + TypeScript（backend）、React + LiveKit Client SDK（frontend）、Vitest 測試。本計畫**完全在現有 `docker-compose.yml` 環境下開發與驗證**，不涉及封裝/去 Docker（那是下一份計畫的範圍）。

## Global Constraints

- 本計畫完成後，`docker-compose.yml` 裡的 `livekit-egress` 服務應已無任何呼叫方——驗證方式是全文搜尋 `EgressClient`/`egressService` 應無殘留。
- 前端 MediaRecorder 相關邏輯不在 jsdom 下做深度 mock 測試——比照專案既有慣例（見 `frontend/src/hooks/useTurnAudioRecorder.test.ts` 只測試被抽出的純函式），本計畫沒有可抽出的複雜純邏輯，因此前端任務改用 `npm run build`（tsc 型別檢查）+ 既有測試套件全綠 + 手動驗證步驟 來把關，而不是新增瀏覽器 API 的 unit test。
- 後端沿用 Vitest + `supertest`，比照 `backend/src/routes.recording.test.ts` 既有的 mock 慣例。
- Commit 訊息不要加 `Co-Authored-By` 字樣。
- 每個 Task 完成後之驗證指令請在對應目錄下執行（backend 指令於 `backend/`、frontend 指令於 `frontend/`）。

---

### Task 1: Backend — 移除 LiveKit Egress，`EgressService` 拆成 `RoomAdminService`

**Files:**
- Create: `backend/src/roomAdmin.ts`
- Delete: `backend/src/egress.ts`
- Modify: `backend/src/recording.ts`
- Modify: `backend/src/routes.ts`
- Modify: `backend/src/merge.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/src/recording.test.ts`
- Test: `backend/src/routes.recording.test.ts`

**Interfaces:**
- Produces: `RoomAdminService`（`backend/src/roomAdmin.ts`）— `muteTrack(roomId: string, identity: string, trackType: 'audio' | 'video', muted: boolean): Promise<void>`、`removeParticipant(roomId: string, identity: string): Promise<void>`。純包裝 `RoomServiceClient`，不再有 `EgressClient`。
- Produces: `RecordingStore.startSession(roomId: string, basePath: string, sessionId?: string): RecordingSession`（拿掉 `trackEgressIds`／`participantIdentities` 參數；`session.participantIdentities` 一律從 `[]` 開始，由 `/recording/audio` 上傳時動態追加——這段邏輯 `routes.ts` 已存在，不需改動）。
- Produces: `RecordingSession` 型別拿掉 `trackEgressIds` 欄位。
- Consumes（`routes.ts`）：上述兩者，以及 `mergeRecording(dir: string, identities: string[]): Promise<string>`（Task 1 內於 `merge.ts` 簡化，簽章不變）。

- [ ] **Step 1: 改寫 `backend/src/recording.test.ts` 為新簽章（先讓測試失敗）**

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { RecordingStore } from './recording.js'

describe('RecordingStore', () => {
  let store: RecordingStore

  beforeEach(() => {
    store = new RecordingStore()
  })

  it('starts a session and returns it', () => {
    const session = store.startSession('room-1', '/recordings/room-1/sess-1')
    expect(session.sessionId).toBeDefined()
    expect(session.status).toBe('recording')
    expect(session.basePath).toBe('/recordings/room-1/sess-1')
    expect(session.participantIdentities).toEqual([])
    expect(session.files).toEqual([])
  })

  it('getActiveSession returns session while recording', () => {
    store.startSession('room-1', '/recordings/room-1/s1')
    expect(store.getActiveSession('room-1')?.status).toBe('recording')
  })

  it('getActiveSession returns null when no active session', () => {
    expect(store.getActiveSession('room-1')).toBeNull()
  })

  it('stopSession marks session stopped and populates files from uploaded participants', () => {
    const session = store.startSession('room-1', '/recordings/room-1/sess-1')
    session.participantIdentities.push('alice', 'bob')
    const stopped = store.stopSession('room-1')
    expect(stopped!.status).toBe('stopped')
    expect(stopped!.files).toEqual([
      '/recordings/room-1/sess-1/bigscreen.webm',
      '/recordings/room-1/sess-1/audio_alice.webm',
      '/recordings/room-1/sess-1/audio_bob.webm',
    ])
  })

  it('stopSession with no participants only includes bigscreen', () => {
    store.startSession('room-1', '/recordings/room-1/s1')
    const stopped = store.stopSession('room-1')
    expect(stopped!.files).toEqual(['/recordings/room-1/s1/bigscreen.webm'])
  })

  it('getActiveSession returns null after stop', () => {
    store.startSession('room-1', '/recordings/room-1/s1')
    store.stopSession('room-1')
    expect(store.getActiveSession('room-1')).toBeNull()
  })

  it('listSessions returns all sessions for a room', () => {
    store.startSession('room-1', '/recordings/room-1/s1')
    store.stopSession('room-1')
    store.startSession('room-1', '/recordings/room-1/s2')
    expect(store.listSessions('room-1')).toHaveLength(2)
  })

  it('accepts an explicit sessionId', () => {
    const session = store.startSession('room-1', '/recordings/room-1/s1', 'my-fixed-id')
    expect(session.sessionId).toBe('my-fixed-id')
  })
})
```

- [ ] **Step 2: 執行測試,確認因簽章不符而失敗**

Run: `cd backend && npx vitest run src/recording.test.ts`
Expected: FAIL（`startSession` 參數數量不符 / TS 型別錯誤）

- [ ] **Step 3: 改寫 `backend/src/recording.ts`**

```typescript
import { randomUUID } from 'crypto'

export interface RecordingSession {
  sessionId: string
  status: 'recording' | 'stopped'
  mergeStatus: 'pending' | 'merging' | 'done' | 'error'
  mergeOutput?: string   // basePath-relative: e.g. /recordings/{scene}/{folder}/output.mp4
  mergeError?: string
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
    basePath: string,
    sessionId?: string,
  ): RecordingSession {
    const session: RecordingSession = {
      sessionId: sessionId ?? randomUUID(),
      status: 'recording',
      mergeStatus: 'pending',
      startedAt: Date.now(),
      files: [],
      basePath,
      participantIdentities: [],
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
    // 每人音訊一律是瀏覽器端 MediaRecorder 上傳的 .webm（不再有 Egress 的 .ogg）
    const audioFiles = session.participantIdentities.map(
      (id) => `${session.basePath}/audio_${id}.webm`,
    )
    session.files = [
      `${session.basePath}/bigscreen.webm`,
      ...audioFiles,
    ]
    return session
  }

  listSessions(roomId: string): RecordingSession[] {
    return this.sessions.get(roomId) ?? []
  }

  getSessionById(sessionId: string): RecordingSession | null {
    for (const sessions of this.sessions.values()) {
      const found = sessions.find((s) => s.sessionId === sessionId)
      if (found) return found
    }
    return null
  }
}
```

- [ ] **Step 4: 執行測試,確認通過**

Run: `cd backend && npx vitest run src/recording.test.ts`
Expected: PASS（7 tests）

- [ ] **Step 5: 改寫 `backend/src/routes.recording.test.ts` 為新的 `roomAdmin` mock（先讓測試失敗）**

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import { RoomStore } from './rooms.js'
import { RecordingStore } from './recording.js'
import { createRouter } from './routes.js'
import type { RoomAdminService } from './roomAdmin.js'

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
      const res = await request(app).post(`/api/rooms/${roomId}/recording/start`)
      expect(res.status).toBe(200)
      expect(res.body.sessionId).toBeDefined()
      expect(res.body.status).toBe('recording')
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

    it('stopped session has status stopped', async () => {
      await request(app).post(`/api/rooms/${roomId}/recording/start`)
      const stopRes = await request(app).post(`/api/rooms/${roomId}/recording/stop`)
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
```

- [ ] **Step 6: 執行測試,確認因 `./roomAdmin.js` 不存在而失敗**

Run: `cd backend && npx vitest run src/routes.recording.test.ts`
Expected: FAIL（找不到模組 `./roomAdmin.js`）

- [ ] **Step 7: 建立 `backend/src/roomAdmin.ts`（取代 `egress.ts`）**

```typescript
import {
  RoomServiceClient,
  TrackSource,
  TrackType,
} from 'livekit-server-sdk'

export class RoomAdminService {
  private roomService: RoomServiceClient

  constructor() {
    const key = (process.env.LIVEKIT_API_KEY || 'devkey').trim()
    const secret = (process.env.LIVEKIT_API_SECRET || 'devsecret1234567890devsecret1234567890').trim()
    const _lkUrl = (process.env.LIVEKIT_URL || process.env.LIVEKIT_SERVER_URL || 'ws://localhost:7880').trim()
    const urlHttp = _lkUrl.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://')

    this.roomService = new RoomServiceClient(urlHttp, key, secret)
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

  /**
   * Forcibly disconnect a participant from a room. The LiveKit server tears
   * down their connection; the client receives a Disconnected event.
   * No-op (does not throw) if the participant has already left.
   */
  async removeParticipant(roomId: string, identity: string): Promise<void> {
    try {
      await this.roomService.removeParticipant(roomId, identity)
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      // LiveKit returns NOT_FOUND when the participant is already gone — that's
      // the desired terminal state, so swallow it.
      if (msg.toLowerCase().includes('not_found') || msg.toLowerCase().includes('not found')) return
      throw err
    }
  }
}
```

- [ ] **Step 8: 刪除 `backend/src/egress.ts`**

Run: `rm backend/src/egress.ts`

- [ ] **Step 9: 修改 `backend/src/routes.ts` — import 與 `RecordingDeps`**

在檔案頂部,把:

```typescript
import type { EgressService } from './egress.js'
```

改成:

```typescript
import type { RoomAdminService } from './roomAdmin.js'
```

把:

```typescript
interface RecordingDeps {
  recordingStore: RecordingStore
  egressService: EgressService
}
```

改成:

```typescript
interface RecordingDeps {
  recordingStore: RecordingStore
  roomAdmin: RoomAdminService
}
```

- [ ] **Step 10: 修改 `backend/src/routes.ts` — `/recording/start` handler**

把整個 `router.post('/rooms/:roomId/recording/start', ...)` handler 內容改成:

```typescript
  router.post('/rooms/:roomId/recording/start', async (req: Request, res: Response) => {
    if (!recording) { res.status(501).json({ error: 'Recording not configured' }); return }
    const roomId = req.params.roomId as string
    const { sceneId, participantName } = req.body as { sceneId?: string; participantName?: string }

    const room = store.getRoom(roomId)
    if (!room) { res.status(404).json({ error: 'Room not found' }); return }

    const existing = recording.recordingStore.getActiveSession(roomId)
    if (existing) { res.status(409).json({ error: 'Already recording' }); return }

    try {
      const { randomUUID } = await import('crypto')
      const sessionId = randomUUID()

      // Format: [participantName_currentLocalTime]
      // Use explicit timezone to avoid Docker's default UTC time (e.g., 'Asia/Taipei')
      const tzOptions: Intl.DateTimeFormatOptions = {
        timeZone: process.env.TZ || 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }
      const formatter = new Intl.DateTimeFormat('sv-SE', tzOptions)
      const timestamp = formatter.format(new Date()).replace(/[-:]/g, '').replace(' ', '-')

      const safeParticipantName = (participantName || 'Unknown').replace(/[^a-z0-9]/gi, '_')
      const safeSceneId = (sceneId || 'DefaultScene').replace(/[^a-z0-9]/gi, '_')
      const folderName = `${safeParticipantName}_${timestamp}`

      const basePath = `/recordings/${safeSceneId}/${folderName}`
      // Create the directory upfront so client-side audio/bigscreen uploads always have somewhere to land.
      const dir = basepathToDir(basePath)
      await fs.promises.mkdir(dir, { recursive: true })
      const session = recording.recordingStore.startSession(roomId, basePath, sessionId)
      res.json({ sessionId: session.sessionId, status: session.status })
    } catch (err: any) {
      console.error('[recording/start] error:', err?.message ?? err, '| cause:', err?.cause)
      res.status(500).json({ error: 'Failed to start recording', detail: err?.cause?.message ?? err?.message ?? String(err) })
    }
  })
```

（相較原本：拿掉 `egressService.startRecording()` 呼叫、拿掉 `chmod 0o777`——那是給 Egress 跨容器寫入用的，現在不需要了。）

- [ ] **Step 11: 修改 `backend/src/routes.ts` — `/recording/stop` handler**

把整個 `router.post('/rooms/:roomId/recording/stop', ...)` handler 內容改成:

```typescript
  router.post('/rooms/:roomId/recording/stop', async (req: Request, res: Response) => {
    if (!recording) { res.status(501).json({ error: 'Recording not configured' }); return }
    const roomId = req.params.roomId as string
    const session = recording.recordingStore.getActiveSession(roomId)
    if (!session) { res.status(404).json({ error: 'No active recording' }); return }

    try {
      const stopped = recording.recordingStore.stopSession(roomId)
      if (!stopped) { res.status(500).json({ error: 'Failed to stop session' }); return }

      // Trigger merge in background — bigscreen.webm may not be uploaded yet,
      // mergeRecording waits up to 30 s for it before proceeding.
      const dir = basepathToDir(stopped.basePath)
      stopped.mergeStatus = 'merging'
      mergeRecording(dir, stopped.participantIdentities)
        .then((outputPath) => {
          stopped.mergeStatus = 'done'
          stopped.mergeOutput = outputPath
          console.log('[merge] Done:', outputPath)
        })
        .catch((err: Error) => {
          stopped.mergeStatus = 'error'
          stopped.mergeError = err.message
          console.error('[merge] Failed:', err.message)
        })

      res.json({ sessionId: stopped.sessionId, status: stopped.status })
    } catch (err: any) {
      console.error('[recording/stop] error:', err?.message ?? err, '| cause:', err?.cause)
      res.status(500).json({ error: 'Failed to stop recording', detail: err?.cause?.message ?? err?.message ?? String(err) })
    }
  })
```

（相較原本：拿掉 `await recording.egressService.stopRecording(session.trackEgressIds)`。）

- [ ] **Step 12: 修改 `backend/src/routes.ts` — kick / mute handlers**

把 `/rooms/:roomId/participants/:identity/remove` 內的 `recording.egressService.removeParticipant(roomId, identity)` 改成 `recording.roomAdmin.removeParticipant(roomId, identity)`。

把 `/rooms/:roomId/participants/:identity/mute` 內的 `recording.egressService.muteTrack(roomId, identity, trackType, muted ?? true)` 改成 `recording.roomAdmin.muteTrack(roomId, identity, trackType, muted ?? true)`。

- [ ] **Step 13: 修改 `backend/src/index.ts`**

把:

```typescript
import { RecordingStore } from './recording.js'
import { EgressService } from './egress.js'
```

改成:

```typescript
import { RecordingStore } from './recording.js'
import { RoomAdminService } from './roomAdmin.js'
```

把:

```typescript
const recordingStore = new RecordingStore()
const egressService = new EgressService()
```

改成:

```typescript
const recordingStore = new RecordingStore()
const roomAdmin = new RoomAdminService()
```

把:

```typescript
app.use('/api', createRouter(store, { recordingStore, egressService }))
```

改成:

```typescript
app.use('/api', createRouter(store, { recordingStore, roomAdmin }))
```

- [ ] **Step 14: 執行全部後端測試,確認通過**

Run: `cd backend && npm test`
Expected: PASS（全部測試檔案皆綠燈，特別是 `recording.test.ts`、`routes.recording.test.ts`）

- [ ] **Step 15: 修改 `backend/src/merge.ts` — 移除 `.ogg` 雙軌邏輯**

把 `waitForAudioFilesStable` 內的檔名過濾:

```typescript
      entries = fs.readdirSync(dir).filter(
        f => f.startsWith('audio_') && (f.endsWith('.ogg') || f.endsWith('.webm')),
      )
```

改成:

```typescript
      entries = fs.readdirSync(dir).filter(
        f => f.startsWith('audio_') && f.endsWith('.webm'),
      )
```

把 `mergeRecording` 裡「掃描目錄找音訊檔」的兩段（.ogg 優先、.webm 補上未涵蓋 identity）:

```typescript
  const dirEntries = fs.readdirSync(dir)
  const seenIds = new Set<string>()
  const audioInputs: string[] = []

  // First pass: .ogg (LiveKit Egress — preferred, higher quality)
  for (const f of dirEntries) {
    if (f.startsWith('audio_') && f.endsWith('.ogg')) {
      const id = f.slice('audio_'.length, -'.ogg'.length)
      audioInputs.push(path.join(dir, f))
      seenIds.add(id)
    }
  }
  // Second pass: .webm (client-side upload) — only for identities not already covered by .ogg
  for (const f of dirEntries) {
    if (f.startsWith('audio_') && f.endsWith('.webm')) {
      const id = f.slice('audio_'.length, -'.webm'.length)
      if (!seenIds.has(id)) {
        audioInputs.push(path.join(dir, f))
        seenIds.add(id)
      }
    }
  }
```

改成單一 pass（每人固定就是一支 `.webm`）:

```typescript
  const dirEntries = fs.readdirSync(dir)
  const audioInputs: string[] = []

  for (const f of dirEntries) {
    if (f.startsWith('audio_') && f.endsWith('.webm')) {
      audioInputs.push(path.join(dir, f))
    }
  }
```

同時把函式頂部的 JSDoc 註解裡提到「`.ogg`（LiveKit Egress）」與「等待 LiveKit Egress flush」的部分文字拿掉，改成只提 client-side `.webm` 上傳（避免文件與程式碼不一致）。

- [ ] **Step 16: 執行後端建置與完整測試**

Run: `cd backend && npm run build && npm test`
Expected: PASS（`tsc` 編譯成功且測試全綠；`merge.ts` 沒有專屬 unit test，本步驟以型別檢查 + 手動驗證把關——手動驗證見 Task 4）

- [ ] **Step 17: 全文搜尋確認無殘留引用**

Run: `cd backend && grep -rn "EgressClient\|egressService\|EgressService" src/ || echo "clean"`
Expected: 輸出 `clean`（無殘留）

- [ ] **Step 18: Commit**

```bash
git add backend/src/roomAdmin.ts backend/src/recording.ts backend/src/routes.ts backend/src/merge.ts backend/src/index.ts backend/src/recording.test.ts backend/src/routes.recording.test.ts
git rm backend/src/egress.ts
git commit -m "refactor(backend): 移除 LiveKit Egress 錄製路徑，踢人/靜音改用獨立的 RoomAdminService"
```

---

### Task 2: Frontend — 共用的 `useLocalAudioRecorder` hook + 老師端廣播錄製訊號

**Files:**
- Create: `frontend/src/hooks/useLocalAudioRecorder.ts`
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/hooks/useRecording.ts`

**Interfaces:**
- Produces: `useLocalAudioRecorder(getMicTrack: () => MediaStreamTrack | null, getIdentity: () => string | null): { start: () => void; stopAndUpload: (roomId: string, sessionId: string) => Promise<void> }`（`frontend/src/hooks/useLocalAudioRecorder.ts`）。getter 風格的參數是刻意的——比照本專案既有的 `useTurnAudioRecorder(getMicTrack)`，讓 Host（room 存在 React state）與 Task 3 的 Student（room 只存在 ref）能共用同一支 hook,不需要把 room 提升成 state。
- Produces: `uploadParticipantAudio(roomId: string, sessionId: string, identity: string, blob: Blob): Promise<void>`（`frontend/src/api.ts`）。
- Consumes: `livekit-client` 的 `Room`、`Track`（既有依賴，不需新增套件）。

- [ ] **Step 1: 在 `frontend/src/api.ts` 新增 `uploadParticipantAudio`**

緊接在 `stopRecording` 函式之後加入:

```typescript
export async function uploadParticipantAudio(
  roomId: string,
  sessionId: string,
  identity: string,
  blob: Blob,
): Promise<void> {
  await fetch(`/api/rooms/${roomId}/recording/audio`, {
    method: 'POST',
    headers: {
      'Content-Type': 'audio/webm',
      'X-Session-Id': sessionId,
      'X-Participant-Identity': identity,
    },
    body: blob,
  });
}
```

- [ ] **Step 2: 建立 `frontend/src/hooks/useLocalAudioRecorder.ts`**

```typescript
import { useCallback, useMemo, useRef } from 'react'
import { uploadParticipantAudio } from '../api.ts'

export interface UseLocalAudioRecorderResult {
  start: () => void
  stopAndUpload: (roomId: string, sessionId: string) => Promise<void>
}

/**
 * 對「目前麥克風 track」做整段錄音（涵蓋一次課堂錄製的起訖，非 per-turn）。
 * getMicTrack / getIdentity 是即時取值的 getter，而非固定的 Room 物件——
 * 讓 Host（room 存在 React state）與 Student（room 只存在 ref）能共用同一支 hook。
 */
export function useLocalAudioRecorder(
  getMicTrack: () => MediaStreamTrack | null,
  getIdentity: () => string | null,
): UseLocalAudioRecorderResult {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const start = useCallback(() => {
    const track = getMicTrack()
    if (!track) return
    // 前一輪 recorder 若還在（例如重整後恢復），先丟棄，避免孤兒 recorder 佔用麥克風。
    const existing = mediaRecorderRef.current
    if (existing) {
      mediaRecorderRef.current = null
      try { if (existing.state !== 'inactive') existing.stop() } catch { /* ignore */ }
    }
    try {
      const stream = new MediaStream([track])
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const mr = new MediaRecorder(stream, { mimeType })
      chunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.start(1000)
      mediaRecorderRef.current = mr
    } catch (err) {
      console.error('[useLocalAudioRecorder] Failed to start recording:', err)
    }
  }, [getMicTrack])

  const stopAndUpload = useCallback((roomId: string, sessionId: string): Promise<void> => {
    return new Promise((resolve) => {
      const mr = mediaRecorderRef.current
      mediaRecorderRef.current = null
      if (!mr || mr.state === 'inactive') { resolve(); return }
      mr.onstop = async () => {
        const identity = getIdentity()
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        chunksRef.current = []
        if (identity && blob.size > 0) {
          try {
            await uploadParticipantAudio(roomId, sessionId, identity, blob)
          } catch (err) {
            console.error('[useLocalAudioRecorder] Failed to upload audio recording:', err)
          }
        }
        resolve()
      }
      try { mr.stop() } catch { resolve() }
    })
  }, [getIdentity])

  return useMemo(() => ({ start, stopAndUpload }), [start, stopAndUpload])
}
```

`useMemo` 是必要的——回傳物件若每次 render 都重新建立，會讓依賴它的 `useEffect`/`useCallback` deps array 每次都判定「變了」而重跑，即使 `start`/`stopAndUpload` 本身已用 `useCallback` 穩定。

- [ ] **Step 3: 改寫 `frontend/src/hooks/useRecording.ts`，改用共用 hook + 廣播訊號給學生**

```typescript
import { useCallback, useEffect, useRef, useState } from 'react'
import { Room, RoomEvent, Track } from 'livekit-client'
import {
  startRecording,
  stopRecording,
  getRecordings,
  muteParticipant,
} from '../api.ts'
import { useLocalAudioRecorder } from './useLocalAudioRecorder.ts'

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

/** 把「錄製開始/停止」廣播給所有學生（老師端目前只用 BroadcastChannel 轉給大屏，學生端在不同裝置收不到）。 */
function broadcastRecordingSignal(room: Room | null, action: 'start' | 'stop', sessionId: string): void {
  if (!room || room.state !== 'connected') return
  try {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ type: 'recording-signal', action, sessionId }),
    )
    room.localParticipant.publishData(bytes, { reliable: true })
  } catch { /* ignore */ }
}

export function useRecording(
  roomId: string,
  room: Room | null,
  sceneId: string,
  participantName: string,
  channelRef?: React.RefObject<BroadcastChannel | null>,
): UseRecordingResult {
  const [isRecording, setIsRecording] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [muteState, setMuteState] = useState<Record<string, MuteState>>({})

  const getMicTrack = useCallback((): MediaStreamTrack | null => {
    const pub = room?.localParticipant.getTrackPublication(Track.Source.Microphone)
    return pub?.track?.mediaStreamTrack ?? null
  }, [room])

  const getIdentity = useCallback((): string | null => {
    return room?.localParticipant.identity ?? null
  }, [room])

  const localAudio = useLocalAudioRecorder(getMicTrack, getIdentity)

  // Restore recording state on mount (e.g. host refreshed mid-recording)
  useEffect(() => {
    if (!roomId) return
    getRecordings(roomId)
      .then((sessions) => {
        const active = sessions.find((s) => s.status === 'recording')
        if (active) {
          setIsRecording(true)
          setSessionId(active.sessionId)
          localAudio.start()
        }
      })
      .catch(() => { /* backend may still be starting */ })
  }, [roomId, localAudio])

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
    const result = await startRecording(roomId, sceneId, participantName)
    setIsRecording(true)
    setSessionId(result.sessionId)

    localAudio.start()

    channelRef?.current?.postMessage({ type: 'recording-start', sessionId: result.sessionId })
    broadcastRecordingSignal(room, 'start', result.sessionId)
  }, [roomId, room, channelRef, sceneId, participantName, localAudio])

  const stop = useCallback(async () => {
    await stopRecording(roomId)
    setIsRecording(false)
    const activeSessionId = sessionId
    setSessionId(null)

    if (activeSessionId) {
      await localAudio.stopAndUpload(roomId, activeSessionId)
    }

    channelRef?.current?.postMessage({ type: 'recording-stop' })
    broadcastRecordingSignal(room, 'stop', activeSessionId ?? '')
  }, [roomId, room, sessionId, channelRef, localAudio])

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

- [ ] **Step 4: 型別檢查與既有測試**

Run: `cd frontend && npm run build`
Expected: PASS（`tsc -b` 無型別錯誤；`useRecording.ts` 本身沒有專屬 unit test，本步驟以型別檢查把關，比照專案對 MediaRecorder 相關 hook 一貫的測試深度）

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api.ts frontend/src/hooks/useLocalAudioRecorder.ts frontend/src/hooks/useRecording.ts
git commit -m "refactor(frontend): 抽出共用的 useLocalAudioRecorder，老師端錄製時廣播訊號給學生"
```

---

### Task 3: Frontend — 學生端接收訊號、錄自己的麥克風並上傳

**Files:**
- Modify: `frontend/src/components/StudentSession.tsx`

**Interfaces:**
- Consumes: `useLocalAudioRecorder`（Task 2 產出，`frontend/src/hooks/useLocalAudioRecorder.ts`）。
- Consumes: 老師端透過 LiveKit `publishData(reliable)` 廣播的訊息格式 `{ type: 'recording-signal', action: 'start' | 'stop', sessionId: string }`（Task 2 產出）。

- [ ] **Step 1: 加入 import 與 ref**

在檔案頂部 import 區塊加入:

```typescript
import { useLocalAudioRecorder } from '../hooks/useLocalAudioRecorder.ts';
```

在其他 `useRef` 宣告附近（例如 `roomRef` 之後）加入:

```typescript
  const activeRecordingSessionRef = useRef<string | null>(null);
```

- [ ] **Step 2: 加入 getter 與 hook 呼叫**

在 `publishPose` 定義之前加入:

```typescript
  const getMicTrack = useCallback((): MediaStreamTrack | null => {
    const pub = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Microphone);
    return pub?.track?.mediaStreamTrack ?? null;
  }, []);

  const getIdentity = useCallback((): string | null => {
    return roomRef.current?.localParticipant.identity ?? null;
  }, []);

  const localAudio = useLocalAudioRecorder(getMicTrack, getIdentity);
```

- [ ] **Step 3: 在 `DataReceived` handler 內新增 `recording-signal` 分支**

把:

```typescript
    room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant) => {
      if (!participant?.identity.startsWith('host-')) return;
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload)) as {
          type?: string;
          payload?: AIHintPayload;
          phase?: 'idle' | 'teacher' | 'generating' | 'student';
        };
        if (msg.type === 'ai-hint') {
          const p = msg.payload ?? null;
          if (isMounted) {
            setAiHint(p && p.content ? p : null);
            // New hint arrived from teacher — drop any stale student-side extension
            setExtension(null);
            setExtendError(null);
          }
        } else if (msg.type === 'interaction-phase' && msg.phase) {
          if (isMounted) setInteractionPhase(msg.phase);
        }
      } catch { /* pose / other messages */ }
    });
```

改成:

```typescript
    room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant) => {
      if (!participant?.identity.startsWith('host-')) return;
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload)) as {
          type?: string;
          payload?: AIHintPayload;
          phase?: 'idle' | 'teacher' | 'generating' | 'student';
          action?: 'start' | 'stop';
          sessionId?: string;
        };
        if (msg.type === 'ai-hint') {
          const p = msg.payload ?? null;
          if (isMounted) {
            setAiHint(p && p.content ? p : null);
            // New hint arrived from teacher — drop any stale student-side extension
            setExtension(null);
            setExtendError(null);
          }
        } else if (msg.type === 'interaction-phase' && msg.phase) {
          if (isMounted) setInteractionPhase(msg.phase);
        } else if (msg.type === 'recording-signal') {
          if (msg.action === 'start' && msg.sessionId) {
            activeRecordingSessionRef.current = msg.sessionId;
            localAudio.start();
          } else if (msg.action === 'stop') {
            const activeSessionId = activeRecordingSessionRef.current;
            activeRecordingSessionRef.current = null;
            if (activeSessionId) {
              void localAudio.stopAndUpload(roomId, activeSessionId);
            }
          }
        }
      } catch { /* pose / other messages */ }
    });
```

- [ ] **Step 4: 型別檢查**

Run: `cd frontend && npm run build`
Expected: PASS（無型別錯誤）

- [ ] **Step 5: 手動驗證（jsdom 無法模擬真實 MediaRecorder/麥克風，這段用實機驗證）**

在現有 `docker-compose.yml` 環境下（`docker compose up -d`）：
1. 老師端建房、至少一位學生用真實瀏覽器加入並允許麥克風權限。
2. 老師點「開始錄製」→ 對著麥克風說幾句話 → 點「停止錄製」。
3. 到 `./recordings/{sceneId}/{folder}/` 確認出現 `audio_{學生identity}.webm`（不再有任何 `.ogg` 檔案）。
4. 確認 `output.mp4` 合成後，學生的聲音有被混入（不只老師的聲音）。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/StudentSession.tsx
git commit -m "feat(frontend): 學生端收到錄製訊號時錄自己的麥克風並上傳"
```

---

### Task 4: 清理 — 移除 docker-compose 的 `livekit-egress`、更新文件

**Files:**
- Modify: `docker-compose.yml`
- Delete: `egress.yaml`
- Modify: `docs/recording-flow.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/TECH_STACK.md`

**Interfaces:** 無（純設定檔與文件清理，不影響程式介面）。

- [ ] **Step 1: 從 `docker-compose.yml` 移除 `livekit-egress` 服務**

刪除整個 `livekit-egress:` 服務區塊（含 `image`、`environment`、`volumes`、`depends_on`、`cap_add`）：

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

- [ ] **Step 2: 刪除 `egress.yaml`**

Run: `rm egress.yaml`

- [ ] **Step 3: 重啟 Docker Compose，確認服務正常**

Run: `docker compose up -d && docker compose ps`
Expected: 不再看到 `livekit-egress` 容器；`nginx`/`redis`/`livekit`/`backend`/`frontend` 皆為 healthy/running。

- [ ] **Step 4: 更新 `docs/recording-flow.md`**

把開頭「概覽」的三點改成:

```markdown
## 概覽

本系統採用雙軌錄製架構：
- **大屏畫面**（bigscreen.webm）：BigScreen 視窗的 Canvas 由瀏覽器端 MediaRecorder 錄製，停止後上傳至 backend
- **每位參與者音訊**（audio_*.webm）：每位參與者（老師 + 學生）各自的瀏覽器端 MediaRecorder 錄自己的麥克風，停止後上傳至 backend
```

把「檔案儲存路徑」區塊中的:

```
  audio_{identity}.ogg    ← 每位參與者音訊（LiveKit Egress，server-side）
  audio_{identity}.webm   ← 每位參與者音訊（Host 端 MediaRecorder，client-side）
```

改成:

```
  audio_{identity}.webm   ← 每位參與者音訊（瀏覽器端 MediaRecorder，client-side）
```

把「開始錄製」流程圖中 `EgressService.startRecording(...)` 那幾行拿掉，改成老師端額外透過 LiveKit `publishData(reliable)` 廣播 `recording-signal` 給學生、學生收到後啟動本機 MediaRecorder 的說明。

把「Docker Volume 配置」整節（提到 `livekit-egress` 的部分）與「音訊雙軌」小節（`.ogg` vs `.webm` 優先順序）整段移除,改成一句話：「所有參與者音訊統一是 `.webm`（瀏覽器端 MediaRecorder 上傳），不再有 server-side Egress 這條路徑。」

把「關鍵程式碼位置」表格中 `backend/src/egress.ts` 那一列改成 `backend/src/roomAdmin.ts`（並把說明改成「LiveKit RoomServiceClient，踢人/靜音」），新增一列 `frontend/src/hooks/useLocalAudioRecorder.ts`（說明：共用的本機麥克風錄音 hook，Host/Student 皆用）。

- [ ] **Step 5: 更新 `docs/ARCHITECTURE.md`**

第 3 節部署拓撲圖裡的 `LiveKit Egress`／`Redis` 那兩行:

```
   ┌────────────────┐ ┌──────────────┐   ┌────────┐
   │ LiveKit Egress │ │ LiveKit core │──▶│ Redis  │
   │ （音訊錄製）    │ └──────────────┘   └────────┘
   └────────────────┘
```

改成:

```
                     ┌──────────────┐   ┌────────┐
                     │ LiveKit core │──▶│ Redis  │
                     └──────────────┘   └────────┘
```

同節的服務職責表格拿掉 `LiveKit Egress` 那一列。

第 5 節後端模組表格中：

```
| `egress.ts` | `EgressService`：逐人 audio track egress（`.ogg`）、靜音、踢人（透過 LiveKit server SDK） |
```

改成:

```
| `roomAdmin.ts` | `RoomAdminService`：靜音、踢人（透過 LiveKit RoomServiceClient） |
```

第 7.4 節錄製管線圖:

```
start ─┬─ Egress 逐人 audio track → audio_{id}.ogg（server-side）
       ├─ Host MediaRecorder → audio_{id}.webm（client 備援）
       └─ BigScreen canvas.captureStream → bigscreen.webm（分塊 PATCH 上傳）
```

改成:

```
start ─┬─ 每位參與者（老師+學生）瀏覽器端 MediaRecorder → audio_{id}.webm
       └─ BigScreen canvas.captureStream → bigscreen.webm（分塊 PATCH 上傳）
```

第 9 節外部相依表格拿掉 `LiveKit（core + egress）` 那一列的 egress 部分，改成只提 `LiveKit（core）— WebRTC 媒體 / data channel`。

- [ ] **Step 6: 更新 `docs/TECH_STACK.md`**

第 2 節「媒體與錄製處理」的:

```markdown
* **媒體與錄製處理**:
  * **LiveKit Egress**: 負責伺服器端音軌錄製（輸出 `.ogg` 格式）。
  * **FFmpeg** (`ffmpeg-static`): 用於後端將大屏錄製的 WebM 影片與各使用者的音軌進行混音（amix）合成，產出最終的 MP4 課堂錄影檔。
```

改成:

```markdown
* **媒體與錄製處理**:
  * **瀏覽器端 MediaRecorder**: 每位參與者（老師 + 學生）各自錄製自己的麥克風音軌，停止後上傳至後端。
  * **FFmpeg** (`ffmpeg-static`): 用於後端將大屏錄製的 WebM 影片與各使用者的音軌進行混音（amix）合成，產出最終的 MP4 課堂錄影檔。
```

第 4 節「容器化技術」提到 Nginx/LiveKit Core/LiveKit Egress/Redis/Backend/Frontend 的那句，拿掉 `LiveKit Egress`。

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml docs/recording-flow.md docs/ARCHITECTURE.md docs/TECH_STACK.md
git rm egress.yaml
git commit -m "docs+chore: 移除 docker-compose 的 livekit-egress，更新文件反映新的錄製流程"
```
