import { randomInt } from 'node:crypto'
import { v4 as uuidv4 } from 'uuid'

/** 房號位數：6 位數字，學生在平板上用數字鍵盤就能輸入 */
export const ROOM_CODE_LENGTH = 6

export interface JoinRequest {
  requestId: string
  roomId: string
  name: string
  /** cancelled：學生已離開等待頁（按返回、登出，或太久沒有輪詢狀態） */
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  token?: string
  createdAt: number
  /** 學生最後一次輪詢申請狀態的時間；等待頁每 2 秒輪詢一次，太久沒來代表學生已離開 */
  lastSeenAt: number
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
    const now = Date.now()
    const request: JoinRequest = { requestId: uuidv4(), roomId, name, status: 'pending', createdAt: now, lastSeenAt: now }
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

  /** 學生離開等待頁：只有還在等待中的申請會被取消（已核准／拒絕的維持原狀） */
  cancelRequest(roomId: string, requestId: string): JoinRequest | undefined {
    const req = this.getRequestStatus(roomId, requestId)
    if (!req || req.status !== 'pending') return undefined
    req.status = 'cancelled'
    return req
  }

  /**
   * 學生輪詢申請狀態時呼叫：更新最後出現時間。
   * 已取消的申請若學生又回來輪詢（例如平板切到別的 App 再切回來、或重新整理），代表他仍在等待，
   * 恢復成 pending 並回傳 revived=true，讓老師端名單重新出現。
   */
  touchRequest(roomId: string, requestId: string): { request: JoinRequest; revived: boolean } | undefined {
    const req = this.getRequestStatus(roomId, requestId)
    if (!req) return undefined
    req.lastSeenAt = Date.now()
    if (req.status !== 'cancelled') return { request: req, revived: false }
    req.status = 'pending'
    return { request: req, revived: true }
  }

  /** 把超過 maxIdleMs 沒輪詢的等待中申請標成取消，回傳被取消的申請（呼叫端負責通知老師） */
  expireStaleRequests(maxIdleMs: number, now = Date.now()): JoinRequest[] {
    const expired: JoinRequest[] = []
    for (const room of this.rooms.values()) {
      for (const req of room.requests) {
        if (req.status === 'pending' && now - req.lastSeenAt > maxIdleMs) {
          req.status = 'cancelled'
          expired.push(req)
        }
      }
    }
    return expired
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
