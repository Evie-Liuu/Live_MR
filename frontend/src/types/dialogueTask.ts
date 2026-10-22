/**
 * 手動建立的任務對話流程（任務編輯器）。與 backend/src/dialogueTaskTypes.ts 形狀一致。
 * 目前獨立存放，尚未接入上課時的任務庫。
 */
import type { CefrLevel } from './lessonPlan.ts'
import type { GestureId } from '../config/gestures.ts'

export interface DialogueLine {
  id: string
  /** 場景角色 slot id，例如 'cashier' / 'customer' */
  speakerSlotId: string
  en: string
  zh: string
  /** 說這句時角色做的動作（選填，見 config/gestures.ts） */
  gesture?: GestureId
}

/**
 * 台下互動點：老師在這個步驟演完後暫停，讓台下全班在自己的裝置上作答的選擇題
 * （題目直接取自剛才的對話）。目前只存在任務資料裡，之後會發佈到台下學生的裝置。
 */
export interface AudienceCheckpoint {
  id: string
  /** 題型：choice 選擇題（預設）、truefalse 是非題（作答時固定顯示 True / False） */
  kind?: 'choice' | 'truefalse'
  /** 互動類型，例如「聽力理解」「價格理解」 */
  title: string
  /**
   * 英文題目。提到角色時寫成角色代號（例如 `{customer2}`），發布時換成演出者名字，
   * 少人數演出併角時自動換成接手的人；選項與延伸追問也可以用。
   */
  question: string
  /** 選項（2–6 個，不含 A. B. 前綴） */
  options: string[]
  /** 正確答案在 options 的位置（從 0 開始） */
  answerIndex: number
  /** 給老師的延伸追問（選填），例如讓程度較好的學生延伸回答 */
  followUp?: string
}

export interface DialogueStep {
  id: string
  title: string
  /** 目的標籤，例如「問候引導」 */
  purpose: string
  lines: DialogueLine[]
  /** 本段重點語法（句型） */
  grammarPoints: string[]
  /** 語法說明 */
  grammarNote: string
  teachingNotes: string[]
  /** 步驟結束時的台下互動點（選填） */
  checkpoints?: AudienceCheckpoint[]
}

/** 由內建模板套用而來時記錄來源 */
export interface TemplateSource {
  id: string
  version: number
}

/**
 * 併角方案：用比原本少的人數演出時，把某些角色的台詞併給另一個角色說。
 * merge 是「被併掉的角色 → 改由哪個角色說」，例如 { staff: 'cashier' }＝店員B 的台詞由店員A 說。
 * 演出人數不另外存，由併角後實際有台詞的角色數算出（任務改過台詞也不會對不上）。
 */
export interface CastOption {
  merge: Record<string, string>
}

export interface DialogueTask {
  title: string
  sceneId: string
  level: CefrLevel
  steps: DialogueStep[]
  sourceTemplate?: TemplateSource
  /** 少於完整人數演出時的併角方案（選填；完整人數不需要列） */
  castOptions?: CastOption[]
  /** 主題標籤（不含 #），例如 購物、詢價、結帳；用於搜尋與篩選 */
  tags?: string[]
}

/** 與後端 dialogueTaskTypes 的上限一致 */
export const MAX_CHECKPOINTS_PER_STEP = 5
export const MIN_CHECKPOINT_OPTIONS = 2
export const MAX_CHECKPOINT_OPTIONS = 6

/** 深拷貝台下互動點並換掉 id（套用模板、複製步驟用）；沒有互動點時不產生欄位 */
export function cloneCheckpoints(step: DialogueStep): Pick<DialogueStep, 'checkpoints'> {
  return step.checkpoints?.length
    ? { checkpoints: step.checkpoints.map(c => ({ ...c, id: createId('cp'), options: [...c.options] })) }
    : {}
}

export const MAX_TAGS = 8
export const MAX_TAG_LEN = 20
export const MAX_CAST_OPTIONS = 4

/** 任務中有台詞的角色（依第一次出場順序） */
export function speakingSlots(task: DialogueTask): string[] {
  const ids: string[] = []
  for (const line of task.steps.flatMap(s => s.lines)) if (!ids.includes(line.speakerSlotId)) ids.push(line.speakerSlotId)
  return ids
}

/**
 * 併角後實際演出的人數；規則不成立時回 null：
 * 併給自己、併給沒有台詞的角色、或併給同樣被併掉的角色（不允許連鎖）。
 * 被併掉但任務裡已經沒有台詞的角色直接略過。
 */
export function castSize(task: DialogueTask, merge: Record<string, string>): number | null {
  const speakers = speakingSlots(task)
  for (const [from, to] of Object.entries(merge)) {
    if (!speakers.includes(from)) continue
    if (from === to || !speakers.includes(to) || merge[to] !== undefined) return null
  }
  return speakers.filter(id => !(id in merge)).length
}

/** 可選的演出人數（由少到多，最後一個是完整人數）；無效或與其他方案同人數的併角方案略過 */
export function castChoices(task: DialogueTask): { size: number; merge: Record<string, string> }[] {
  const full = speakingSlots(task).length
  const choices: { size: number; merge: Record<string, string> }[] = []
  for (const opt of task.castOptions ?? []) {
    const size = castSize(task, opt.merge)
    if (size !== null && size >= 1 && size < full && !choices.some(c => c.size === size)) choices.push({ size, merge: opt.merge })
  }
  choices.sort((a, b) => a.size - b.size)
  return [...choices, { size: full, merge: {} }]
}

/** 依併角規則把被併掉角色的台詞改由對應角色說（回傳新任務，不改原任務） */
export function applyCastMerge(task: DialogueTask, merge: Record<string, string>): DialogueTask {
  if (Object.keys(merge).length === 0) return task
  return {
    ...task,
    steps: task.steps.map(s => ({
      ...s,
      lines: s.lines.map(l => (merge[l.speakerSlotId] ? { ...l, speakerSlotId: merge[l.speakerSlotId] } : l)),
    })),
  }
}

/** 標籤正規化：去掉前置 #、多餘空白 */
export function cleanTag(v: string): string {
  return v.trim().replace(/^[#＃]+/, '').replace(/\s+/g, ' ').trim()
}

/** 把輸入或貼上的文字拆成多個標籤（以 #、逗號、頓號、換行分隔） */
export function splitTags(text: string): string[] {
  return text.split(/[#＃,，、;；\n]+/).map(cleanTag).filter(Boolean)
}

export interface DialogueTaskRecord {
  id: string
  teacherUid: string
  institutionId: string | null
  createdAt: string
  updatedAt: string
  task: DialogueTask
}

export interface DialogueTaskSummary {
  id: string
  title: string
  sceneId: string
  level: CefrLevel
  stepCount: number
  /** 舊版後端沒有此欄位 */
  tags?: string[]
  createdAt: string
  updatedAt: string
}

export function createId(prefix: string): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
  return `${prefix}_${rand}`
}

export function newCheckpoint(kind: 'choice' | 'truefalse'): AudienceCheckpoint {
  return kind === 'truefalse'
    ? { id: createId('cp'), kind, title: '是非判斷', question: '', options: ['True', 'False'], answerIndex: 0 }
    : { id: createId('cp'), title: '聽力理解', question: '', options: ['', '', ''], answerIndex: 0 }
}

/** 儲存時略過題目空白的互動點；步驟沒有互動點時不產生欄位 */
export function cleanCheckpoints(task: DialogueTask): DialogueTask {
  return {
    ...task,
    steps: task.steps.map(s => {
      const { checkpoints, ...rest } = s
      const kept = (checkpoints ?? []).filter(c => c.question.trim())
      return kept.length ? { ...rest, checkpoints: kept } : rest
    }),
  }
}

export function newLine(speakerSlotId: string): DialogueLine {
  return { id: createId('line'), speakerSlotId, en: '', zh: '' }
}

export function newStep(title = '', speakerSlotIds: string[] = []): DialogueStep {
  return {
    id: createId('step'),
    title,
    purpose: '',
    lines: speakerSlotIds.length ? [newLine(speakerSlotIds[0])] : [],
    grammarPoints: [],
    grammarNote: '',
    teachingNotes: [],
  }
}

/** 深拷貝步驟並換掉所有 id（複製步驟用） */
export function cloneStep(step: DialogueStep): DialogueStep {
  return {
    ...step,
    id: createId('step'),
    title: step.title ? `${step.title}（副本）` : '',
    lines: step.lines.map(l => ({ ...l, id: createId('line') })),
    grammarPoints: [...step.grammarPoints],
    teachingNotes: [...step.teachingNotes],
    ...cloneCheckpoints(step),
  }
}

export function blankTask(sceneId: string, speakerSlotIds: string[]): DialogueTask {
  return { title: '', sceneId, level: 'A1', steps: [newStep('', speakerSlotIds)] }
}

/** 句與句之間預留的換人說話時間（秒） */
const LINE_GAP_SEC = 1
/** 初學者語速約每秒 3 個英文字 */
const WORDS_PER_SEC = 3

/** 依英文字數估算一句台詞的秒數，最少 2 秒 */
export function estimateLineSeconds(en: string): number {
  const words = en.trim().split(/\s+/).filter(Boolean).length
  return Math.max(2, Math.ceil(words / WORDS_PER_SEC))
}

/** 每句台詞的起訖秒數，以及整個步驟的預計時長 */
export function stepTimings(lines: DialogueLine[]): { ranges: { start: number; end: number }[]; total: number } {
  let cursor = 0
  const ranges = lines.map((l, i) => {
    const start = i === 0 ? 0 : cursor + LINE_GAP_SEC
    const end = start + estimateLineSeconds(l.en)
    cursor = end
    return { start, end }
  })
  return { ranges, total: cursor }
}

/** 秒數轉 mm:ss */
export function formatClock(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
