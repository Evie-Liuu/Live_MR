import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import { openDatabase } from './db/connection.js'
import { LessonPlanRepo } from './db/lessonPlanRepo.js'
import { createLessonPlanRouter, type LessonPlanRouteDeps } from './lessonPlanRoutes.js'
import type { LessonPlan } from './lessonPlanTypes.js'

const sceneContext = {
  sceneId: 'clothingStore_cashier', themeLabel: '服飾店', sceneLabel: '收銀台', sceneLabelEn: 'Cashier',
  slots: [{ id: 'cashier', label: '收銀員' }], existingModuleLabels: [], exampleTasks: [],
}

function fakePlan(planId: string): LessonPlan {
  return {
    title: 'T', sceneId: 'clothingStore_cashier', topic: 'returns', level: 'A1', durationMin: 15,
    objectives: ['o'], timeline: [{ phase: 'p', minutes: 15, activity: 'a', teacherScript: 's' }],
    grammarNotes: [], teachingNotes: [], sceneConstraint: 'c',
    modules: [{ id: `plan_${planId}_m1`, label: 'M', icon: '📘', tasks: [
      { id: `plan_${planId}_1`, label: 'Ask.', hint: { keyStructure: 'k', partialSentence: 'p', unscramble: ['Hi.'], completeSentence: 'Hi.', extraPhrases: [] } },
    ] }],
  }
}

function createApp(deps: LessonPlanRouteDeps) {
  const app = express()
  app.use(express.json())
  app.use('/api/lesson-plans', createLessonPlanRouter(deps))
  return app
}

const validBody = { teacherUid: 't1', institutionId: 'i1', sceneId: 'clothingStore_cashier', sceneContext, topic: 'returns', level: 'A1' }

describe('lesson plan routes', () => {
  let repo: LessonPlanRepo
  let generate: ReturnType<typeof vi.fn>
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    repo = new LessonPlanRepo(openDatabase(':memory:'))
    generate = vi.fn(async (_req: unknown, planId: string) => fakePlan(planId))
    app = createApp({ repo, generate: generate as unknown as LessonPlanRouteDeps['generate'] })
  })

  it('returns 503 for every endpoint when repo is null', async () => {
    const noDb = createApp({ repo: null })
    expect((await request(noDb).get('/api/lesson-plans?teacherUid=t1')).status).toBe(503)
    expect((await request(noDb).post('/api/lesson-plans/generate').send(validBody)).status).toBe(503)
  })

  it('generate validates the body', async () => {
    expect((await request(app).post('/api/lesson-plans/generate').send({ ...validBody, teacherUid: '' })).status).toBe(400)
    expect((await request(app).post('/api/lesson-plans/generate').send({ ...validBody, level: 'C2' })).status).toBe(400)
    expect((await request(app).post('/api/lesson-plans/generate').send({ ...validBody, topic: 'x'.repeat(201) })).status).toBe(400)
    expect((await request(app).post('/api/lesson-plans/generate').send({ ...validBody, sceneContext: null })).status).toBe(400)
    expect(generate).not.toHaveBeenCalled()
  })

  it('generate stores and returns the record', async () => {
    const res = await request(app).post('/api/lesson-plans/generate').send(validBody)
    expect(res.status).toBe(201)
    expect(res.body.teacherUid).toBe('t1')
    expect(res.body.institutionId).toBe('i1')
    expect(res.body.plan.title).toBe('T')
    expect(res.body.plan.modules[0].tasks[0].id).toBe(`plan_${res.body.id}_1`)
    expect(repo.get(res.body.id)).not.toBeNull()
    const [reqArg, planIdArg] = generate.mock.calls[0]
    expect(reqArg).toMatchObject({ sceneId: 'clothingStore_cashier', topic: 'returns', level: 'A1' })
    expect(planIdArg).toBe(res.body.id)
  })

  it('generate returns 502 with the error when generation fails, and stores nothing', async () => {
    generate.mockRejectedValueOnce(new Error('[ai/lesson/hints] task count mismatch'))
    const res = await request(app).post('/api/lesson-plans/generate').send(validBody)
    expect(res.status).toBe(502)
    expect(res.body.error).toContain('task count mismatch')
    expect(repo.list('t1')).toHaveLength(0)
  })

  it('generate returns 504 on timeout', async () => {
    generate.mockImplementationOnce((_r: unknown, _id: string, opts: { signal: AbortSignal }) =>
      new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(new Error('aborted')))))
    const slow = createApp({ repo, generate: generate as unknown as LessonPlanRouteDeps['generate'], timeoutMs: 20 })
    const res = await request(slow).post('/api/lesson-plans/generate').send(validBody)
    expect(res.status).toBe(504)
  })

  it('list requires teacherUid and returns summaries', async () => {
    expect((await request(app).get('/api/lesson-plans')).status).toBe(400)
    repo.create({ id: 'p1', teacherUid: 't1', plan: fakePlan('p1') })
    const res = await request(app).get('/api/lesson-plans?teacherUid=t1')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0]).not.toHaveProperty('plan')
  })

  it('get returns record or 404', async () => {
    repo.create({ id: 'p1', teacherUid: 't1', plan: fakePlan('p1') })
    expect((await request(app).get('/api/lesson-plans/p1')).body.plan.title).toBe('T')
    expect((await request(app).get('/api/lesson-plans/zzz')).status).toBe(404)
  })

  it('patch validates and updates', async () => {
    repo.create({ id: 'p1', teacherUid: 't1', plan: fakePlan('p1') })
    expect((await request(app).patch('/api/lesson-plans/p1').send({ title: 42 })).status).toBe(400)
    expect((await request(app).patch('/api/lesson-plans/p1').send({ modules: [{ id: 'm', label: 'M' }] })).status).toBe(400)
    const ok = await request(app).patch('/api/lesson-plans/p1').send({ title: 'Renamed', modules: [] })
    expect(ok.status).toBe(200)
    expect(ok.body.plan.title).toBe('Renamed')
    expect(repo.countTasks('p1')).toBe(0)
    expect((await request(app).patch('/api/lesson-plans/zzz').send({ title: 'x' })).status).toBe(404)
  })

  it('delete removes or 404', async () => {
    repo.create({ id: 'p1', teacherUid: 't1', plan: fakePlan('p1') })
    expect((await request(app).post('/api/lesson-plans/p1/delete')).status).toBe(200)
    expect(repo.get('p1')).toBeNull()
    expect((await request(app).post('/api/lesson-plans/p1/delete')).status).toBe(404)
  })
})
