import { Router, type Request, type Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import type { DialogueTaskRepo } from './db/dialogueTaskRepo.js'
import { CEFR_LEVELS, normalizeLevel, type CefrLevel } from './lessonPlanTypes.js'
import { isSceneContext } from './lessonPlanRoutes.js'
import { generateDialogueTask } from './ai/dialogueTask.js'
import type { DialogueLine, DialogueStep, DialogueTask, TemplateSource } from './dialogueTaskTypes.js'

export interface DialogueTaskRouteDeps {
  /** null 表示資料庫開啟失敗，所有端點回 503 */
  repo: DialogueTaskRepo | null
  generate?: typeof generateDialogueTask
  timeoutMs?: number
}

const DEFAULT_GENERATE_TIMEOUT_MS = 60_000
const MAX_TOPIC_LEN = 200
const MAX_TEACHING_GOAL_LEN = 300

const MAX_TITLE_LEN = 100
const MAX_TEXT_LEN = 1000
const MAX_ID_LEN = 64
const MAX_STEPS = 30
const MAX_LINES_PER_STEP = 50
const MAX_LIST_ITEMS = 20

function isText(v: unknown, max = MAX_TEXT_LEN): v is string {
  return typeof v === 'string' && v.length <= max
}

function isId(v: unknown): v is string {
  return isText(v, MAX_ID_LEN) && v.length > 0
}

function isTextList(v: unknown): v is string[] {
  return Array.isArray(v) && v.length <= MAX_LIST_ITEMS && v.every(x => isText(x))
}

function isLine(v: unknown): v is DialogueLine {
  const l = v as Partial<DialogueLine> | null
  return !!l && isId(l.id) && isText(l.speakerSlotId, MAX_ID_LEN) && isText(l.en) && isText(l.zh)
}

function isStep(v: unknown): v is DialogueStep {
  const s = v as Partial<DialogueStep> | null
  return !!s && isId(s.id) && isText(s.title, MAX_TITLE_LEN) && isText(s.purpose, MAX_TITLE_LEN) &&
    Array.isArray(s.lines) && s.lines.length <= MAX_LINES_PER_STEP && s.lines.every(isLine) &&
    isTextList(s.grammarPoints) && isText(s.grammarNote) && isTextList(s.teachingNotes)
}

function isTemplateSource(v: unknown): v is TemplateSource {
  const s = v as Partial<TemplateSource> | null
  return !!s && isId(s.id) && Number.isInteger(s.version) && (s.version as number) >= 1
}

/** 驗證並回傳只含已知欄位的任務；格式不符回 null */
export function parseDialogueTask(v: unknown): DialogueTask | null {
  const t = v as Partial<DialogueTask> | null
  if (!t || typeof t.title !== 'string' || !t.title.trim() || t.title.length > MAX_TITLE_LEN) return null
  if (!isId(t.sceneId)) return null
  // 舊版程度值（A2 / B1）一律轉成新版，舊任務重新儲存時不會被拒
  const level = normalizeLevel(t.level)
  if (!level) return null
  if (!Array.isArray(t.steps) || t.steps.length > MAX_STEPS || !t.steps.every(isStep)) return null
  if (t.sourceTemplate !== undefined && !isTemplateSource(t.sourceTemplate)) return null
  return {
    title: t.title.trim(),
    sceneId: t.sceneId,
    level,
    steps: t.steps.map(s => ({
      id: s.id, title: s.title, purpose: s.purpose,
      lines: s.lines.map(l => ({ id: l.id, speakerSlotId: l.speakerSlotId, en: l.en, zh: l.zh })),
      grammarPoints: s.grammarPoints, grammarNote: s.grammarNote, teachingNotes: s.teachingNotes,
    })),
    ...(t.sourceTemplate ? { sourceTemplate: { id: t.sourceTemplate.id, version: t.sourceTemplate.version } } : {}),
  }
}

export function createDialogueTaskRouter(deps: DialogueTaskRouteDeps): Router {
  const router = Router()
  const generate = deps.generate ?? generateDialogueTask
  const timeoutMs = deps.timeoutMs ?? DEFAULT_GENERATE_TIMEOUT_MS

  // AI 生成對話任務：只回傳草稿不存檔（前端開編輯器讓老師確認後再存），所以不需要資料庫
  router.post('/generate', async (req: Request, res: Response) => {
    const body = req.body as { sceneContext?: unknown; topic?: unknown; level?: unknown; teachingGoal?: unknown }
    if (typeof body.topic !== 'string' || !body.topic.trim() || body.topic.length > MAX_TOPIC_LEN) {
      res.status(400).json({ error: `topic is required (max ${MAX_TOPIC_LEN} chars)` }); return
    }
    if (!CEFR_LEVELS.includes(body.level as CefrLevel)) { res.status(400).json({ error: `level must be one of ${CEFR_LEVELS.join(', ')}` }); return }
    if (body.teachingGoal !== undefined && (typeof body.teachingGoal !== 'string' || body.teachingGoal.length > MAX_TEACHING_GOAL_LEN)) {
      res.status(400).json({ error: `teachingGoal must be a string (max ${MAX_TEACHING_GOAL_LEN} chars)` }); return
    }
    if (!isSceneContext(body.sceneContext) || body.sceneContext.slots.length === 0) {
      res.status(400).json({ error: 'sceneContext is malformed' }); return
    }
    const teachingGoal = typeof body.teachingGoal === 'string' && body.teachingGoal.trim() ? body.teachingGoal.trim() : undefined

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const draft = await generate(
        { topic: body.topic.trim(), level: body.level as CefrLevel, sceneContext: body.sceneContext, teachingGoal },
        { signal: controller.signal },
      )
      // 再用儲存時的驗證跑一次，確保老師按儲存一定存得進去
      const task = parseDialogueTask(draft)
      if (!task) throw new Error('[ai/dialogue-task] generated task failed storage validation')
      res.json({ task })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[dialogue-tasks/generate] error:', msg)
      if (controller.signal.aborted) { res.status(504).json({ error: 'Dialogue task generation timed out' }); return }
      res.status(msg.includes('GEMINI_API_KEY') ? 500 : 502).json({ error: msg })
    } finally {
      clearTimeout(timer)
    }
  })

  // DB 不可用時整組端點降級，其他功能不受影響
  router.use((_req, res, next) => {
    if (!deps.repo) { res.status(503).json({ error: 'Dialogue task storage unavailable' }); return }
    next()
  })
  const repo = () => deps.repo!

  router.post('/', (req: Request, res: Response) => {
    const body = req.body as { teacherUid?: unknown; institutionId?: unknown; task?: unknown }
    if (typeof body.teacherUid !== 'string' || !body.teacherUid.trim()) { res.status(400).json({ error: 'teacherUid is required' }); return }
    const task = parseDialogueTask(body.task)
    if (!task) { res.status(400).json({ error: 'task is malformed' }); return }
    const institutionId = typeof body.institutionId === 'string' && body.institutionId.trim() ? body.institutionId : null
    res.status(201).json(repo().create({ id: uuidv4(), teacherUid: body.teacherUid, institutionId, task }))
  })

  router.get('/', (req: Request, res: Response) => {
    const teacherUid = req.query.teacherUid
    if (typeof teacherUid !== 'string' || !teacherUid.trim()) { res.status(400).json({ error: 'teacherUid is required' }); return }
    res.json(repo().list(teacherUid))
  })

  router.get('/:id', (req: Request, res: Response) => {
    const record = repo().get(req.params.id as string)
    if (!record) { res.status(404).json({ error: 'Dialogue task not found' }); return }
    res.json(record)
  })

  router.patch('/:id', (req: Request, res: Response) => {
    const task = parseDialogueTask((req.body as { task?: unknown }).task)
    if (!task) { res.status(400).json({ error: 'task is malformed' }); return }
    const record = repo().update(req.params.id as string, task)
    if (!record) { res.status(404).json({ error: 'Dialogue task not found' }); return }
    res.json(record)
  })

  // 用 POST 而非 DELETE：CORS 與安全標頭的方法白名單只開 GET / POST / PATCH
  router.post('/:id/delete', (req: Request, res: Response) => {
    if (!repo().remove(req.params.id as string)) { res.status(404).json({ error: 'Dialogue task not found' }); return }
    res.json({ success: true })
  })

  return router
}
