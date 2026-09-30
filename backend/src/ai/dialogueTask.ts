import { callGemini } from './client.js'
import type { GeminiCaller } from './lessonPlan.js'
import {
  LINES_PER_STEP_RANGE, STEP_RANGE, buildDialogueTaskPrompt, buildDialogueTaskSchema,
} from './dialogueTaskPrompts.js'
import type { CefrLevel, SceneContext } from '../lessonPlanTypes.js'
import type { DialogueTask } from '../dialogueTaskTypes.js'

export interface DialogueTaskRequest {
  topic: string
  level: CefrLevel
  sceneContext: SceneContext
  teachingGoal?: string
}

interface RawLine { speaker: string; en: string; zh: string }
interface RawStep {
  title: string
  purpose: string
  lines: RawLine[]
  grammarPoints: string[]
  grammarNote: string
  teachingNotes: string[]
}
interface RawTask { title: string; steps: RawStep[] }

const TAG = '[ai/dialogue-task]'
/** 與 dialogueTaskRoutes 的儲存上限一致，避免生成結果存不進去 */
const MAX_TITLE_LEN = 100
const MAX_TEXT_LEN = 1000

function isText(v: unknown, max = MAX_TEXT_LEN): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max
}

function textList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => isText(x)).map(x => x.trim()).slice(0, 20) : []
}

/** 結構檢查；不合格拋錯，呼叫端決定是否重試 */
export function validateDialogueDraft(raw: unknown, slotIds: string[]): RawTask {
  const t = raw as Partial<RawTask> | null
  if (!t || !isText(t.title, MAX_TITLE_LEN)) throw new Error('dialogue: title missing')
  if (!Array.isArray(t.steps) || t.steps.length < STEP_RANGE.min || t.steps.length > STEP_RANGE.max) {
    throw new Error(`dialogue: need ${STEP_RANGE.min}-${STEP_RANGE.max} steps (got ${Array.isArray(t.steps) ? t.steps.length : 0})`)
  }
  const steps = t.steps.map((s, i) => {
    if (!s || !isText(s.title, MAX_TITLE_LEN)) throw new Error(`dialogue: step ${i + 1} title missing`)
    // 句數上限放寬到 +2：略多仍可用，交給老師刪減；太少才算失敗
    if (!Array.isArray(s.lines) || s.lines.length < LINES_PER_STEP_RANGE.min || s.lines.length > LINES_PER_STEP_RANGE.max + 2) {
      throw new Error(`dialogue: step ${i + 1} needs ${LINES_PER_STEP_RANGE.min}-${LINES_PER_STEP_RANGE.max} lines`)
    }
    const lines = s.lines.map((l, j) => {
      if (!l || !slotIds.includes(l.speaker)) throw new Error(`dialogue: step ${i + 1} line ${j + 1} has unknown speaker ${l?.speaker}`)
      if (!isText(l.en) || !isText(l.zh)) throw new Error(`dialogue: step ${i + 1} line ${j + 1} text missing`)
      return { speaker: l.speaker, en: l.en.trim(), zh: l.zh.trim() }
    })
    return {
      title: s.title.trim(),
      purpose: isText(s.purpose, MAX_TITLE_LEN) ? s.purpose.trim() : '',
      lines,
      grammarPoints: textList(s.grammarPoints),
      grammarNote: isText(s.grammarNote) ? s.grammarNote.trim() : '',
      teachingNotes: textList(s.teachingNotes),
    }
  })
  return { title: t.title.trim(), steps }
}

/** 補上步驟 / 台詞 id，轉成任務編輯器格式 */
export function toDialogueTask(draft: RawTask, req: DialogueTaskRequest): DialogueTask {
  return {
    title: draft.title,
    sceneId: req.sceneContext.sceneId,
    level: req.level,
    steps: draft.steps.map((s, i) => ({
      id: `ai_s${i + 1}`,
      title: s.title,
      purpose: s.purpose,
      lines: s.lines.map((l, j) => ({ id: `ai_s${i + 1}_l${j + 1}`, speakerSlotId: l.speaker, en: l.en, zh: l.zh })),
      grammarPoints: s.grammarPoints,
      grammarNote: s.grammarNote,
      teachingNotes: s.teachingNotes,
    })),
  }
}

/**
 * 單次呼叫產生整份對話任務（格式同 taskTemplates），結構不合格重試一次。
 * 結果不存檔，由前端打開任務編輯器讓老師確認後再儲存。
 */
export async function generateDialogueTask(
  req: DialogueTaskRequest,
  opts: { signal?: AbortSignal; call?: GeminiCaller } = {},
): Promise<DialogueTask> {
  const call: GeminiCaller = opts.call ?? callGemini
  const slotIds = req.sceneContext.slots.map(s => s.id)
  if (slotIds.length === 0) throw new Error(`${TAG} scene has no roles`)
  const { systemInstruction, prompt } = buildDialogueTaskPrompt(req.topic, req.level, req.sceneContext, req.teachingGoal)
  const run = () => call<RawTask>({
    tag: TAG, contents: prompt, systemInstruction,
    temperature: 0.6, maxOutputTokens: 4096, thinkingBudget: 1024,
    responseSchema: buildDialogueTaskSchema(slotIds), signal: opts.signal,
    parse: t => JSON.parse(t) as RawTask,
  })
  let draft: RawTask
  try {
    draft = validateDialogueDraft((await run()).data, slotIds)
  } catch (first) {
    console.warn(`${TAG} invalid, retrying once:`, first instanceof Error ? first.message : String(first))
    draft = validateDialogueDraft((await run()).data, slotIds)
  }
  return toDialogueTask(draft, req)
}
