import type { CefrLevel, SceneContext, TaskHint } from '../lessonPlanTypes.js'

export const LEVEL_GUIDE: Record<CefrLevel, string> = {
  A1: 'CEFR A1 (beginner, roughly Taiwan grades 3-4). Present simple only, very high-frequency words, sentences of 4-7 words, one idea per sentence. Avoid clauses, phrasal verbs and idioms.',
  A2: 'CEFR A2 (elementary, roughly Taiwan grades 5-6). Present, past and "be going to"; everyday vocabulary; sentences up to ~10 words; simple "because" / "but" clauses are fine.',
  B1: 'CEFR B1 (intermediate, roughly Taiwan junior high). Common tenses including present perfect, modals for politeness, sentences up to ~14 words, simple relative clauses allowed.',
}

const STR = { type: 'STRING' }
const STR_ARRAY = { type: 'ARRAY', items: STR }

export const OUTLINE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: STR,
    objectives: STR_ARRAY,
    timeline: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { phase: STR, minutes: { type: 'INTEGER' }, activity: STR }, required: ['phase', 'minutes', 'activity'] },
    },
    modules: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { label: STR, icon: STR, taskLabels: STR_ARRAY }, required: ['label', 'icon', 'taskLabels'] },
    },
    sceneConstraint: STR,
  },
  required: ['title', 'objectives', 'timeline', 'modules', 'sceneConstraint'],
}

export const SCRIPT_SCHEMA = {
  type: 'OBJECT',
  properties: { teacherScript: STR },
  required: ['teacherScript'],
}

export const MODULE_HINTS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    tasks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label: STR,
          keyStructure: STR,
          partialSentence: STR,
          unscramble: STR_ARRAY,
          completeSentence: STR,
          extraPhrases: STR_ARRAY,
        },
        required: ['label', 'keyStructure', 'partialSentence', 'unscramble', 'completeSentence', 'extraPhrases'],
      },
    },
  },
  required: ['tasks'],
}

export const NOTES_SCHEMA = {
  type: 'OBJECT',
  properties: {
    grammarNotes: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { point: STR, explanation: STR, examples: STR_ARRAY }, required: ['point', 'explanation', 'examples'] },
    },
    teachingNotes: STR_ARRAY,
  },
  required: ['grammarNotes', 'teachingNotes'],
}

function describeScene(ctx: SceneContext): string {
  const slots = ctx.slots.map(s => `${s.label} (${s.id})`).join(', ')
  return `Theme: ${ctx.themeLabel}. Scene: ${ctx.sceneLabel} / ${ctx.sceneLabelEn} (id: ${ctx.sceneId}).
Roles on stage: ${slots}. One student plays each role; the teacher may also step into a role.
Existing task modules in this scene (do NOT duplicate them): ${ctx.existingModuleLabels.join(', ') || 'none'}.`
}

function describeExamples(examples: SceneContext['exampleTasks']): string {
  return examples
    .map(e => `- label: "${e.label}"\n  hint: ${JSON.stringify(e.hint)}`)
    .join('\n')
}

export function buildOutlinePrompt(topic: string, level: CefrLevel, ctx: SceneContext): { systemInstruction: string; prompt: string } {
  return {
    systemInstruction: `You are an experienced English conversation teacher designing a 15-minute micro-lesson for a mixed-reality classroom where students speak as avatars in a 3D scene.
Student level: ${LEVEL_GUIDE[level]}
${describeScene(ctx)}

Write in Traditional Chinese for "title", "objectives", every "phase" and "activity"; write in English for task labels and "sceneConstraint".

Rules:
- The timeline has 3 to 5 phases and the "minutes" values MUST add up to exactly 15.
- Produce 2 to 4 task modules, each with 3 to 6 task labels. Each label is ONE English imperative sentence telling the student what to say, in the style of: "Ask for the price of a blue T-shirt."
- "icon" is a single emoji for the module.
- "sceneConstraint" is a 5-line English block with the headings Setting:, Language:, Grammar:, Vocabulary:, Response style: describing the scene for this topic, used later to steer an AI that writes sample student replies. Keep it concrete.
- Do not include the teacher script or hints here; another step writes them.`,
    prompt: `Lesson topic from the teacher: "${topic}". Design the outline now.`,
  }
}

export function buildScriptPrompt(
  outline: { title: string; objectives: string[] },
  phase: { phase: string; minutes: number; activity: string },
  level: CefrLevel,
  ctx: SceneContext,
): { systemInstruction: string; prompt: string } {
  return {
    systemInstruction: `You write the teacher's verbatim spoken script for ONE phase of a 15-minute English conversation micro-lesson.
Student level: ${LEVEL_GUIDE[level]}
${describeScene(ctx)}
Lesson title: ${outline.title}. Objectives: ${outline.objectives.join('; ')}.

Write in English, first person, as the teacher speaking to the class. Include what the teacher says to open the phase, the instructions, 2-3 model exchanges the teacher demonstrates, and how the teacher hands over to students. Mark short stage directions in square brackets, e.g. [point to the counter]. Target about ${phase.minutes * 120} words (between ${phase.minutes * 100} and ${phase.minutes * 150}).`,
    prompt: `Phase: ${phase.phase} (${phase.minutes} min). Activity: ${phase.activity}. Write the teacher script.`,
  }
}

export function buildModuleHintsPrompt(
  moduleLabel: string,
  taskLabels: string[],
  level: CefrLevel,
  examples: SceneContext['exampleTasks'],
): { systemInstruction: string; prompt: string } {
  return {
    systemInstruction: `You create 5-level scaffolding hints for English speaking tasks. Student level: ${LEVEL_GUIDE[level]}

For EACH task label you receive, output one object with exactly these fields:
- "label": copy the task label verbatim.
- "completeSentence": ONE natural English sentence the student says to accomplish the task.
- "keyStructure": the sentence skeleton with replaceable parts in [brackets], joined by " + ", e.g. "What + is + the price of + the + [color] + [item]?"
- "partialSentence": the complete sentence with 2-3 key words replaced by "_____".
- "unscramble": the words of "completeSentence" split on spaces, in a SHUFFLED order. Every token must appear exactly as it does in "completeSentence" (keep punctuation attached to the word). Same number of tokens.
- "extraPhrases": 2 or 3 alternative sentences with the same meaning.

Format examples from an existing module:
${describeExamples(examples)}

Return the tasks in the same order as the labels given.`,
    prompt: `Module: ${moduleLabel}\nTask labels:\n${taskLabels.map((l, i) => `${i + 1}. ${l}`).join('\n')}`,
  }
}

export function buildNotesPrompt(
  outline: { title: string; objectives: string[] },
  sentences: string[],
  level: CefrLevel,
): { systemInstruction: string; prompt: string } {
  return {
    systemInstruction: `You are an English teacher-trainer in Taiwan writing notes for a colleague who will teach a 15-minute conversation micro-lesson. Student level: ${LEVEL_GUIDE[level]}

Output:
- "grammarNotes": 2 to 4 items. "point" is the English name of the structure (e.g. "would like to + noun"), "explanation" is 1-3 sentences in Traditional Chinese explaining form and use for this level, "examples" are 2 English sentences taken from or close to the target sentences.
- "teachingNotes": 3 to 6 short bullets in Traditional Chinese: common student errors to listen for, pronunciation traps, pacing advice, and how to use the 3D scene roles.`,
    prompt: `Lesson: ${outline.title}\nObjectives: ${outline.objectives.join('; ')}\nTarget sentences students will say:\n${sentences.map(s => `- ${s}`).join('\n')}`,
  }
}
