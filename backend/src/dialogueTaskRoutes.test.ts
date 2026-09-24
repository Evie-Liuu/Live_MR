import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { openDatabase } from './db/connection.js'
import { DialogueTaskRepo } from './db/dialogueTaskRepo.js'
import { createDialogueTaskRouter, type DialogueTaskRouteDeps } from './dialogueTaskRoutes.js'
import type { DialogueTask } from './dialogueTaskTypes.js'

function sampleTask(title = '服飾店購物'): DialogueTask {
  return {
    title, sceneId: 'clothingStore_cashier', level: 'A1',
    steps: [{
      id: 's1', title: '招呼', purpose: '問候引導',
      lines: [
        { id: 'l1', speakerSlotId: 'cashier', en: 'Hello! How can I help you today?', zh: '你好！請問有什麼可以幫你？' },
        { id: 'l2', speakerSlotId: 'customer', en: "I'm looking for a T-shirt.", zh: '我在找 T 恤。' },
      ],
      grammarPoints: ['How can I help you?'], grammarNote: '用於開場。', teachingNotes: ['引導學生說完整句子。'],
    }],
  }
}

function createApp(deps: DialogueTaskRouteDeps) {
  const app = express()
  app.use(express.json())
  app.use('/api/dialogue-tasks', createDialogueTaskRouter(deps))
  return app
}

describe('dialogue task routes', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    app = createApp({ repo: new DialogueTaskRepo(openDatabase(':memory:')) })
  })

  it('returns 503 for every endpoint when repo is null', async () => {
    const noDb = createApp({ repo: null })
    expect((await request(noDb).get('/api/dialogue-tasks?teacherUid=t1')).status).toBe(503)
    expect((await request(noDb).post('/api/dialogue-tasks').send({ teacherUid: 't1', task: sampleTask() })).status).toBe(503)
  })

  it('creates, lists, gets, updates and deletes a task', async () => {
    const created = await request(app).post('/api/dialogue-tasks').send({ teacherUid: 't1', institutionId: 'i1', task: sampleTask() })
    expect(created.status).toBe(201)
    const id = created.body.id as string
    expect(created.body.institutionId).toBe('i1')
    expect(created.body.task.steps[0].lines).toHaveLength(2)

    const list = await request(app).get('/api/dialogue-tasks?teacherUid=t1')
    expect(list.body).toEqual([expect.objectContaining({ id, title: '服飾店購物', level: 'A1', stepCount: 1 })])
    expect((await request(app).get('/api/dialogue-tasks?teacherUid=t2')).body).toEqual([])

    const updated = await request(app).patch(`/api/dialogue-tasks/${id}`).send({ task: { ...sampleTask('新標題'), steps: [] } })
    expect(updated.status).toBe(200)
    expect(updated.body.task.title).toBe('新標題')
    expect(updated.body.task.steps).toEqual([])

    expect((await request(app).get(`/api/dialogue-tasks/${id}`)).body.task.title).toBe('新標題')
    expect((await request(app).post(`/api/dialogue-tasks/${id}/delete`)).status).toBe(200)
    expect((await request(app).get(`/api/dialogue-tasks/${id}`)).status).toBe(404)
  })

  it('strips unknown fields from the stored task', async () => {
    const task = { ...sampleTask(), extra: 'x', steps: [{ ...sampleTask().steps[0], hacked: true }] }
    const res = await request(app).post('/api/dialogue-tasks').send({ teacherUid: 't1', task })
    expect(res.body.task).not.toHaveProperty('extra')
    expect(res.body.task.steps[0]).not.toHaveProperty('hacked')
  })

  it('rejects malformed input', async () => {
    const post = (body: unknown) => request(app).post('/api/dialogue-tasks').send(body as object)
    expect((await post({ task: sampleTask() })).status).toBe(400)
    expect((await post({ teacherUid: 't1', task: { ...sampleTask(), title: '  ' } })).status).toBe(400)
    expect((await post({ teacherUid: 't1', task: { ...sampleTask(), level: 'C2' } })).status).toBe(400)
    expect((await post({ teacherUid: 't1', task: { ...sampleTask(), steps: [{ id: 's1' }] } })).status).toBe(400)
    expect((await request(app).get('/api/dialogue-tasks')).status).toBe(400)
  })

  it('returns 404 for unknown ids', async () => {
    expect((await request(app).get('/api/dialogue-tasks/zzz')).status).toBe(404)
    expect((await request(app).patch('/api/dialogue-tasks/zzz').send({ task: sampleTask() })).status).toBe(404)
    expect((await request(app).post('/api/dialogue-tasks/zzz/delete')).status).toBe(404)
  })
})
