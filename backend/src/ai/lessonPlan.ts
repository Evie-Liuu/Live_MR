import { callGemini, type GeminiCallOptions, type GeminiCallResult } from './client.js'
import {
  OUTLINE_SCHEMA, SCRIPT_SCHEMA, MODULE_HINTS_SCHEMA, NOTES_SCHEMA,
  buildOutlinePrompt, buildScriptPrompt, buildModuleHintsPrompt, buildNotesPrompt,
} from './lessonPlanPrompts.js'
import type { CefrLevel, LessonPlan, LessonPlanModule, SceneContext, TaskHint, GrammarNote } from '../lessonPlanTypes.js'

export interface LessonPlanRequest {
  sceneId: string
  topic: string
  level: CefrLevel
  sceneContext: SceneContext
}

export interface OutlineDraft {
  title: string
  objectives: string[]
  timeline: { phase: string; minutes: number; activity: string }[]
  modules: { label: string; icon: string; taskLabels: string[] }[]
  sceneConstraint: string
}

export type GeminiCaller = <T>(opts: GeminiCallOptions<T>) => Promise<GeminiCallResult<T>>

interface DraftModule { label: string; icon: string; tasks: { label: string; hint: TaskHint }[] }

const TOTAL_MINUTES = 15

// ── 驗證與修復 ────────────────────────────────────────────────────────────────

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(x => typeof x === 'string')
}

/** 大綱結構檢查；分鐘總和錯或模組缺失都拋錯，呼叫端決定是否重試。 */
export function validateOutline(raw: unknown): OutlineDraft {
  const o = raw as Partial<OutlineDraft>
  if (!o || typeof o.title !== 'string' || !o.title.trim()) throw new Error('outline: title missing')
  if (!isStringArray(o.objectives) || o.objectives.length === 0) throw new Error('outline: objectives missing')
  if (!Array.isArray(o.timeline) || o.timeline.length === 0) throw new Error('outline: timeline minutes must sum to 15')
  const sum = o.timeline.reduce((acc, p) => acc + (typeof p.minutes === 'number' ? p.minutes : 0), 0)
  if (sum !== TOTAL_MINUTES) throw new Error(`outline: timeline minutes must sum to 15 (got ${sum})`)
  if (!Array.isArray(o.modules) || o.modules.length === 0) throw new Error('outline: modules missing')
  for (const m of o.modules) {
    if (typeof m.label !== 'string' || !isStringArray(m.taskLabels) || m.taskLabels.length === 0) throw new Error('outline: module malformed')
  }
  if (typeof o.sceneConstraint !== 'string' || !o.sceneConstraint.trim()) throw new Error('outline: sceneConstraint missing')
  return {
    title: o.title.trim(),
    objectives: o.objectives,
    timeline: o.timeline.map(p => ({ phase: String(p.phase), minutes: Number(p.minutes), activity: String(p.activity) })),
    modules: o.modules.map(m => ({ label: m.label, icon: typeof m.icon === 'string' && m.icon ? m.icon : '📘', taskLabels: m.taskLabels })),
    sceneConstraint: o.sceneConstraint.trim(),
  }
}

function tokens(sentence: string): string[] {
  return sentence.split(/\s+/).filter(Boolean)
}

export function unscrambleMatches(hint: TaskHint): boolean {
  const a = [...hint.unscramble].sort()
  const b = tokens(hint.completeSentence).sort()
  return a.length === b.length && a.every((w, i) => w === b[i])
}

/** Fisher-Yates 洗牌 completeSentence 的 token 當作重組題。 */
export function repairUnscramble(sentence: string): string[] {
  const words = tokens(sentence)
  for (let i = words.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [words[i], words[j]] = [words[j], words[i]]
  }
  return words
}

export function assignIds(planId: string, modules: DraftModule[]): LessonPlanModule[] {
  let n = 0
  return modules.map((m, k) => ({
    id: `plan_${planId}_m${k + 1}`,
    label: m.label,
    icon: m.icon,
    tasks: m.tasks.map(t => ({ id: `plan_${planId}_${++n}`, label: t.label, hint: t.hint })),
  }))
}

// ── 各步驟 ────────────────────────────────────────────────────────────────────

async function stepOutline(req: LessonPlanRequest, call: GeminiCaller, signal?: AbortSignal): Promise<OutlineDraft> {
  const { systemInstruction, prompt } = buildOutlinePrompt(req.topic, req.level, req.sceneContext)
  const run = () => call<OutlineDraft>({
    tag: '[ai/lesson/outline]', contents: prompt, systemInstruction,
    temperature: 0.5, maxOutputTokens: 2048, thinkingBudget: 1024,
    responseSchema: OUTLINE_SCHEMA, signal, parse: t => JSON.parse(t) as OutlineDraft,
  })
  try {
    return validateOutline((await run()).data)
  } catch (first) {
    console.warn('[ai/lesson/outline] invalid, retrying once:', first instanceof Error ? first.message : String(first))
    return validateOutline((await run()).data)
  }
}

async function stepScript(
  outline: OutlineDraft, phase: OutlineDraft['timeline'][number], req: LessonPlanRequest, call: GeminiCaller, signal?: AbortSignal,
): Promise<string> {
  const { systemInstruction, prompt } = buildScriptPrompt(outline, phase, req.level, req.sceneContext)
  const { data } = await call<{ teacherScript: string }>({
    tag: '[ai/lesson/script]', contents: prompt, systemInstruction,
    temperature: 0.7, maxOutputTokens: 1536, thinkingBudget: 0,
    responseSchema: SCRIPT_SCHEMA, signal,
    parse: t => {
      const p = JSON.parse(t) as { teacherScript?: unknown }
      if (typeof p.teacherScript !== 'string' || !p.teacherScript.trim()) throw new Error('teacherScript missing')
      return { teacherScript: p.teacherScript.trim() }
    },
  })
  const words = tokens(data.teacherScript).length
  if (words < phase.minutes * 100 || words > phase.minutes * 150) {
    console.warn(`[ai/lesson/script] "${phase.phase}" has ${words} words, expected ${phase.minutes * 100}-${phase.minutes * 150}`)
  }
  return data.teacherScript
}

interface RawHintTask extends TaskHint { label: string }

async function stepModuleHints(
  mod: OutlineDraft['modules'][number], req: LessonPlanRequest, call: GeminiCaller, signal?: AbortSignal,
): Promise<DraftModule> {
  const { systemInstruction, prompt } = buildModuleHintsPrompt(mod.label, mod.taskLabels, req.level, req.sceneContext.exampleTasks)
  const run = () => call<{ tasks: RawHintTask[] }>({
    tag: '[ai/lesson/hints]', contents: prompt, systemInstruction,
    temperature: 0.4, maxOutputTokens: 2048, thinkingBudget: 256,
    responseSchema: MODULE_HINTS_SCHEMA, signal,
    parse: t => {
      const p = JSON.parse(t) as { tasks?: unknown }
      if (!Array.isArray(p.tasks)) throw new Error('tasks missing')
      for (const task of p.tasks as Partial<RawHintTask>[]) {
        if (typeof task.completeSentence !== 'string' || !isStringArray(task.unscramble) ||
            typeof task.keyStructure !== 'string' || typeof task.partialSentence !== 'string' || !isStringArray(task.extraPhrases)) {
          throw new Error('hint task malformed')
        }
      }
      return p as { tasks: RawHintTask[] }
    },
  })
  const toDraft = (tasks: RawHintTask[]): DraftModule => {
    if (tasks.length !== mod.taskLabels.length) {
      throw new Error(`[ai/lesson/hints] task count mismatch for "${mod.label}": expected ${mod.taskLabels.length}, got ${tasks.length}`)
    }
    return {
      label: mod.label, icon: mod.icon,
      tasks: tasks.map((t, i) => ({
        label: mod.taskLabels[i],
        hint: { keyStructure: t.keyStructure, partialSentence: t.partialSentence, unscramble: t.unscramble, completeSentence: t.completeSentence, extraPhrases: t.extraPhrases },
      })),
    }
  }
  let draft = toDraft((await run()).data.tasks)
  if (draft.tasks.some(t => !unscrambleMatches(t.hint))) {
    console.warn(`[ai/lesson/hints] unscramble mismatch in "${mod.label}", retrying once`)
    draft = toDraft((await run()).data.tasks)
    for (const t of draft.tasks) {
      if (!unscrambleMatches(t.hint)) {
        console.warn(`[ai/lesson/hints] repairing unscramble for "${t.label}"`)
        t.hint.unscramble = repairUnscramble(t.hint.completeSentence)
      }
    }
  }
  return draft
}

async function stepNotes(
  outline: OutlineDraft, sentences: string[], req: LessonPlanRequest, call: GeminiCaller, signal?: AbortSignal,
): Promise<{ grammarNotes: GrammarNote[]; teachingNotes: string[] }> {
  const { systemInstruction, prompt } = buildNotesPrompt(outline, sentences, req.level)
  const { data } = await call<{ grammarNotes: GrammarNote[]; teachingNotes: string[] }>({
    tag: '[ai/lesson/notes]', contents: prompt, systemInstruction,
    temperature: 0.5, maxOutputTokens: 2048, thinkingBudget: 256,
    responseSchema: NOTES_SCHEMA, signal,
    parse: t => {
      const p = JSON.parse(t) as { grammarNotes?: unknown; teachingNotes?: unknown }
      if (!Array.isArray(p.grammarNotes) || !isStringArray(p.teachingNotes)) throw new Error('notes malformed')
      return p as { grammarNotes: GrammarNote[]; teachingNotes: string[] }
    },
  })
  return data
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

/**
 * 兩步結構化 workflow：大綱 → 並行展開（逐時段腳本、逐模組五階層提示、語法與注意點）。
 * 任一步驟拋錯即整體失敗；不做自主迴圈。
 */
export async function generateLessonPlan(
  req: LessonPlanRequest,
  planId: string,
  opts: { signal?: AbortSignal; call?: GeminiCaller } = {},
): Promise<LessonPlan> {
  const call: GeminiCaller = opts.call ?? callGemini
  const outline = await stepOutline(req, call, opts.signal)

  const [scripts, modules] = await Promise.all([
    Promise.all(outline.timeline.map(phase => stepScript(outline, phase, req, call, opts.signal))),
    Promise.all(outline.modules.map(mod => stepModuleHints(mod, req, call, opts.signal))),
  ])
  // notes 需要完整句，所以等 hints 完成後再跑（腳本與提示彼此仍是並行的）
  const sentences = modules.flatMap(m => m.tasks.map(t => t.hint.completeSentence))
  const notes = await stepNotes(outline, sentences, req, call, opts.signal)

  return {
    title: outline.title,
    sceneId: req.sceneId,
    topic: req.topic,
    level: req.level,
    durationMin: 15,
    objectives: outline.objectives,
    timeline: outline.timeline.map((p, i) => ({ ...p, teacherScript: scripts[i] })),
    grammarNotes: notes.grammarNotes,
    teachingNotes: notes.teachingNotes,
    sceneConstraint: outline.sceneConstraint,
    modules: assignIds(planId, modules),
  }
}
