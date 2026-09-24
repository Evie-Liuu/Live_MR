import type { TaskHint } from '../config/taskHints.ts'

/** 學生程度：依台灣學制分段，值為對應的 CEFR 區間（與 backend/src/lessonPlanTypes.ts 一致） */
export type CefrLevel = 'preA1-A1' | 'A1' | 'A1-A2' | 'A2-B1'

interface LevelOption {
  value: CefrLevel
  /** 學制，例如「國小中低年級」 */
  grade: string
  /** CEFR 顯示文字 */
  cefr: string
  /** 完整顯示：學制（CEFR） */
  label: string
  /** 窄空間用的簡稱 */
  short: string
}

function levelOption(value: CefrLevel, grade: string, cefr: string, short: string): LevelOption {
  return { value, grade, cefr, label: `${grade}（${cefr}）`, short }
}

export const CEFR_LEVELS: readonly LevelOption[] = [
  levelOption('preA1-A1', '國小中低年級', 'preA–A1', '國小中低'),
  levelOption('A1', '國小高年級', 'A1', '國小高'),
  levelOption('A1-A2', '國中', 'A1–A2', '國中'),
  levelOption('A2-B1', '高中', 'A2–B1', '高中'),
]

/** 舊版程度值 → 新版（舊版 A2 = 國小高年級、B1 = 國中，依學制對應到新區間） */
const LEGACY_LEVELS: Readonly<Record<string, CefrLevel>> = { A2: 'A1-A2', B1: 'A2-B1' }

/** 接受新版或舊版程度值（資料庫裡可能還有舊資料），回傳新版；不認得的退回 A1 */
export function normalizeLevel(level: string): CefrLevel {
  if (CEFR_LEVELS.some(l => l.value === level)) return level as CefrLevel
  return LEGACY_LEVELS[level] ?? 'A1'
}

/** 程度的顯示文字；short 用在清單、標籤等窄空間 */
export function levelLabel(level: string, short = false): string {
  const found = CEFR_LEVELS.find(l => l.value === normalizeLevel(level))!
  return short ? found.short : found.label
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
  /** 選填的教學目標 */
  teachingGoal?: string
}
