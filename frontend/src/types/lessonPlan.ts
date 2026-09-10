import type { TaskHint } from '../config/taskHints.ts'

export type CefrLevel = 'A1' | 'A2' | 'B1'

export const CEFR_LEVELS: readonly { value: CefrLevel; label: string }[] = [
  { value: 'A1', label: 'A1：國小中低年級（入門）' },
  { value: 'A2', label: 'A2：國小高年級（初級）' },
  { value: 'B1', label: 'B1：國中（中級）' },
]

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

export interface GenerateLessonPlanRequest {
  teacherUid: string
  institutionId?: string
  sceneId: string
  sceneContext: SceneContext
  topic: string
  level: CefrLevel
}
