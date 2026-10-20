/**
 * 手動建立的任務對話流程（任務編輯器）。與 frontend/src/types/dialogueTask.ts 形狀一致。
 * 目前獨立存放，尚未接入上課時的任務庫（lesson_plans / lesson_tasks）。
 */
import type { CefrLevel } from './lessonPlanTypes.js'

export interface DialogueLine {
  id: string
  /** 場景角色 slot id，例如 'cashier' / 'customer' */
  speakerSlotId: string
  en: string
  zh: string
  /** 說這句時角色做的動作（選填） */
  gesture?: GestureId
}

/** 動作庫 id，與前端 frontend/src/config/gestures.ts 一致 */
export const GESTURE_IDS = ['wave', 'nod', 'bow', 'point', 'handOver', 'thumbsUp', 'happy'] as const
export type GestureId = typeof GESTURE_IDS[number]

export function isGestureId(v: unknown): v is GestureId {
  return typeof v === 'string' && (GESTURE_IDS as readonly string[]).includes(v)
}

/**
 * 台下互動點：老師在這個步驟演完後暫停，讓台下全班在自己的裝置上作答的選擇題
 * （題目直接取自剛才的對話）。目前只存在任務資料裡，之後會發佈到台下學生的裝置。
 */
export interface AudienceCheckpoint {
  id: string
  /** 互動類型，例如「聽力理解」「價格理解」 */
  title: string
  /** 英文題目 */
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
  /** 主題標籤（不含 #），例如 購物、詢價、結帳 */
  tags?: string[]
}

export const MAX_TAGS = 8
export const MAX_TAG_LEN = 20
export const MAX_CHECKPOINTS_PER_STEP = 5
export const MIN_CHECKPOINT_OPTIONS = 2
export const MAX_CHECKPOINT_OPTIONS = 6
export const MAX_CAST_OPTIONS = 4
export const MAX_CAST_MERGES = 8

/** 標籤正規化：去掉前置 #、多餘空白，去重；空字串略過 */
export function cleanTag(v: string): string {
  return v.trim().replace(/^[#＃]+/, '').replace(/\s+/g, ' ').trim()
}

/**
 * 驗證並正規化儲存用的標籤：undefined 視為沒有標籤；
 * 型別不對、單一標籤過長或數量超過上限時回 null（整份任務拒收）。
 */
export function normalizeTags(v: unknown): string[] | null {
  if (v === undefined) return []
  if (!Array.isArray(v) || !v.every(x => typeof x === 'string')) return null
  const tags: string[] = []
  for (const raw of v as string[]) {
    const tag = cleanTag(raw)
    if (!tag) continue
    if (tag.length > MAX_TAG_LEN) return null
    if (!tags.includes(tag)) tags.push(tag)
  }
  return tags.length > MAX_TAGS ? null : tags
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
  tags: string[]
  createdAt: string
  updatedAt: string
}
