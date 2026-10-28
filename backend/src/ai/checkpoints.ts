import { randomUUID } from 'node:crypto'
import { callGemini } from './client.js'
import type { GeminiCaller } from './lessonPlan.js'
import { LEVEL_GUIDE } from './lessonPlanPrompts.js'
import { cleanCheckpoints, type RawCheckpoint } from './dialogueTask.js'
import type { CefrLevel } from '../lessonPlanTypes.js'
import type { AudienceCheckpoint } from '../dialogueTaskTypes.js'

/** 一次產生的題數上限 */
export const MAX_GENERATED_CHECKPOINTS = 3

export type CheckpointKindRequest = 'choice' | 'truefalse' | 'mixed'

export interface CheckpointRequest {
  level: CefrLevel
  /** 這一步有台詞的角色（id 用在題目的 {角色代號}） */
  roles: { id: string; label: string }[]
  step: { title: string; purpose: string; lines: { speaker: string; en: string; zh: string }[] }
  /** 已有的題目，避免重複 */
  avoid: string[]
  kind: CheckpointKindRequest
  count: number
}

const TAG = '[ai/checkpoints]'
const STR = { type: 'STRING' }

export const CHECKPOINTS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    checkpoints: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          kind: { type: 'STRING', enum: ['choice', 'truefalse'] },
          title: STR,
          question: STR,
          options: { type: 'ARRAY', items: STR },
          answerIndex: { type: 'INTEGER' },
          followUp: STR,
        },
        required: ['kind', 'title', 'question', 'options', 'answerIndex'],
      },
    },
  },
  required: ['checkpoints'],
}

const KIND_RULE: Record<CheckpointKindRequest, string> = {
  choice: 'Every question must be "choice".',
  truefalse: 'Every question must be "truefalse".',
  mixed: 'Mix "choice" and "truefalse" when writing more than one question.',
}

export function buildCheckpointPrompt(req: CheckpointRequest): { systemInstruction: string; prompt: string } {
  const label = (id: string) => req.roles.find(r => r.id === id)?.label ?? id
  const script = req.step.lines.map(l => `{${l.speaker}} (${label(l.speaker)}): ${l.en}  ／ ${l.zh}`).join('\n')
  const example = req.roles[0]?.id ?? 'customer'
  return {
    systemInstruction: `You are an experienced English teacher in Taiwan writing audience questions for a role-play lesson in a mixed-reality classroom.
Student level: ${LEVEL_GUIDE[req.level]}
Only a few students act the dialogue on stage; the rest of the class watches and answers on their own tablets right after the step is performed.

Rules:
- Each question checks listening comprehension of a concrete fact actually said in THIS step (an item, colour, size, price, number, choice, reason, payment method, who said or wanted what…), never something only visible or not said.
- ${KIND_RULE[req.kind]}
- "title": a 4-character Traditional Chinese label for the skill, e.g. 顏色理解, 價格理解, 是非判斷.
- "question": one short English question (or, for truefalse, one English statement) within the student level.
- When the question mentions a role, write its role id in braces instead of a name, e.g. "What does {${example}} want?". Never write role names — the braces are replaced with the student's name in class. Only use these role ids: ${req.roles.map(r => r.id).join(', ')}.
- "options": for "choice", 3 short, distinct English options (only one correct, the others plausible from the dialogue); for "truefalse", exactly ["True", "False"]. Vary which option is correct.
- "answerIndex": the 0-based index of the correct option.
- "followUp" (optional, may be empty): one English follow-up question the teacher can ask stronger students.
- Do not repeat or rephrase the existing questions listed by the teacher.`,
    prompt: `Step: ${req.step.title}${req.step.purpose ? `（${req.step.purpose}）` : ''}
Script of this step (role id, role, English ／ Chinese):
${script}
${req.avoid.length > 0 ? `\nExisting questions (do not repeat):\n${req.avoid.map(q => `- ${q}`).join('\n')}\n` : ''}
Write exactly ${req.count} new audience question${req.count > 1 ? 's' : ''} now.`,
  }
}

/**
 * 依劇本某一步的台詞產生台下互動題（格式同任務的 checkpoints）。
 * 不合格的題目直接略過；一題都沒有時重試一次。結果不存檔，由老師在課堂上決定要不要發布。
 */
export async function generateCheckpoints(
  req: CheckpointRequest,
  opts: { signal?: AbortSignal; call?: GeminiCaller } = {},
): Promise<AudienceCheckpoint[]> {
  const call: GeminiCaller = opts.call ?? callGemini
  const speakers = req.roles.map(r => r.id)
  const { systemInstruction, prompt } = buildCheckpointPrompt(req)
  const run = async () => {
    const { data } = await call<{ checkpoints: unknown }>({
      tag: TAG, contents: prompt, systemInstruction,
      temperature: 0.8, maxOutputTokens: 2048, thinkingBudget: 512,
      responseSchema: CHECKPOINTS_SCHEMA, signal: opts.signal,
      parse: t => JSON.parse(t) as { checkpoints: unknown },
    })
    let list: RawCheckpoint[] = cleanCheckpoints(data?.checkpoints, speakers, MAX_GENERATED_CHECKPOINTS + 2)
    if (req.kind !== 'mixed') list = list.filter(c => (c.kind ?? 'choice') === req.kind)
    const avoid = new Set(req.avoid.map(q => q.trim().toLowerCase()))
    return list.filter(c => !avoid.has(c.question.toLowerCase())).slice(0, req.count)
  }
  let list = await run()
  if (list.length === 0) {
    console.warn(`${TAG} no valid question, retrying once`)
    list = await run()
  }
  if (list.length === 0) throw new Error(`${TAG} no valid question generated`)
  return list.map(c => ({ id: `ai_cp_${randomUUID().slice(0, 8)}`, ...c }))
}
