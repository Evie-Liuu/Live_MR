import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import { RoomStore } from './rooms.js'
import { openDatabase } from './db/connection.js'
import { SpeechFeedbackRepo } from './db/speechFeedbackRepo.js'
import { createSpeechRouter, type SpeechRouteDeps } from './speechRoutes.js'
import type { TurnJudgment } from './ai/speechJudge.js'

const severe: TurnJudgment = {
  transcript: 'I want 鳳梨酥', language: 'mixed', missing: ['try'], wrong: [], issues: ['chinese', 'incomplete'], severity: 'severe',
}

function body(over: Record<string, unknown> = {}) {
  return {
    studentId: 'stu01', studentName: '小明', taskTitle: '認識新同學', stepIndex: 2, lineIndex: 2,
    line: { en: "I've never tried them. I want to try them!", zh: '我從來沒吃過牛肉麵。我想試試看！' },
    prevLine: "I love beef noodles! They're really good.", level: 'A1-A2',
    audio: { data: 'UklGRg==', mimeType: 'audio/wav' }, audioSeconds: 4,
    ...over,
  }
}

describe('speech routes', () => {
  let store: RoomStore
  let roomId: string
  let hostToken: string
  let repo: SpeechFeedbackRepo
  let judge: ReturnType<typeof vi.fn>

  const createApp = (over: Partial<SpeechRouteDeps> = {}) => {
    const app = express()
    app.use(express.json({ limit: '5mb' }))
    app.use('/api', createSpeechRouter({ store, repo, judge: judge as unknown as SpeechRouteDeps['judge'], ...over }))
    return app
  }

  beforeEach(() => {
    store = new RoomStore()
    ;({ roomId, hostToken } = store.createRoom())
    repo = new SpeechFeedbackRepo(openDatabase(':memory:'))
    judge = vi.fn().mockResolvedValue({ judgment: severe, model: 'gemini-2.5-flash-lite', usage: { prompt: 650, output: 70, total: 720, audioPrompt: 128 } })
  })

  it('判斷一句、存紀錄並回傳費用', async () => {
    const res = await request(createApp()).post(`/api/rooms/${roomId}/speech-judge`).send(body())
    expect(res.status).toBe(200)
    expect(res.body.judgment).toEqual(severe)
    expect(res.body.costUsd).toBeGreaterThan(0)
    expect(judge).toHaveBeenCalledWith(expect.objectContaining({
      line: { en: body().line.en, zh: body().line.zh }, level: 'A1-A2', audio: { data: 'UklGRg==', mimeType: 'audio/wav' },
    }))
    const [rec] = repo.listByRoom(roomId)
    expect(rec).toMatchObject({ studentName: '小明', severity: 'severe', issues: ['chinese', 'incomplete'], audioTokens: 128, promptTokens: 650 })
  })

  it('沒有音訊明細時用每秒 32 token 估音訊', async () => {
    judge.mockResolvedValue({ judgment: severe, model: 'gemini-2.5-flash-lite', usage: { prompt: 650, output: 70, total: 720 } })
    await request(createApp()).post(`/api/rooms/${roomId}/speech-judge`).send(body())
    expect(repo.listByRoom(roomId)[0].audioTokens).toBe(128)
  })

  it('房間不存在 404、格式不對 400', async () => {
    const app = createApp()
    expect((await request(app).post('/api/rooms/999999/speech-judge').send(body())).status).toBe(404)
    expect((await request(app).post(`/api/rooms/${roomId}/speech-judge`).send(body({ studentId: 'a b' }))).status).toBe(400)
    expect((await request(app).post(`/api/rooms/${roomId}/speech-judge`).send(body({ audio: { data: 'x', mimeType: 'audio/webm' } }))).status).toBe(400)
    expect((await request(app).post(`/api/rooms/${roomId}/speech-judge`).send(body({ audioSeconds: 99 }))).status).toBe(400)
    expect(judge).not.toHaveBeenCalled()
  })

  it('同一位學生每分鐘次數有上限', async () => {
    const app = createApp({ maxPerMinute: 2 })
    expect((await request(app).post(`/api/rooms/${roomId}/speech-judge`).send(body())).status).toBe(200)
    expect((await request(app).post(`/api/rooms/${roomId}/speech-judge`).send(body())).status).toBe(200)
    expect((await request(app).post(`/api/rooms/${roomId}/speech-judge`).send(body())).status).toBe(429)
    expect((await request(app).post(`/api/rooms/${roomId}/speech-judge`).send(body({ studentId: 'stu02' }))).status).toBe(200)
  })

  it('AI 失敗回 502，沒設金鑰回 503', async () => {
    judge.mockRejectedValueOnce(new Error('boom')).mockRejectedValueOnce(new Error('GEMINI_API_KEY not configured'))
    const app = createApp()
    expect((await request(app).post(`/api/rooms/${roomId}/speech-judge`).send(body())).status).toBe(502)
    expect((await request(app).post(`/api/rooms/${roomId}/speech-judge`).send(body())).status).toBe(503)
  })

  it('試用判斷：不需課堂、不存紀錄、回傳用量；全部共用次數上限', async () => {
    const app = createApp({ previewPerMinute: 1 })
    const { studentId: _id, studentName: _name, ...preview } = body()
    const res = await request(app).post('/api/speech-judge/preview').send(preview)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ judgment: severe, model: 'gemini-2.5-flash-lite', usage: { prompt: 650, audio: 128, output: 70 } })
    expect(res.body.latencyMs).toBeGreaterThanOrEqual(0)
    expect(repo.listByRoom(roomId)).toHaveLength(0)
    expect((await request(app).post('/api/speech-judge/preview').send(preview)).status).toBe(429)
    expect((await request(createApp()).post('/api/speech-judge/preview').send({ ...preview, audio: { data: 'x', mimeType: 'audio/mp3' } })).status).toBe(400)
  })

  it('資料庫不可用時照常判斷', async () => {
    const res = await request(createApp({ repo: null })).post(`/api/rooms/${roomId}/speech-judge`).send(body())
    expect(res.status).toBe(200)
  })

  it('老師查紀錄：要 hostToken，回傳每位學生統計與用量', async () => {
    const app = createApp()
    await request(app).post(`/api/rooms/${roomId}/speech-judge`).send(body())
    await request(app).post(`/api/rooms/${roomId}/speech-judge`).send(body({ lineIndex: 3 }))
    expect((await request(app).get(`/api/rooms/${roomId}/speech-feedback`)).status).toBe(403)
    const res = await request(app).get(`/api/rooms/${roomId}/speech-feedback`).set('X-Host-Token', hostToken)
    expect(res.status).toBe(200)
    expect(res.body.records).toHaveLength(2)
    expect(res.body.usage).toMatchObject({ calls: 2, audioSeconds: 8, audioTokens: 256 })
    expect(res.body.students[0]).toMatchObject({ studentName: '小明', lines: 2, severe: 2, issues: { chinese: 2, incomplete: 2 } })
    expect(res.body.students[0].missing).toEqual([{ word: 'try', count: 2 }])
  })
})
