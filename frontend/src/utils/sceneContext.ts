import { THEMES } from '../config/scenes.ts'
import { TASK_HINTS } from '../config/taskHints.ts'
import type { SceneContext } from '../types/lessonPlan.ts'

const MAX_EXAMPLES = 3

/**
 * 從靜態 THEMES / TASK_HINTS 整理出生成教案所需的場景脈絡。
 * 後端不另存場景表，維持「編輯內容只改 THEMES」的原則。
 */
export function buildSceneContext(sceneId: string): SceneContext | null {
  for (const theme of THEMES) {
    const scene = theme.scenes.find(s => s.id === sceneId)
    if (!scene) continue
    const modules = scene.modules ?? []
    const exampleTasks: SceneContext['exampleTasks'] = []
    for (const mod of modules) {
      for (const task of mod.tasks) {
        const hint = TASK_HINTS[task.id]
        if (hint) exampleTasks.push({ label: task.label, hint })
        if (exampleTasks.length >= MAX_EXAMPLES) break
      }
      if (exampleTasks.length >= MAX_EXAMPLES) break
    }
    return {
      sceneId,
      themeLabel: theme.label,
      sceneLabel: scene.label,
      sceneLabelEn: scene.labelEn ?? scene.label,
      slots: (scene.slots ?? []).map(s => ({ id: s.id, label: s.label })),
      existingModuleLabels: modules.map(m => m.label),
      exampleTasks,
    }
  }
  return null
}
