import { Router, type Request, type Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import type { DialogueTaskRepo } from './db/dialogueTaskRepo.js'
import { CEFR_LEVELS, type CefrLevel } from './lessonPlanTypes.js'
import type { DialogueLine, DialogueStep, DialogueTask } from './dialogueTaskTypes.js'

export interface DialogueTaskRouteDeps {
  /** null 表示資料庫開啟失敗，所有端點回 503 */
  repo: DialogueTaskRepo | null
}

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

/** 驗證並回傳只含已知欄位的任務；格式不符回 null */
export function parseDialogueTask(v: unknown): DialogueTask | null {
  const t = v as Partial<DialogueTask> | null
  if (!t || typeof t.title !== 'string' || !t.title.trim() || t.title.length > MAX_TITLE_LEN) return null
  if (!isId(t.sceneId)) return null
  if (!CEFR_LEVELS.includes(t.level as CefrLevel)) return null
  if (!Array.isArray(t.steps) || t.steps.length > MAX_STEPS || !t.steps.every(isStep)) return null
  return {
    title: t.title.trim(),
    sceneId: t.sceneId,
    level: t.level as CefrLevel,
    steps: t.steps.map(s => ({
      id: s.id, title: s.title, purpose: s.purpose,
      lines: s.lines.map(l => ({ id: l.id, speakerSlotId: l.speakerSlotId, en: l.en, zh: l.zh })),
      grammarPoints: s.grammarPoints, grammarNote: s.grammarNote, teachingNotes: s.teachingNotes,
    })),
  }
}

export function createDialogueTaskRouter(deps: DialogueTaskRouteDeps): Router {
  const router = Router()

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
