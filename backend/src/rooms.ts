import { randomInt } from 'node:crypto'
import { v4 as uuidv4 } from 'uuid'

/** 房號位數：6 位數字，學生在平板上用數字鍵盤就能輸入 */
export const ROOM_CODE_LENGTH = 6

export interface JoinRequest {
  requestId: string
  roomId: string
  name: string
  status: 'pending' | 'approved' | 'rejected'
  token?: string
  createdAt: number
}

export interface Room {
  roomId: string
  hostToken: string
  requests: JoinRequest[]
  createdAt: number
}

export class RoomStore {
  private rooms = new Map<string, Room>()

  /** 產生進行中房間沒有用過的 6 位數房號（hostToken 仍為 UUID，房號只用來加入、需老師核准） */
  private generateRoomCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      const code = String(randomInt(0, 10 ** ROOM_CODE_LENGTH)).padStart(ROOM_CODE_LENGTH, '0')
      if (!this.rooms.has(code)) return code
    }
    // 理論上不會發生（同時進行的房間遠少於一百萬間）；保險起見退回 UUID
    return uuidv4()
  }

  createRoom(): { roomId: string; hostToken: string } {
    const roomId = this.generateRoomCode()
    const hostToken = uuidv4()
    this.rooms.set(roomId, { roomId, hostToken, requests: [], createdAt: Date.now() })
    return { roomId, hostToken }
  }

  getRoom(roomId: string): Room | undefined { return this.rooms.get(roomId) }

  validateHost(roomId: string, hostToken: string): boolean {
    const room = this.rooms.get(roomId)
    return room !== undefined && room.hostToken === hostToken
  }

  addJoinRequest(roomId: string, name: string): JoinRequest {
    const room = this.rooms.get(roomId)
    if (!room) throw new Error('Room not found')
    const request: JoinRequest = { requestId: uuidv4(), roomId, name, status: 'pending', createdAt: Date.now() }
    room.requests.push(request)
    return request
  }

  approveRequest(roomId: string, requestId: string, token: string): JoinRequest | undefined {
    const room = this.rooms.get(roomId)
    if (!room) return undefined
    const req = room.requests.find(r => r.requestId === requestId)
    if (!req) return undefined
    req.status = 'approved'
    req.token = token
    return req
  }

  rejectRequest(roomId: string, requestId: string): JoinRequest | undefined {
    const room = this.rooms.get(roomId)
    if (!room) return undefined
    const req = room.requests.find(r => r.requestId === requestId)
    if (!req) return undefined
    req.status = 'rejected'
    return req
  }

  getRequestStatus(roomId: string, requestId: string): JoinRequest | undefined {
    const room = this.rooms.get(roomId)
    if (!room) return undefined
    return room.requests.find(r => r.requestId === requestId)
  }

  getPendingRequests(roomId: string): JoinRequest[] {
    const room = this.rooms.get(roomId)
    if (!room) return []
    return room.requests.filter(r => r.status === 'pending')
  }

  cleanup(ttlMs: number): void {
    const now = Date.now()
    for (const [id, room] of this.rooms) {
      if (now - room.createdAt > ttlMs) this.rooms.delete(id)
    }
  }
}
