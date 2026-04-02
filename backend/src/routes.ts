import express, { Router, type Request, type Response } from 'express'
import path from 'path'
import fs from 'fs'
import { RoomStore } from './rooms.js'
import { createToken } from './livekit.js'
import type { RecordingStore } from './recording.js'
import type { EgressService } from './egress.js'

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
      if (!stopped) { res.status(500).json({ error: 'Failed to stop session' }); return }
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
      const room = store.getRoom(roomId)
      if (!room) { res.status(404).json({ error: 'Room not found' }); return }
      try {
        const dir = path.join(recordingsDir, roomId, sessionId)
        if (!dir.startsWith(recordingsDir + path.sep) && !dir.startsWith(recordingsDir + '/')) {
          res.status(400).json({ error: 'Invalid path' }); return
        }
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
    if (!filePath.startsWith(recordingsDir + path.sep) && !filePath.startsWith(recordingsDir + '/')) {
      res.status(400).json({ error: 'Invalid path' }); return
    }
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
