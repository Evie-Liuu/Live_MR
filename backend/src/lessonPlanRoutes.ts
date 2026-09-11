import { Router, type Request, type Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import type { LessonPlanRepo } from './db/lessonPlanRepo.js'
import { generateLessonPlan } from './ai/lessonPlan.js'
import { CEFR_LEVELS, type CefrLevel, type LessonPlanModule, type SceneContext, type TaskHint } from './lessonPlanTypes.js'

export interface LessonPlanRouteDeps {
  /** null 表示資料庫開啟失敗，所有端點回 503 */
  repo: LessonPlanRepo | null
  generate?: typeof generateLessonPlan
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 90_000
const MAX_TOPIC_LEN = 200

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(x => typeof x === 'string')
}

function isTaskHint(v: unknown): v is TaskHint {
  const h = v as Partial<TaskHint> | null
  return !!h && typeof h.keyStructure === 'string' && typeof h.partialSentence === 'string' &&
    isStringArray(h.unscramble) && typeof h.completeSentence === 'string' && isStringArray(h.extraPhrases)
}

function isModules(v: unknown): v is LessonPlanModule[] {
  if (!Array.isArray(v)) return false
  return v.every(m => m && typeof m.id === 'string' && typeof m.label === 'string' && typeof m.icon === 'string' &&
    Array.isArray(m.tasks) && m.tasks.every((t: Partial<LessonPlanModule['tasks'][number]>) =>
      t && typeof t.id === 'string' && typeof t.label === 'string' && isTaskHint(t.hint)))
}

function isSceneContext(v: unknown): v is SceneContext {
  const c = v as Partial<SceneContext> | null
  return !!c && typeof c.sceneId === 'string' && typeof c.themeLabel === 'string' && typeof c.sceneLabel === 'string' &&
    typeof c.sceneLabelEn === 'string' && Array.isArray(c.slots) && isStringArray(c.existingModuleLabels) &&
    Array.isArray(c.exampleTasks) && c.exampleTasks.every(e => e && typeof e.label === 'string' && isTaskHint(e.hint))
}

export function createLessonPlanRouter(deps: LessonPlanRouteDeps): Router {
  const router = Router()
  const generate = deps.generate ?? generateLessonPlan
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS

  // DB 不可用時整組端點降級，其他功能不受影響
  router.use((_req, res, next) => {
    if (!deps.repo) { res.status(503).json({ error: 'Lesson plan storage unavailable' }); return }
    next()
  })
  const repo = () => deps.repo!

  router.post('/generate', async (req: Request, res: Response) => {
    const body = req.body as {
      teacherUid?: unknown; institutionId?: unknown; sceneId?: unknown; sceneContext?: unknown; topic?: unknown; level?: unknown
    }
    if (typeof body.teacherUid !== 'string' || !body.teacherUid.trim()) { res.status(400).json({ error: 'teacherUid is required' }); return }
    if (typeof body.sceneId !== 'string' || !body.sceneId.trim()) { res.status(400).json({ error: 'sceneId is required' }); return }
    if (typeof body.topic !== 'string' || !body.topic.trim() || body.topic.length > MAX_TOPIC_LEN) {
      res.status(400).json({ error: `topic is required (max ${MAX_TOPIC_LEN} chars)` }); return
    }
    if (!CEFR_LEVELS.includes(body.level as CefrLevel)) { res.status(400).json({ error: 'level must be A1, A2 or B1' }); return }
    if (!isSceneContext(body.sceneContext)) { res.status(400).json({ error: 'sceneContext is malformed' }); return }
    const institutionId = typeof body.institutionId === 'string' && body.institutionId.trim() ? body.institutionId : null

    const planId = uuidv4()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const plan = await generate(
        { sceneId: body.sceneId, topic: body.topic.trim(), level: body.level as CefrLevel, sceneContext: body.sceneContext },
        planId,
        { signal: controller.signal },
      )
      const record = repo().create({ id: planId, teacherUid: body.teacherUid, institutionId, plan })
      res.status(201).json(record)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[lesson-plans/generate] error:', msg)
      if (controller.signal.aborted) { res.status(504).json({ error: 'Lesson plan generation timed out' }); return }
      const status = msg.includes('GEMINI_API_KEY') ? 500 : 502
      const step = msg.match(/\[ai\/lesson\/(\w+)\]/)?.[1]
      res.status(status).json({ error: msg, step })
    } finally {
      clearTimeout(timer)
    }
  })

  router.get('/', (req: Request, res: Response) => {
    const teacherUid = req.query.teacherUid
    if (typeof teacherUid !== 'string' || !teacherUid.trim()) { res.status(400).json({ error: 'teacherUid is required' }); return }
    res.json(repo().list(teacherUid))
  })

  router.get('/:id', (req: Request, res: Response) => {
    const record = repo().get(req.params.id as string)
    if (!record) { res.status(404).json({ error: 'Lesson plan not found' }); return }
    res.json(record)
  })

  router.patch('/:id', (req: Request, res: Response) => {
    const body = req.body as { title?: unknown; modules?: unknown }
    const patch: { title?: string; modules?: LessonPlanModule[] } = {}
    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || !body.title.trim()) { res.status(400).json({ error: 'title must be a non-empty string' }); return }
      patch.title = body.title.trim()
    }
    if (body.modules !== undefined) {
      if (!isModules(body.modules)) { res.status(400).json({ error: 'modules is malformed' }); return }
      patch.modules = body.modules
    }
    const record = repo().update(req.params.id as string, patch)
    if (!record) { res.status(404).json({ error: 'Lesson plan not found' }); return }
    res.json(record)
  })

  // 用 POST 而非 DELETE：CORS 與安全標頭的方法白名單只開 GET / POST / PATCH
  router.post('/:id/delete', (req: Request, res: Response) => {
    if (!repo().remove(req.params.id as string)) { res.status(404).json({ error: 'Lesson plan not found' }); return }
    res.json({ success: true })
  })

  return router
}
