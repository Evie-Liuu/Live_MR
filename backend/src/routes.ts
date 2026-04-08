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
    const { sceneId, participantName } = req.body as { sceneId?: string; participantName?: string }

    const room = store.getRoom(roomId)
    if (!room) { res.status(404).json({ error: 'Room not found' }); return }

    const existing = recording.recordingStore.getActiveSession(roomId)
    if (existing) { res.status(409).json({ error: 'Already recording' }); return }

    try {
      const { randomUUID } = await import('crypto')
      const sessionId = randomUUID()

      // Format: [participantName_currentLocalTime]
      const now = new Date()
      const timestamp = now.getFullYear() +
        ('0' + (now.getMonth() + 1)).slice(-2) +
        ('0' + now.getDate()).slice(-2) + '-' +
        ('0' + now.getHours()).slice(-2) +
        ('0' + now.getMinutes()).slice(-2) +
        ('0' + now.getSeconds()).slice(-2)

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
