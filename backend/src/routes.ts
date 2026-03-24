import { Router, type Request, type Response } from 'express'
import { RoomStore } from './rooms.js'
import { createToken } from './livekit.js'

export function createRouter(store: RoomStore): Router {
  const router = Router()

  // SSE 客户端室
  const sseClients = new Map<string, Set<Response>>()

  // 統一發送 SSE 事件的方法，配合前端 source.onmessage
  function notifyRoom(roomId: string, type: string, data: Record<string, any>): void {
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
      // const hostId = `host`
      const livekitToken = await createToken(roomId, hostId, true)
      res.json({ roomId, hostToken, livekitToken })
    } catch (err) {
      res.status(500).json({ error: 'Failed to create room' })
    }
  })

  // POST /api/rooms/:roomId/join — 學生提交申請 { name }
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

    // 通知老師 (符合 RoomEvent 格式)
    notifyRoom(roomId, 'join-request', {
      requestId: request.requestId,
      name: request.name
    })

    res.json({ requestId: request.requestId })
  })

  // GET /api/rooms/:roomId/requests/:requestId — 學生輪詢狀態
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

  // POST /api/rooms/:roomId/requests/:requestId/approve — 老師允許
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

  // POST /api/rooms/:roomId/requests/:requestId/reject — 老師拒絕
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

  // GET /api/rooms/:roomId/events — SSE 串流
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

    // 發送現有的待審核請求 (同步狀態)
    const pending = store.getPendingRequests(roomId)
    for (const req of pending) {
      const payload = JSON.stringify({ type: 'join-request', requestId: req.requestId, name: req.name })
      res.write(`data: ${payload}\n\n`)
    }

    // 註冊客戶端
    if (!sseClients.has(roomId)) {
      sseClients.set(roomId, new Set())
    }
    sseClients.get(roomId)!.add(res)

    // 關閉時清理
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
