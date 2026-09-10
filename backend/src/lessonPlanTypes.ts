export type CefrLevel = 'A1' | 'A2' | 'B1'
export const CEFR_LEVELS: readonly CefrLevel[] = ['A1', 'A2', 'B1']

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
