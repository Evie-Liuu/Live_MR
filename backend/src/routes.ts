import { Router, type Request, type Response } from 'express'
import { RoomStore } from './rooms.js'
import { createToken } from './livekit.js'

export function createRouter(store: RoomStore): Router {
  const router = Router()

  // SSE clients per room
  const sseClients = new Map<string, Set<Response>>()

  function notifyRoom(roomId: string, event: string, data: unknown): void {
    const clients = sseClients.get(roomId)
    if (!clients) return
    for (const res of clients) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }
  }

  // POST /rooms/create — create room, return roomId + hostToken + livekitToken
  router.post('/rooms/create', async (_req: Request, res: Response) => {
    try {
      const { roomId, hostToken } = store.createRoom()
      const livekitToken = await createToken(roomId, 'host', true)
      res.json({ roomId, hostToken, livekitToken })
    } catch (err) {
      res.status(500).json({ error: 'Failed to create room' })
    }
  })

  // POST /rooms/join-request — student submits {roomId, name}, returns {requestId}
  router.post('/rooms/join-request', (req: Request, res: Response) => {
    const { roomId, name } = req.body as { roomId?: string; name?: string }
    if (!roomId || !name) {
      res.status(400).json({ error: 'roomId and name are required' })
      return
    }
    const room = store.getRoom(roomId)
    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }
    const request = store.addJoinRequest(roomId, name)
    notifyRoom(roomId, 'join-request', { requestId: request.requestId, name: request.name })
    res.json({ requestId: request.requestId })
  })

  // GET /rooms/:roomId/request-status/:requestId — student polls status
  router.get('/rooms/:roomId/request-status/:requestId', (req: Request, res: Response) => {
    const { roomId, requestId } = req.params
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

  // POST /rooms/approve — host approves {roomId, requestId, hostToken}
  router.post('/rooms/approve', async (req: Request, res: Response) => {
    const { roomId, requestId, hostToken } = req.body as { roomId?: string; requestId?: string; hostToken?: string }
    if (!roomId || !requestId || !hostToken) {
      res.status(400).json({ error: 'roomId, requestId, and hostToken are required' })
      return
    }
    if (!store.validateHost(roomId, hostToken)) {
      res.status(403).json({ error: 'Invalid host token' })
      return
    }
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

  // POST /rooms/reject — host rejects {roomId, requestId, hostToken}
  router.post('/rooms/reject', (req: Request, res: Response) => {
    const { roomId, requestId, hostToken } = req.body as { roomId?: string; requestId?: string; hostToken?: string }
    if (!roomId || !requestId || !hostToken) {
      res.status(400).json({ error: 'roomId, requestId, and hostToken are required' })
      return
    }
    if (!store.validateHost(roomId, hostToken)) {
      res.status(403).json({ error: 'Invalid host token' })
      return
    }
    const rejected = store.rejectRequest(roomId, requestId)
    if (!rejected) {
      res.status(404).json({ error: 'Request not found' })
      return
    }
    notifyRoom(roomId, 'request-rejected', { requestId })
    res.json({ status: 'rejected' })
  })

  // GET /rooms/:roomId/events — SSE stream
  router.get('/rooms/:roomId/events', (req: Request, res: Response) => {
    const { roomId } = req.params
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

    // Send all pending requests on connect (for reconnect support)
    const pending = store.getPendingRequests(roomId)
    for (const req of pending) {
      res.write(`event: join-request\ndata: ${JSON.stringify({ requestId: req.requestId, name: req.name })}\n\n`)
    }

    // Register SSE client
    if (!sseClients.has(roomId)) {
      sseClients.set(roomId, new Set())
    }
    sseClients.get(roomId)!.add(res)

    // Cleanup on close
    req.on('close', () => {
      const clients = sseClients.get(roomId)
      if (clients) {
        clients.delete(res)
        if (clients.size === 0) sseClients.delete(roomId)
      }
    })
  })

  return router
}
