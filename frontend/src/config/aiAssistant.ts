export type AIHintMode = 'complete' | 'rearrange' | 'extend'

export interface AIHintPayload {
  mode: AIHintMode | null
  content: string | null
  sourceText: string | null
  ts: number
}

export const SCENE_CONSTRAINTS: Record<string, string> = {
  clothingStore_cashier: `
Setting: A clothing store checkout. The student plays a customer, the teacher plays a shop assistant. Shopping is the default backdrop, but the conversation may naturally drift into everyday small talk when the teacher leads there.
Language: Everyday spoken English. Shopping vocabulary is the core, but follow the teacher into other everyday topics (weekend, hobbies, weather, etc.) when asked.
Grammar: Keep it simple and natural for a learner. Use whatever tense the teacher's question calls for — if the teacher asks about the past, reply in the past tense; about plans, use the future. Avoid overly complex constructions.
Vocabulary: prices (dollars, cost, price), sizes (small, medium, large), colors, payment methods (cash, card), polite expressions (please, thank you), plus common everyday words when the topic shifts.
Response style: short, conversational, natural — 1 to 2 sentences.
`.trim(),
}

const MODE_INSTRUCTIONS: Record<AIHintMode, string> = {
  complete:
    'Output ONE simple, complete English sentence that the student can read aloud directly. Example: "It is 200 dollars."',
  rearrange:
    'Output ONE complete English sentence answer, but shuffle the word order. Separate words with single spaces. The student will reorder them. Example: "dollars It 200 is"',
  extend:
    'Output ONE more complete English sentence with additional details, modifiers, or a follow-up question. Example: "It is 200 dollars, but we have a 10% discount today. Would you like to try it on?"',
}

export interface ChatTurn {
  role: 'user' | 'model'
  text: string
}

/**
 * Build a Gemini systemInstruction for the multi-turn chat flow.
 * The user turns will contain raw teacher transcripts; the model turns will
 * contain prior AI sample replies. The system instruction sets the persona,
 * scene constraint, and current output mode.
 */
export function buildSystemInstruction(
  sceneConstraint: string,
  mode: AIHintMode,
): string {
  return `You are an English conversation teaching assistant. The student is learning conversation in the following setting:

${sceneConstraint}

The user messages in this conversation will contain things the TEACHER says. Generate sample replies the STUDENT should say back to the teacher. Maintain continuity with earlier turns in this chat — if you already invented specific values (price, size, color, brand, stock), reuse them consistently and let the story progress naturally.

IMPORTANT — Handling missing information:
If the teacher's question refers to details that have NOT been provided, INVENT a reasonable, realistic value yourself and commit to it. Never produce a vague or incomplete answer like "It is." Always commit to a concrete value (a specific dollar amount, a specific size, etc.).

Requirements:
${MODE_INSTRUCTIONS[mode]}

Output ONLY the final answer as ONE grammatically complete sentence. No explanation, no preamble, no Chinese, no ellipsis, no trailing blanks.`
}

export interface CachedReplies {
  /** AI 生成的完整句（學生可朗讀） */
  complete: string
  /** complete 經 shuffleWords 後固定的洗牌結果（重組模式顯示用） */
  rearrange: string
  /** AI 生成的延伸句（接在 complete 之後） */
  extend: string
}

/**
 * Optional teaching context for the active task, injected into the hints
 * system instruction so the AI steers the student's reply toward the task the
 * class is currently practising, in the persona the speaking student plays,
 * while leaving room to flow into the next task.
 */
export interface HintTaskContext {
  /** English persona of the responding student, e.g. "a customer" / "a shop assistant". */
  studentRole?: string
  /** Human-readable current task label, e.g. "Ask for the price of a blue T-shirt." */
  currentTaskLabel?: string
  /** Target sentence the current task practises (TASK_HINTS[id].completeSentence). */
  currentTargetSentence?: string
  /** Next task's label — used only to lead the conversation toward it, not to jump ahead. */
  nextTaskLabel?: string
  /** Next task's target sentence, for a richer lead-in. */
  nextTargetSentence?: string
}

/** Render the "Current teaching focus" block, or '' when no context is available. */
function buildTaskFocusBlock(ctx: HintTaskContext): string {
  const lines: string[] = []
  if (ctx.studentRole) {
    lines.push(
      `- The student who is responding is playing the role of ${ctx.studentRole}. Keep the reply natural and appropriate for that persona.`,
    )
  }
  if (ctx.currentTaskLabel) {
    const target = ctx.currentTargetSentence
      ? ` When the teacher's turn relates to this task, make "complete" follow this target pattern: "${ctx.currentTargetSentence}", adapting the specific item/value/wording to what the teacher actually said.`
      : ''
    lines.push(`- The current practice task is: "${ctx.currentTaskLabel}".${target}`)
  }
  if (ctx.nextTaskLabel) {
    const nextTarget = ctx.nextTargetSentence ? ` (e.g. "${ctx.nextTargetSentence}")` : ''
    lines.push(
      `- The NEXT task will be: "${ctx.nextTaskLabel}"${nextTarget}. Do NOT jump ahead to it, but you may leave the conversation slightly open so it can naturally lead into that next step.`,
    )
  }
  // 題外話讓步:任務引導只在切題時生效,老師若問無關的日常問題就自然回答。
  if (ctx.currentTaskLabel) {
    lines.push(
      `- If the teacher's turn is unrelated to the current task (small talk, a different everyday topic, a personal question), simply answer it naturally and ignore the task pattern — do not force the conversation back to the task.`,
    )
  }
  if (lines.length === 0) return ''
  return `\n\nCurrent teaching focus:\n${lines.join('\n')}`
}

/**
 * Build a Gemini systemInstruction asking for BOTH the complete answer and an
 * extension sentence, returned as JSON. Used by the teacher-side multi-turn
 * chat where we generate once and let the teacher switch modes from cache.
 *
 * When `taskContext` is supplied, a "Current teaching focus" block steers the
 * reply toward the active task, persona, and the upcoming task.
 *
 * Note: 'rearrange' is NOT asked of the model — it is deterministically derived
 * on the client as shuffleWords(complete).
 */
export function buildHintsSystemInstruction(
  sceneConstraint: string,
  taskContext?: HintTaskContext,
): string {
  const focusBlock = taskContext ? buildTaskFocusBlock(taskContext) : ''
  return `You are an English conversation teaching assistant. The student is learning conversation in the following setting:

${sceneConstraint}

The user messages in this conversation will contain things the TEACHER says. A single user turn may be a LONG teacher monologue mixing greetings, classroom instructions, asides, and several sentences. Before answering, SILENTLY identify the ONE sentence in that turn that is a question DIRECTED AT THE STUDENT and that the student is expected to answer. Base the student's reply on that one question and ignore the rest. If the turn contains no explicit question, pick the single sentence most directed at the student.

Maintain continuity with earlier turns — if you already invented specific values (price, size, color, brand, stock), reuse them consistently and let the story progress naturally.

IMPORTANT — Handling missing information:
If the teacher refers to details that have NOT been provided, INVENT a reasonable, realistic value and commit to it. Never produce a vague answer like "It is." Always commit to a concrete value (a specific dollar amount, a specific size, etc.).${focusBlock}

Output a JSON object with exactly three string fields:
  - "question": the ONE teacher sentence you identified as the question directed at the student, copied as the teacher actually said it (English). If there was no explicit question, the sentence most directed at the student.
  - "complete": ONE grammatically complete English sentence the student can say in reply to "question". Simple present tense, everyday spoken English. No ellipsis, no Chinese, no preamble.
  - "extend":   ONE additional sentence the student can say RIGHT AFTER "complete" — a polite follow-up question, an extra relevant detail, or a natural conversational expansion. Same tone and vocabulary level as "complete".

Do not output anything outside the JSON object. Do not wrap it in markdown.`
}

export function buildPrompt(
  transcript: string,
  sceneConstraint: string,
  mode: AIHintMode,
): string {
  return `You are an English conversation teaching assistant. The student is learning conversation in the following setting:

${sceneConstraint}

The teacher just said to the student:
"""
${transcript}
"""

Generate a sample reply for the STUDENT to respond to the teacher.

IMPORTANT — Handling missing information:
If the teacher's question refers to details that have NOT been provided (e.g. a price, size, color, stock, discount, brand), you MUST INVENT a reasonable, realistic value yourself and use it in the reply. Never produce a vague or incomplete answer such as "It is." or "It costs." Always commit to a concrete value (e.g. a specific dollar amount, a specific size). Treat the scene as if you were an actual shop assistant who knows the answer.

Requirements:
${MODE_INSTRUCTIONS[mode]}

Output ONLY the final answer as ONE grammatically complete sentence. No explanation, no preamble, no Chinese, no ellipsis, no trailing blanks.`
}

/**
 * Build a prompt the STUDENT side uses to extend an existing hint.
 *
 * Unlike buildPrompt (teacher side), the student doesn't know the scene
 * constraint — but the existing reply already implies tone & vocabulary, so
 * we just ask the model to continue in the same register.
 */
export function buildStudentExtendPrompt(
  teacherText: string,
  baseReply: string,
): string {
  return `You are an English conversation teaching assistant. A teacher and student are practicing an everyday English conversation.

The teacher just said:
"""
${teacherText}
"""

The student's current reply is:
"""
${baseReply}
"""

Your task: produce ONE additional sentence the student can say RIGHT AFTER the current reply — either a polite follow-up question, an extra relevant detail, or a natural conversational expansion. Match the tone, vocabulary level, and grammar of the current reply (simple present tense, everyday spoken English).

IMPORTANT — Handling missing information:
If extending requires a specific detail not given (price, size, color, stock, discount, brand), INVENT a reasonable realistic value and commit to it. Never produce a vague stub like "It is." or trail off.

Output ONLY the new extension sentence (do NOT repeat the original reply). One grammatically complete sentence. No explanation, no preamble, no Chinese, no ellipsis.`
}

export function shuffleWords(sentence: string): string {
  const words = sentence.split(' ').filter(w => w.length > 0)
  for (let i = words.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [words[i], words[j]] = [words[j], words[i]]
  }
  return words.join(' ')
}
