import { describe, it, expect, beforeEach } from 'vitest'
import { RoomStore } from './rooms.js'

describe('RoomStore', () => {
  let store: RoomStore

  beforeEach(() => {
    store = new RoomStore()
  })

  describe('createRoom', () => {
    it('returns roomId and hostToken', () => {
      const result = store.createRoom()
      expect(result.roomId).toBeDefined()
      expect(result.hostToken).toBeDefined()
      expect(result.roomId).not.toBe(result.hostToken)
    })

    it('creates unique rooms', () => {
      const r1 = store.createRoom()
      const r2 = store.createRoom()
      expect(r1.roomId).not.toBe(r2.roomId)
    })
  })

  describe('getRoom', () => {
    it('returns the room after creation', () => {
      const { roomId } = store.createRoom()
      const room = store.getRoom(roomId)
      expect(room).toBeDefined()
      expect(room!.roomId).toBe(roomId)
      expect(room!.requests).toEqual([])
    })

    it('returns undefined for unknown room', () => {
      expect(store.getRoom('nonexistent')).toBeUndefined()
    })
  })

  describe('validateHost', () => {
    it('returns true for correct hostToken', () => {
      const { roomId, hostToken } = store.createRoom()
      expect(store.validateHost(roomId, hostToken)).toBe(true)
    })

    it('returns false for wrong hostToken', () => {
      const { roomId } = store.createRoom()
      expect(store.validateHost(roomId, 'wrong-token')).toBe(false)
    })

    it('returns false for unknown room', () => {
      expect(store.validateHost('nonexistent', 'token')).toBe(false)
    })
  })

  describe('addJoinRequest', () => {
    it('adds a pending join request', () => {
      const { roomId } = store.createRoom()
      const req = store.addJoinRequest(roomId, 'Alice')
      expect(req.requestId).toBeDefined()
      expect(req.roomId).toBe(roomId)
      expect(req.name).toBe('Alice')
      expect(req.status).toBe('pending')
    })

    it('throws for unknown room', () => {
      expect(() => store.addJoinRequest('nonexistent', 'Alice')).toThrow('Room not found')
    })
  })

  describe('approveRequest', () => {
    it('approves a request and sets token', () => {
      const { roomId } = store.createRoom()
      const req = store.addJoinRequest(roomId, 'Alice')
      const approved = store.approveRequest(roomId, req.requestId, 'livekit-token')
      expect(approved).toBeDefined()
      expect(approved!.status).toBe('approved')
      expect(approved!.token).toBe('livekit-token')
    })

    it('returns undefined for unknown room', () => {
      expect(store.approveRequest('nonexistent', 'req', 'token')).toBeUndefined()
    })

    it('returns undefined for unknown request', () => {
      const { roomId } = store.createRoom()
      expect(store.approveRequest(roomId, 'nonexistent', 'token')).toBeUndefined()
    })
  })

  describe('rejectRequest', () => {
    it('rejects a request', () => {
      const { roomId } = store.createRoom()
      const req = store.addJoinRequest(roomId, 'Bob')
      const rejected = store.rejectRequest(roomId, req.requestId)
      expect(rejected).toBeDefined()
      expect(rejected!.status).toBe('rejected')
    })

    it('returns undefined for unknown room', () => {
      expect(store.rejectRequest('nonexistent', 'req')).toBeUndefined()
    })

    it('returns undefined for unknown request', () => {
      const { roomId } = store.createRoom()
      expect(store.rejectRequest(roomId, 'nonexistent')).toBeUndefined()
    })
  })

  describe('getRequestStatus', () => {
    it('returns the request with current status', () => {
      const { roomId } = store.createRoom()
      const req = store.addJoinRequest(roomId, 'Alice')
      const status = store.getRequestStatus(roomId, req.requestId)
      expect(status).toBeDefined()
      expect(status!.name).toBe('Alice')
      expect(status!.status).toBe('pending')
    })

    it('returns undefined for unknown room', () => {
      expect(store.getRequestStatus('nonexistent', 'req')).toBeUndefined()
    })

    it('returns undefined for unknown request', () => {
      const { roomId } = store.createRoom()
      expect(store.getRequestStatus(roomId, 'nonexistent')).toBeUndefined()
    })
  })

  describe('getPendingRequests', () => {
    it('returns only pending requests', () => {
      const { roomId } = store.createRoom()
      const r1 = store.addJoinRequest(roomId, 'Alice')
      store.addJoinRequest(roomId, 'Bob')
      store.approveRequest(roomId, r1.requestId, 'token')
      const pending = store.getPendingRequests(roomId)
      expect(pending).toHaveLength(1)
      expect(pending[0].name).toBe('Bob')
    })

    it('returns empty array for unknown room', () => {
      expect(store.getPendingRequests('nonexistent')).toEqual([])
    })
  })

  describe('cleanup', () => {
    it('removes rooms older than ttl', () => {
      const { roomId } = store.createRoom()
      // Manually adjust createdAt to simulate old room
      const room = store.getRoom(roomId)!
      room.createdAt = Date.now() - 10000
      store.cleanup(5000)
      expect(store.getRoom(roomId)).toBeUndefined()
    })

    it('keeps rooms within ttl', () => {
      const { roomId } = store.createRoom()
      store.cleanup(60000)
      expect(store.getRoom(roomId)).toBeDefined()
    })
  })
})
