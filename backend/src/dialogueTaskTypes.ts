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
