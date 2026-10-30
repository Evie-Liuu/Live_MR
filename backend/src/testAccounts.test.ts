import { describe, it, expect, afterEach } from 'vitest'
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
