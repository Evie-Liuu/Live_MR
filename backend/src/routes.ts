import express, { Router, type Request, type Response } from 'express'
import path from 'path'
import fs from 'fs'
import { RoomStore } from './rooms.js'
import { createToken } from './livekit.js'
import type { RecordingStore } from './recording.js'
import type { EgressService } from './egress.js'
import { mergeRecording } from './merge.js'

const recordingsDir = path.resolve(process.cwd(), '../recordings')

/** Verify that resolvedPath is strictly inside recordingsDir. */
function assertInRecordingsDir(resolvedPath: string): void {
  if (
    !resolvedPath.startsWith(recordingsDir + path.sep) &&
    !resolvedPath.startsWith(recordingsDir + '/')
  ) {
    throw new Error('Path outside recordings directory')
  }
}

/**
 * Convert a basePath like /recordings/{sceneId}/{folderName}
 * to an absolute filesystem path inside recordingsDir.
 */
function basepathToDir(basePath: string): string {
  const rel = basePath.replace(/^\/recordings\//, '')
  return path.join(recordingsDir, rel)
}

interface RecordingDeps {
  recordingStore: RecordingStore
  egressService: EgressService
}

export function createRouter(store: RoomStore, recording?: RecordingDeps): Router {
  const router = Router()

  // Per-room event log + waiters for long polling
  interface QueuedEvent { id: number; type: string; [key: string]: unknown }
  interface RoomEventQueue {
    events: QueuedEvent[]
    nextId: number
    waiters: Array<() => void>
  }
  const EVENT_LOG_CAP = 100
  const LONG_POLL_TIMEOUT_MS = 25000
  const roomQueues = new Map<string, RoomEventQueue>()

  function getOrCreateQueue(roomId: string): RoomEventQueue {
    let q = roomQueues.get(roomId)
    if (!q) {
      q = { events: [], nextId: 1, waiters: [] }
      // Backfill with pending requests so reconnecting clients see them
      for (const req of store.getPendingRequests(roomId)) {
        q.events.push({ id: q.nextId++, type: 'join-request', requestId: req.requestId, name: req.name })
      }
      roomQueues.set(roomId, q)
    }
    return q
  }

  function notifyRoom(roomId: string, type: string, data: Record<string, unknown>): void {
    const q = getOrCreateQueue(roomId)
    q.events.push({ id: q.nextId++, type, ...data })
    while (q.events.length > EVENT_LOG_CAP) q.events.shift()
    const waiters = q.waiters.splice(0)
    for (const w of waiters) w()
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

  // GET /api/rooms/:roomId/events?since=N — long polling
  router.get('/rooms/:roomId/events', (req: Request, res: Response) => {
    const roomId = req.params.roomId as string
    const room = store.getRoom(roomId)

    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }

    const since = Number.parseInt((req.query.since as string) ?? '0', 10) || 0
    const q = getOrCreateQueue(roomId)

    const respond = (): void => {
      const events = q.events.filter((e) => e.id > since)
      const lastEventId = events.length > 0 ? events[events.length - 1]!.id : since
      res.json({ events, lastEventId })
    }

    if (q.events.some((e) => e.id > since)) {
      respond()
      return
    }

    let settled = false
    const waiter = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      respond()
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      q.waiters = q.waiters.filter((w) => w !== waiter)
      respond()
    }, LONG_POLL_TIMEOUT_MS)
    q.waiters.push(waiter)

    req.on('close', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      q.waiters = q.waiters.filter((w) => w !== waiter)
    })
  })

  // ── Recording endpoints ──────────────────────────────────────────────────────

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
      const { trackEgressIds, participantIdentities } = await recording.egressService.startRecording(
        roomId,
        basePath,
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

  router.get('/rooms/:roomId/recordings', (req: Request, res: Response) => {
    if (!recording) { res.json({ recordings: [] }); return }
    const roomId = req.params.roomId as string
    const recordings = recording.recordingStore.listSessions(roomId).map((s) => ({
      sessionId: s.sessionId,
      status: s.status,
      mergeStatus: s.mergeStatus,
      mergeOutput: s.mergeOutput,
      mergeError: s.mergeError,
      files: s.files,
      startedAt: s.startedAt,
    }))
    res.json({ recordings })
  })

  // GET /api/rooms/:roomId/recordings/:sessionId/merge — merge status
  router.get('/rooms/:roomId/recordings/:sessionId/merge', (req: Request, res: Response) => {
    if (!recording) { res.status(501).json({ error: 'Recording not configured' }); return }
    const { sessionId } = req.params as { roomId: string; sessionId: string }
    const session = recording.recordingStore.getSessionById(sessionId)
    if (!session) { res.status(404).json({ error: 'Session not found' }); return }
    res.json({
      sessionId: session.sessionId,
      mergeStatus: session.mergeStatus,
      mergeOutput: session.mergeOutput,
      mergeError: session.mergeError,
    })
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
      const session = recording.recordingStore.getSessionById(sessionId)
      if (!session) { res.status(404).json({ error: 'Session not found' }); return }
      try {
        const dir = basepathToDir(session.basePath)
        assertInRecordingsDir(dir)
        await fs.promises.mkdir(dir, { recursive: true })
        await fs.promises.writeFile(path.join(dir, 'bigscreen.webm'), req.body as Buffer)
        res.json({ ok: true })
      } catch (err: any) {
        console.error('[recording/bigscreen] error:', err?.message ?? err)
        res.status(500).json({ error: 'Failed to save bigscreen recording' })
      }
    },
  )

  // POST /api/rooms/:roomId/recording/audio — Participant audio upload
  router.post(
    '/rooms/:roomId/recording/audio',
    express.raw({ type: 'audio/*', limit: '100mb' }),
    async (req: Request, res: Response) => {
      if (!recording) { res.status(501).json({ error: 'Recording not configured' }); return }
      const roomId = req.params.roomId as string
      const sessionId = req.headers['x-session-id'] as string | undefined
      const identity = req.headers['x-participant-identity'] as string | undefined
      if (!sessionId || !identity) {
        res.status(400).json({ error: 'X-Session-Id and X-Participant-Identity headers required' })
        return
      }
      const session = recording.recordingStore.getSessionById(sessionId)
      if (!session) { res.status(404).json({ error: 'Session not found' }); return }
      try {
        const dir = basepathToDir(session.basePath)
        assertInRecordingsDir(dir)
        await fs.promises.mkdir(dir, { recursive: true })
        // Use .webm for client-side recording (usually produced by MediaRecorder in Chrome)
        const filename = `audio_${identity}.webm`
        await fs.promises.writeFile(path.join(dir, filename), req.body as Buffer)

        // Ensure this participant is tracked in the session so they appear in file list
        if (!session.participantIdentities.includes(identity)) {
          session.participantIdentities.push(identity)
        }

        res.json({ ok: true })
      } catch (err: any) {
        console.error('[recording/audio] error:', err?.message ?? err)
        res.status(500).json({ error: 'Failed to save audio recording' })
      }
    },
  )

  // GET /api/recordings/:roomId/:sessionId/:filename — file download
  router.get('/recordings/:roomId/:sessionId/:filename', (req: Request, res: Response) => {
    const { sessionId, filename } = req.params as {
      roomId: string; sessionId: string; filename: string
    }
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      res.status(400).json({ error: 'Invalid filename' })
      return
    }
    if (!recording) { res.status(501).json({ error: 'Recording not configured' }); return }
    const session = recording.recordingStore.getSessionById(sessionId)
    if (!session) { res.status(404).json({ error: 'Session not found' }); return }
    try {
      const dir = basepathToDir(session.basePath)
      const filePath = path.join(dir, filename)
      assertInRecordingsDir(filePath)
      res.download(filePath, filename, (err) => {
        if (err && !res.headersSent) res.status(404).json({ error: 'File not found' })
      })
    } catch {
      res.status(400).json({ error: 'Invalid path' })
    }
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
