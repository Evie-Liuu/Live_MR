import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import express from 'express'
import { RoomStore } from './rooms.js'
import { createRouter } from './routes.js'
import { authenticateTestAccount, hashPassword, verifyPassword, type TestAccount } from './testAccounts.js'

const accounts: TestAccount[] = [
  { username: 'stu01', displayName: 'S01', role: 'student', passwordHash: hashPassword('EngTest123!') },
  { username: 'tea01', displayName: 'T01', role: 'teacher', passwordHash: hashPassword('EngTest123!') },
]

describe('testAccounts', () => {
  it('密碼雜湊可驗證、錯的密碼不過', () => {
    const h = hashPassword('pw')
    expect(h).not.toContain('pw$')
    expect(verifyPassword('pw', h)).toBe(true)
    expect(verifyPassword('pW', h)).toBe(false)
    expect(verifyPassword('pw', 'garbage')).toBe(false)
  })

  it('帳號不分大小寫，回傳學生身分與顯示名稱', () => {
    expect(authenticateTestAccount(accounts, ' STU01 ', 'EngTest123!'))
      .toEqual({ uid: 'stu01', full_name: 'S01', role: 'student', test_account: true })
    expect(authenticateTestAccount(accounts, 'stu01', 'wrong')).toBeNull()
    expect(authenticateTestAccount(accounts, 'stu02', 'EngTest123!')).toBeNull()
    expect(authenticateTestAccount(accounts, 'tea01', 'EngTest123!')).toMatchObject({ full_name: 'T01', role: 'teacher' })
  })
})

describe('POST /api/test-auth/login', () => {
  const app = express()
  app.use(express.json())
  app.use('/api', createRouter(new RoomStore()))
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'livemr-test-accounts-')), 'accounts.json')
  fs.writeFileSync(file, JSON.stringify(accounts))

  afterEach(() => {
    delete process.env.ENABLE_TEST_ACCOUNTS
    delete process.env.TEST_ACCOUNTS_FILE
  })

  it('沒啟用時 404', async () => {
    process.env.TEST_ACCOUNTS_FILE = file
    const res = await request(app).post('/api/test-auth/login').send({ username: 'stu01', password: 'EngTest123!' })
    expect(res.status).toBe(404)
  })

  it('啟用後驗證帳密', async () => {
    process.env.ENABLE_TEST_ACCOUNTS = '1'
    process.env.TEST_ACCOUNTS_FILE = file
    const ok = await request(app).post('/api/test-auth/login').send({ username: 'stu01', password: 'EngTest123!' })
    expect(ok.status).toBe(200)
    expect(ok.body.user).toMatchObject({ uid: 'stu01', full_name: 'S01', role: 'student' })
    expect((await request(app).post('/api/test-auth/login').send({ username: 'stu01', password: 'x' })).status).toBe(401)
    expect((await request(app).post('/api/test-auth/login').send({ username: 'stu01' })).status).toBe(400)
  })
})

describe('測試帳號已在教室時不能重複進入', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'livemr-test-accounts-')), 'accounts.json')
  fs.writeFileSync(file, JSON.stringify(accounts))
  const login = { username: 'stu01', password: 'EngTest123!' }

  function setup(isInRoom: (roomId: string, identity: string) => Promise<boolean>) {
    const store = new RoomStore()
    const app = express()
    app.use(express.json())
    app.use('/api', createRouter(store, { recordingStore: {}, roomAdmin: { isInRoom } } as any))
    const { roomId, hostToken } = store.createRoom()
    const approve = (requestId: string) => request(app)
      .post(`/api/rooms/${roomId}/requests/${requestId}/approve`).set('X-Host-Token', hostToken)
    return { store, app, roomId, approve }
  }

  beforeEach(() => {
    process.env.ENABLE_TEST_ACCOUNTS = '1'
    process.env.TEST_ACCOUNTS_FILE = file
  })
  afterEach(() => {
    delete process.env.ENABLE_TEST_ACCOUNTS
    delete process.env.TEST_ACCOUNTS_FILE
  })

  it('已在任一教室時登入回 409，不在時正常登入', async () => {
    let online = true
    const { app, roomId } = setup(async (room, id) => online && room === roomId && id === 'S01')
    expect((await request(app).post('/api/test-auth/login').send(login)).status).toBe(409)
    online = false
    expect((await request(app).post('/api/test-auth/login').send(login)).status).toBe(200)
  })

  it('密碼錯誤仍回 401，不透露帳號是否在線', async () => {
    const { app } = setup(async () => true)
    expect((await request(app).post('/api/test-auth/login').send({ ...login, password: 'x' })).status).toBe(401)
  })

  it('LiveKit 查詢失敗時不擋登入', async () => {
    const { app } = setup(async () => { throw new Error('connect ECONNREFUSED') })
    expect((await request(app).post('/api/test-auth/login').send(login)).status).toBe(200)
  })

  it('另一台裝置申請加入同一教室時回 409；非測試帳號不受影響', async () => {
    const { app, roomId } = setup(async () => true)
    expect((await request(app).post(`/api/rooms/${roomId}/join`).send({ name: 'S01' })).status).toBe(409)
    expect((await request(app).post(`/api/rooms/${roomId}/join`).send({ name: '王小明' })).status).toBe(200)
  })

  it('同名申請同時核准只會通過一筆，另一筆標為拒絕', async () => {
    const { store, roomId, approve } = setup(async () => false)
    const a = store.addJoinRequest(roomId, 'S01')
    const b = store.addJoinRequest(roomId, 'S01')
    const statuses = (await Promise.all([approve(a.requestId), approve(b.requestId)])).map(r => r.status).sort()
    expect(statuses).toEqual([200, 409])
    expect([a.status, b.status].sort()).toEqual(['approved', 'rejected'])
  })

  it('核准超過時限且已不在教室時可以再核准（重新加入）', async () => {
    const { store, roomId, approve } = setup(async () => false)
    const first = store.addJoinRequest(roomId, 'S01')
    store.approveRequest(roomId, first.requestId, 'token')
    first.approvedAt = Date.now() - 60000
    const again = store.addJoinRequest(roomId, 'S01')
    expect((await approve(again.requestId)).status).toBe(200)
  })

  it('非測試帳號的同名申請照舊可以核准', async () => {
    const { store, roomId, approve } = setup(async () => true)
    const a = store.addJoinRequest(roomId, '王小明')
    expect((await approve(a.requestId)).status).toBe(200)
  })
})
