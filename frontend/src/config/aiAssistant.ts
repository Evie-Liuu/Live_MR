export type AIHintMode = 'complete' | 'rearrange' | 'extend'

export interface AIHintPayload {
  mode: AIHintMode | null
  content: string | null
  sourceText: string | null
  ts: number
}

export const SCENE_CONSTRAINTS: Record<string, string> = {
  clothingStore_cashier: `
Setting: A clothing store checkout. The student plays a customer, the teacher plays a shop assistant.
Language: English, everyday shopping conversation.
Grammar: Use simple present tense primarily. Avoid past tense and complex constructions.
Vocabulary: prices (dollars, cost, price), sizes (small, medium, large), colors,
payment methods (cash, card), polite expressions (please, thank you).
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
 * Build a Gemini systemInstruction asking for BOTH the complete answer and an
 * extension sentence, returned as JSON. Used by the teacher-side multi-turn
 * chat where we generate once and let the teacher switch modes from cache.
 *
 * Note: 'rearrange' is NOT asked of the model — it is deterministically derived
 * on the client as shuffleWords(complete).
 */
export function buildHintsSystemInstruction(sceneConstraint: string): string {
  return `You are an English conversation teaching assistant. The student is learning conversation in the following setting:

${sceneConstraint}

The user messages in this conversation will contain things the TEACHER says. For each teacher turn, produce a JSON object describing what the STUDENT could say back. Maintain continuity with earlier turns — if you already invented specific values (price, size, color, brand, stock), reuse them consistently and let the story progress naturally.

IMPORTANT — Handling missing information:
If the teacher refers to details that have NOT been provided, INVENT a reasonable, realistic value and commit to it. Never produce a vague answer like "It is." Always commit to a concrete value (a specific dollar amount, a specific size, etc.).

Output a JSON object with exactly two string fields:
  - "complete": ONE grammatically complete English sentence the student can say. Simple present tense, everyday spoken English. No ellipsis, no Chinese, no preamble.
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
