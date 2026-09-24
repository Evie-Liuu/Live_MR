/** 學生程度：依台灣學制分段，值為對應的 CEFR 區間（與前端 types/lessonPlan.ts 一致） */
export type CefrLevel = 'preA1-A1' | 'A1' | 'A1-A2' | 'A2-B1'
export const CEFR_LEVELS: readonly CefrLevel[] = ['preA1-A1', 'A1', 'A1-A2', 'A2-B1']

/** 舊版程度值 → 新版（舊版 A2 = 國小高年級、B1 = 國中，依學制對應到新區間） */
const LEGACY_LEVELS: Readonly<Record<string, CefrLevel>> = { A2: 'A1-A2', B1: 'A2-B1' }

/** 接受新版或舊版程度值，回傳新版；不認得回 null */
export function normalizeLevel(v: unknown): CefrLevel | null {
  if (typeof v !== 'string') return null
  if ((CEFR_LEVELS as readonly string[]).includes(v)) return v as CefrLevel
  return LEGACY_LEVELS[v] ?? null
}

/** 與前端 frontend/src/config/taskHints.ts 的 TaskHint 形狀一致 */
export interface TaskHint {
  keyStructure: string
  partialSentence: string
  unscramble: string[]
  completeSentence: string
  extraPhrases: string[]
}

export interface LessonPlanTask {
  id: string
  label: string
  hint: TaskHint
}

export interface LessonPlanModule {
  id: string
  label: string
  icon: string
  tasks: LessonPlanTask[]
}

export interface TimelinePhase {
  phase: string
  minutes: number
  activity: string
  teacherScript: string
}

export interface GrammarNote {
  point: string
  explanation: string
  examples: string[]
}

export interface LessonPlan {
  title: string
  sceneId: string
  topic: string
  level: CefrLevel
  durationMin: 15
  objectives: string[]
  timeline: TimelinePhase[]
  grammarNotes: GrammarNote[]
  teachingNotes: string[]
  sceneConstraint: string
  modules: LessonPlanModule[]
}

/** 前端從 THEMES / TASK_HINTS 整理出、隨生成請求送上來的場景脈絡 */
export interface SceneContext {
  sceneId: string
  themeLabel: string
  sceneLabel: string
  sceneLabelEn: string
  slots: { id: string; label: string }[]
  existingModuleLabels: string[]
  exampleTasks: { label: string; hint: TaskHint }[]
}

export interface LessonPlanRecord {
  id: string
  teacherUid: string
  institutionId: string | null
  createdAt: string
  updatedAt: string
  plan: LessonPlan
}

export interface LessonPlanSummary {
  id: string
  title: string
  sceneId: string
  topic: string
  level: CefrLevel
  createdAt: string
  updatedAt: string
}
