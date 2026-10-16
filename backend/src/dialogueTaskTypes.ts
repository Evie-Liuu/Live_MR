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

/** 由內建模板套用而來時記錄來源 */
export interface TemplateSource {
  id: string
  version: number
}

export interface DialogueTask {
  title: string
  sceneId: string
  level: CefrLevel
  steps: DialogueStep[]
  sourceTemplate?: TemplateSource
  /** 主題標籤（不含 #），例如 購物、詢價、結帳 */
  tags?: string[]
}

export const MAX_TAGS = 8
export const MAX_TAG_LEN = 20

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
