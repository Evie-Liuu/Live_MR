/**
 * 手動建立的任務對話流程（任務編輯器）。與 backend/src/dialogueTaskTypes.ts 形狀一致。
 * 目前獨立存放，尚未接入上課時的任務庫。
 */
import type { CefrLevel } from './lessonPlan.ts'

export interface DialogueLine {
  id: string
  /** 場景角色 slot id，例如 'cashier' / 'customer' */
  speakerSlotId: string
  en: string
  zh: string
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
}

export interface DialogueTask {
  title: string
  sceneId: string
  level: CefrLevel
  steps: DialogueStep[]
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
  createdAt: string
  updatedAt: string
}

export function createId(prefix: string): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
  return `${prefix}_${rand}`
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
