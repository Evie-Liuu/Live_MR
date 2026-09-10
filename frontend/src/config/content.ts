import { TASK_HINTS } from './taskHints.ts'
import type { TaskHint } from './taskHints.ts'
import { SCENE_CONSTRAINTS } from './aiAssistant.ts'
import type { SceneModule } from '../types/vrm.ts'
import type { LessonPlan } from '../types/lessonPlan.ts'

export const PLAN_MODULE_PREFIX = '我的教案'

/**
 * 任務庫：所選場景與教案相符時，教案模組插在靜態模組之前並冠上「我的教案」；
 * 否則原樣回傳靜態模組（回傳同一個陣列參考，方便 memo）。
 */
export function resolveModules(
  staticModules: SceneModule[],
  plan: LessonPlan | null | undefined,
  sceneId: string,
): SceneModule[] {
  if (!plan || plan.sceneId !== sceneId) return staticModules
  const planModules: SceneModule[] = plan.modules.map(m => ({
    id: m.id,
    label: `${PLAN_MODULE_PREFIX}：${m.label}`,
    icon: m.icon,
    tasks: m.tasks.map(t => ({ id: t.id, label: t.label, hint: t.hint })),
  }))
  return [...planModules, ...staticModules]
}

/** 先查教案任務，再查靜態 TASK_HINTS。 */
export function resolveTaskHint(taskId: string, plan: LessonPlan | null | undefined): TaskHint | undefined {
  if (plan) {
    for (const m of plan.modules) {
      const t = m.tasks.find(x => x.id === taskId)
      if (t) return t.hint
    }
  }
  return TASK_HINTS[taskId]
}

/** 教案存在且場景相符 → 用教案的 sceneConstraint；否則用靜態 SCENE_CONSTRAINTS。 */
export function resolveSceneConstraint(sceneId: string, plan: LessonPlan | null | undefined): string | undefined {
  if (plan && plan.sceneId === sceneId) return plan.sceneConstraint
  return SCENE_CONSTRAINTS[sceneId]
}
