import { callGemini } from './client.js'
import type { GeminiCaller } from './lessonPlan.js'
import {
  CHECKPOINTS_PER_STEP_RANGE, STEP_RANGE, TAG_RANGE, buildDialogueTaskPrompt, buildDialogueTaskSchema, linesPerStepRange,
} from './dialogueTaskPrompts.js'
import type { CefrLevel, SceneContext } from '../lessonPlanTypes.js'
import {
  MAX_CAST_OPTIONS, MAX_CHECKPOINTS_PER_STEP, MAX_TAG_LEN, cleanTag, isGestureId,
  type AudienceCheckpoint, type CastOption, type DialogueTask, type GestureId,
} from '../dialogueTaskTypes.js'

export interface DialogueTaskRequest {
  topic: string
  level: CefrLevel
  sceneContext: SceneContext
  teachingGoal?: string
  /** 角色扮演人數；未指定時由 AI 依主題決定 */
  castSize?: number
}

type RawCheckpoint = Omit<AudienceCheckpoint, 'id'>
interface RawLine { speaker: string; en: string; zh: string; gesture?: GestureId }
interface RawStep {
  title: string
  purpose: string
  lines: RawLine[]
  grammarPoints: string[]
  grammarNote: string
  teachingNotes: string[]
  checkpoints: RawCheckpoint[]
}
interface RawTask { title: string; tags: string[]; steps: RawStep[]; castOptions: CastOption[] }

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

/** 標籤是加分項：去掉 #、過長與重複的，最多保留 TAG_RANGE.max 個；沒有也不重試 */
function cleanTags(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const tags: string[] = []
  for (const x of v) {
    if (typeof x !== 'string') continue
    const tag = cleanTag(x)
    if (tag && tag.length <= MAX_TAG_LEN && !tags.includes(tag)) tags.push(tag)
  }
  return tags.slice(0, TAG_RANGE.max)
}

const TRUE_FALSE = ['True', 'False']
const SLOT_TOKEN = /\{([A-Za-z0-9_-]+)\}/g

/**
 * 台下互動題是加分項：不合格的題目直接略過，不讓整份重試。
 * 是非題選項固定 True / False；題目裡的角色代號必須是有台詞的角色。
 */
function cleanCheckpoints(v: unknown, speakers: string[]): RawCheckpoint[] {
  if (!Array.isArray(v)) return []
  const out: RawCheckpoint[] = []
  for (const c of v as Partial<RawCheckpoint & { followUp: unknown }>[]) {
    if (!c || !isText(c.title, MAX_TITLE_LEN) || !isText(c.question)) continue
    const truefalse = c.kind === 'truefalse'
    const options = truefalse
      ? TRUE_FALSE
      : Array.isArray(c.options) ? c.options.filter((o): o is string => isText(o, MAX_TITLE_LEN)).map(o => o.trim()) : []
    if (options.length < 2 || options.length > 6) continue
    if (new Set(options.map(o => o.toLowerCase())).size !== options.length) continue
    const answerIndex = c.answerIndex
    if (typeof answerIndex !== 'number' || !Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= options.length) continue
    const texts = [c.question, ...options, typeof c.followUp === 'string' ? c.followUp : '']
    if (texts.some(t => [...t.matchAll(SLOT_TOKEN)].some(m => !speakers.includes(m[1])))) continue
    out.push({
      ...(truefalse ? { kind: 'truefalse' as const } : {}),
      title: c.title.trim(), question: c.question.trim(), options: [...options], answerIndex,
      ...(isText(c.followUp) ? { followUp: c.followUp.trim() } : {}),
    })
  }
  return out.slice(0, Math.min(CHECKPOINTS_PER_STEP_RANGE.max, MAX_CHECKPOINTS_PER_STEP))
}

/**
 * 併角順序 → 演出人數版本（逐步累加，例如 4 人 → 3 人 → 2 人）。
 * 規則與前端 castSize 相同：只併有台詞的角色、不併給自己、不併給已被併掉的角色、不連鎖。
 * 遇到不合規則的那一步就停（前面已成立的版本保留）。
 */
export function castOptionsFromMerges(v: unknown, speakers: string[]): CastOption[] {
  if (!Array.isArray(v)) return []
  const options: CastOption[] = []
  const merge: Record<string, string> = {}
  for (const m of v as { from?: unknown; to?: unknown }[]) {
    if (speakers.length - Object.keys(merge).length <= 2 || options.length >= MAX_CAST_OPTIONS) break
    const from = m?.from, to = m?.to
    if (typeof from !== 'string' || typeof to !== 'string') break
    if (from === to || !speakers.includes(from) || !speakers.includes(to)) break
    if (from in merge || to in merge || Object.values(merge).includes(from)) break
    merge[from] = to
    options.push({ merge: { ...merge } })
  }
  return options
}

/** 結構檢查；不合格拋錯，呼叫端決定是否重試 */
export function validateDialogueDraft(raw: unknown, slotIds: string[], castSize?: number): RawTask {
  const t = raw as (Partial<Omit<RawTask, 'castOptions'>> & { castMerges?: unknown }) | null
  if (!t || !isText(t.title, MAX_TITLE_LEN)) throw new Error('dialogue: title missing')
  if (!Array.isArray(t.steps) || t.steps.length < STEP_RANGE.min || t.steps.length > STEP_RANGE.max) {
    throw new Error(`dialogue: need ${STEP_RANGE.min}-${STEP_RANGE.max} steps (got ${Array.isArray(t.steps) ? t.steps.length : 0})`)
  }
  const range = linesPerStepRange(castSize ?? slotIds.length)
  const parsed = t.steps.map((s, i) => {
    if (!s || !isText(s.title, MAX_TITLE_LEN)) throw new Error(`dialogue: step ${i + 1} title missing`)
    // 句數上限放寬到 +2：略多仍可用，交給老師刪減；太少才算失敗
    if (!Array.isArray(s.lines) || s.lines.length < range.min || s.lines.length > range.max + 2) {
      throw new Error(`dialogue: step ${i + 1} needs ${range.min}-${range.max} lines`)
    }
    const lines = s.lines.map((l, j) => {
      if (!l || !slotIds.includes(l.speaker)) throw new Error(`dialogue: step ${i + 1} line ${j + 1} has unknown speaker ${l?.speaker}`)
      if (!isText(l.en) || !isText(l.zh)) throw new Error(`dialogue: step ${i + 1} line ${j + 1} text missing`)
      // gesture 是加分項：不認得或 'none' 就當作沒有動作，不讓整份重試
      return { speaker: l.speaker, en: l.en.trim(), zh: l.zh.trim(), ...(isGestureId(l.gesture) ? { gesture: l.gesture } : {}) }
    })
    return {
      title: s.title.trim(),
      purpose: isText(s.purpose, MAX_TITLE_LEN) ? s.purpose.trim() : '',
      lines,
      grammarPoints: textList(s.grammarPoints),
      grammarNote: isText(s.grammarNote) ? s.grammarNote.trim() : '',
      teachingNotes: textList(s.teachingNotes),
      rawCheckpoints: s.checkpoints as unknown,
    }
  })
  const speakers: string[] = []
  for (const l of parsed.flatMap(s => s.lines)) if (!speakers.includes(l.speaker)) speakers.push(l.speaker)
  // 老師指定人數時必須剛好用到這麼多個角色，否則重試
  if (castSize !== undefined && speakers.length !== castSize) {
    throw new Error(`dialogue: need exactly ${castSize} speaking roles (got ${speakers.length})`)
  }
  const steps = parsed.map(({ rawCheckpoints, ...s }) => ({ ...s, checkpoints: cleanCheckpoints(rawCheckpoints, speakers) }))
  return { title: t.title.trim(), tags: cleanTags(t.tags), steps, castOptions: castOptionsFromMerges(t.castMerges, speakers) }
}

/** 第一步的教學注意點補上可演出的人數與併角方式（與模板寫法相同） */
function castNote(draft: RawTask, slotLabel: (id: string) => string): string | null {
  if (draft.castOptions.length === 0) return null
  const full = new Set(draft.steps.flatMap(s => s.lines.map(l => l.speaker))).size
  const min = full - Object.keys(draft.castOptions[draft.castOptions.length - 1].merge).length
  let prev: Record<string, string> = {}
  const parts = draft.castOptions.map(o => {
    const added = Object.entries(o.merge).filter(([from]) => !(from in prev))
    prev = o.merge
    const size = full - Object.keys(o.merge).length
    return `${size} 人時${added.map(([from, to]) => `${slotLabel(from)}的台詞由${slotLabel(to)}說`).join('、')}`
  })
  return `可 ${min}–${full} 人演出（角色配置切換演出人數）：${parts.join('；')}。`
}

/** 補上步驟 / 台詞 id，轉成任務編輯器格式 */
export function toDialogueTask(draft: RawTask, req: DialogueTaskRequest): DialogueTask {
  const slotLabel = (id: string) => req.sceneContext.slots.find(s => s.id === id)?.label ?? id
  const note = castNote(draft, slotLabel)
  return {
    title: draft.title,
    sceneId: req.sceneContext.sceneId,
    level: req.level,
    steps: draft.steps.map((s, i) => ({
      id: `ai_s${i + 1}`,
      title: s.title,
      purpose: s.purpose,
      lines: s.lines.map((l, j) => ({
        id: `ai_s${i + 1}_l${j + 1}`, speakerSlotId: l.speaker, en: l.en, zh: l.zh,
        ...(l.gesture ? { gesture: l.gesture } : {}),
      })),
      grammarPoints: s.grammarPoints,
      grammarNote: s.grammarNote,
      teachingNotes: i === 0 && note ? [...s.teachingNotes, note] : s.teachingNotes,
      ...(s.checkpoints.length > 0 ? {
        checkpoints: s.checkpoints.map((c, k) => ({ id: `ai_s${i + 1}_cp${k + 1}`, ...c })),
      } : {}),
    })),
    ...(draft.tags.length > 0 ? { tags: draft.tags } : {}),
    ...(draft.castOptions.length > 0 ? { castOptions: draft.castOptions } : {}),
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
  const { systemInstruction, prompt } = buildDialogueTaskPrompt(req.topic, req.level, req.sceneContext, req.teachingGoal, req.castSize)
  // 加上台下互動題與較多角色時輸出較長
  const run = () => call<RawTask>({
    tag: TAG, contents: prompt, systemInstruction,
    temperature: 0.6, maxOutputTokens: 8192, thinkingBudget: 1024,
    responseSchema: buildDialogueTaskSchema(slotIds), signal: opts.signal,
    parse: t => JSON.parse(t) as RawTask,
  })
  let draft: RawTask
  try {
    draft = validateDialogueDraft((await run()).data, slotIds, req.castSize)
  } catch (first) {
    console.warn(`${TAG} invalid, retrying once:`, first instanceof Error ? first.message : String(first))
    draft = validateDialogueDraft((await run()).data, slotIds, req.castSize)
  }
  return toDialogueTask(draft, req)
}
