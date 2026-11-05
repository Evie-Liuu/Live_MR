import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import express from 'express'
import { RoomStore } from './rooms.js'
import { createRouter } from './routes.js'
import { guestNameCandidate, isReservedName, normalizeGuestName } from './guestJoin.js'

describe('normalizeGuestName', () => {
  it('cleans whitespace and control characters', () => {
    expect(normalizeGuestName('  小明\n  同學 ')).toBe('小明 同學')
  })

  it('rejects empty, too long, non-string and reserved names', () => {
    expect(normalizeGuestName('   ')).toBeNull()
    expect(normalizeGuestName('一'.repeat(21))).toBeNull()
    expect(normalizeGuestName('一'.repeat(20))).toBe('一'.repeat(20))
    expect(normalizeGuestName(123)).toBeNull()
    expect(normalizeGuestName('host-abc')).toBeNull()
    expect(normalizeGuestName(' HOST-abc')).toBeNull()
    expect(normalizeGuestName('__placeholder__:x')).toBeNull()
  })
})

describe('guest name helpers', () => {
  it('numbers duplicates from the second person', () => {
    expect(guestNameCandidate('小明', 1)).toBe('小明')
    expect(guestNameCandidate('小明', 2)).toBe('小明 2')
  })

  it('recognises reserved prefixes only at the start', () => {
    expect(isReservedName('my host-name')).toBe(false)
  })
})

describe('guest join routes', () => {
  let app: ReturnType<typeof express>
  let store: RoomStore
  let roomId: string
  const inRoom = new Set<string>()

  const join = (body: object) => request(app).post(`/api/rooms/${roomId}/join`).send(body)

  beforeEach(async () => {
    process.env.ENABLE_GUEST_JOIN = '1'
    inRoom.clear()
    store = new RoomStore()
    app = express()
    app.use(express.json())
    const roomAdmin = { isInRoom: async (_room: string, identity: string) => inRoom.has(identity) }
    const recordingStore = { clearRoom: () => {} }
    // 這裡只用得到 roomAdmin.isInRoom 和 recordingStore.clearRoom
    app.use('/api', createRouter(store, { roomAdmin, recordingStore } as never))
    roomId = (await request(app).post('/api/rooms')).body.roomId
  })

  afterEach(() => { delete process.env.ENABLE_GUEST_JOIN })

  it('reports whether guest join is enabled', async () => {
    expect((await request(app).get('/api/guest-join')).body).toEqual({ enabled: true })
    delete process.env.ENABLE_GUEST_JOIN
    expect((await request(app).get('/api/guest-join')).body).toEqual({ enabled: false })
  })

  it('refuses guests when disabled', async () => {
    delete process.env.ENABLE_GUEST_JOIN
    expect((await join({ name: '小明', guest: true })).status).toBe(403)
  })

  it('returns the cleaned name and waits for teacher approval', async () => {
    const res = await join({ name: ' 小明 ', guest: true })
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('小明')
    expect(store.getRequestStatus(roomId, res.body.requestId)?.status).toBe('pending')
  })

  it('numbers a name that is pending or already in the room', async () => {
    expect((await join({ name: '小明', guest: true })).body.name).toBe('小明')
    expect((await join({ name: '小明', guest: true })).body.name).toBe('小明 2')
    inRoom.add('小華')
    expect((await join({ name: '小華', guest: true })).body.name).toBe('小華 2')
  })

  it('does not hand out the same name to simultaneous guests', async () => {
    const results = await Promise.all([1, 2, 3].map(() => join({ name: '小明', guest: true })))
    expect(new Set(results.map(r => r.body.name)).size).toBe(3)
  })

  it('frees a name once its request is cancelled or rejected', async () => {
    const first = await join({ name: '小明', guest: true })
    store.cancelRequest(roomId, first.body.requestId)
    expect((await join({ name: '小明', guest: true })).body.name).toBe('小明')
  })

  it('rejects names that would impersonate the teacher', async () => {
    expect((await join({ name: 'host-fake', guest: true })).status).toBe(400)
    expect((await join({ name: 'host-fake' })).status).toBe(400)
  })

  it('leaves the logged-in join path alone', async () => {
    const res = await join({ name: 'Alice' })
    await join({ name: 'Alice' })
    expect(res.status).toBe(200)
    expect(res.body.name).toBeUndefined()
  })
})
