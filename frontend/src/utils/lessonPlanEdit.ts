import type { LessonPlan, LessonPlanModule } from '../types/lessonPlan.ts'

export type EditAction =
  | { type: 'set-title'; title: string }
  | { type: 'edit-task-label'; taskId: string; label: string }
  | { type: 'delete-task'; taskId: string }
  | { type: 'reset'; plan: LessonPlan }

export interface EditState {
  title: string
  modules: LessonPlanModule[]
  dirty: boolean
}

export function initEditState(plan: LessonPlan): EditState {
  return { title: plan.title, modules: plan.modules, dirty: false }
}

/** 結果頁的任務包編輯：只支援改標題、改任務文字、刪單題（spec 明定不做完整編輯器）。 */
export function editReducer(state: EditState, action: EditAction): EditState {
  switch (action.type) {
    case 'set-title':
      return { ...state, title: action.title, dirty: true }
    case 'edit-task-label':
      return {
        ...state,
        dirty: true,
        modules: state.modules.map(m => ({
          ...m,
          tasks: m.tasks.map(t => (t.id === action.taskId ? { ...t, label: action.label } : t)),
        })),
      }
    case 'delete-task':
      return {
        ...state,
        dirty: true,
        modules: state.modules
          .map(m => ({ ...m, tasks: m.tasks.filter(t => t.id !== action.taskId) }))
          .filter(m => m.tasks.length > 0),
      }
    case 'reset':
      return initEditState(action.plan)
  }
}
