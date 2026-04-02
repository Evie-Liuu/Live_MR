# Recording Improvements Design

**Date:** 2026-04-02
**Scope:** 4 fixes to the existing recording system

---

## Background

The current recording system uses LiveKit Egress to record:
1. A room composite (default Grid layout — does NOT show VRM avatars)
2. Per-participant audio tracks (OGG per identity)

Four issues need to be resolved:

| # | Issue | Severity |
|---|-------|----------|
| 1 | Composite records LiveKit Grid, not the actual BigScreen VRM view | High |
| 2 | Late joiners miss audio recording | Low (not a real workflow issue) |
| 3 | `stopSession` always saves `files: []` | High |
| 4 | No file download endpoint | High |

Issue 2 is deferred — recording always starts after all students have joined.

---

## Architecture

```
HostSession (browser)
  │
  ├─ BroadcastChannel ──► BigScreen (browser)
  │    recording-start        canvas.captureStream()
  │    recording-stop         MediaRecorder → blob → POST /api/.../bigscreen
  │
  └─ POST /api/rooms/:roomId/recording/start
       │
       backend (EgressService)
         ├─ startTrackCompositeEgress × N participants → audio_{identity}.ogg
         └─ (no more startRoomCompositeEgress)

./recordings/{roomId}/{sessionId}/
  ├─ bigscreen.webm       ← uploaded by BigScreen browser
  └─ audio_{identity}.ogg ← written by livekit-egress container
```

---

## Issue 1: BigScreen Recording

### BroadcastChannel — new message types

Add to `BigScreenMsg` union in `BigScreen.tsx`:

```ts
| { type: 'recording-start'; sessionId: string }
| { type: 'recording-stop' }
```

### HostSession changes

In `useRecording` hook (or equivalent), after receiving the `sessionId` from the backend start response, broadcast:

```ts
channel.postMessage({ type: 'recording-start', sessionId })
```

On stop, broadcast:

```ts
channel.postMessage({ type: 'recording-stop' })
```

### BigScreen changes

On `recording-start`:
- `const stream = canvasRef.current.captureStream(30)`
- `new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' })`
- Collect chunks via `ondataavailable`

On `recording-stop`:
- Finalize `MediaRecorder`
- POST blob to `POST /api/rooms/:roomId/recording/bigscreen` with body `{ sessionId }`
- Uses `roomId` from URL param `?roomId=xxx` (already available in BigScreen via query string, or passed via sessionStorage)

BigScreen needs `roomId` available. It can be read from `sessionStorage` — HostSession already writes state there before opening the BigScreen window.

### Backend — new endpoint

`POST /api/rooms/:roomId/recording/bigscreen`

- Body: multipart or raw blob with `sessionId` header
- Saves to `./recordings/{roomId}/{sessionId}/bigscreen.webm`
- Returns `{ ok: true }`

Use `multer` or Node.js raw body parsing for the file upload.

### EgressService changes

Remove `startRoomCompositeEgress` call from `startRecording`. Only per-participant audio egresses remain.

---

## Issue 3: files Always Empty

### RecordingSession — add basePath

```ts
export interface RecordingSession {
  // ...existing fields...
  basePath: string            // /recordings/{roomId}/{sessionId}
  participantIdentities: string[]  // identities at recording start
}
```

### startSession — store basePath

Pass `basePath` and `participantIdentities` when creating the session.

### stopSession — reconstruct file list

```ts
stopSession(roomId: string): RecordingSession | null {
  const session = this.getActiveSession(roomId)
  if (!session) return null
  session.status = 'stopped'
  session.files = [
    `${session.basePath}/bigscreen.webm`,
    ...session.participantIdentities.map(id => `${session.basePath}/audio_${id}.ogg`)
  ]
  return session
}
```

Remove the `files` parameter from `stopSession` — it's now derived internally.

---

## Issue 4: File Download Endpoint

### New route

`GET /api/recordings/:roomId/:sessionId/:filename`

- Validates filename contains no path traversal (`..`)
- Streams file from `{recordingsDir}/{roomId}/{sessionId}/{filename}`
- Returns 404 if not found

`recordingsDir` = `path.resolve(process.cwd(), '../recordings')`

### Update recordings list

`GET /api/rooms/:roomId/recordings` — `files` field becomes relative paths like:
```
recordings/{roomId}/{sessionId}/bigscreen.webm
```

Frontend constructs download URL as `/api/recordings/{roomId}/{sessionId}/bigscreen.webm`.

---

## Files Changed

| File | Change |
|------|--------|
| `backend/src/recording.ts` | Add `basePath`, `participantIdentities`; fix `stopSession` |
| `backend/src/egress.ts` | Remove `startRoomCompositeEgress`; return `participantIdentities` |
| `backend/src/routes.ts` | Add bigscreen upload endpoint; add file download endpoint; fix stopSession call |
| `frontend/src/components/BigScreen.tsx` | Handle `recording-start`/`recording-stop` messages; upload WebM |
| `frontend/src/hooks/useRecording.ts` | Broadcast recording-start/stop via BroadcastChannel |

---

## Out of Scope

- Late joiner audio (deferred — workflow always starts recording after all students join)
- Authentication on file download endpoints (internal LAN use only)
- Video transcoding or format conversion
