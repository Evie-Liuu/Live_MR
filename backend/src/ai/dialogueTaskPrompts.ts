import type { CefrLevel, SceneContext } from '../lessonPlanTypes.js'
import { LEVEL_GUIDE, describeScene } from './lessonPlanPrompts.js'
import { GESTURE_IDS } from '../dialogueTaskTypes.js'

/** AI 不需要動作時填 none，後端轉成沒有 gesture */
export const NO_GESTURE = 'none'

/** AI 生成的任務固定為 5 分鐘微教案（前端 modal 顯示同一數值，不可更改） */
export const DIALOGUE_TASK_DURATION_MIN = 5

/** 5 分鐘內能讓學生讀完並角色扮演一輪的份量 */
export const STEP_RANGE = { min: 3, max: 5 }
/** 每步句數：演出人數越多，每步要讓每個角色都有機會開口（2 人 2–4 句、3 人 2–6 句、4 人 2–8 句） */
export function linesPerStepRange(castSize: number): { min: number; max: number } {
  return { min: 2, max: Math.max(4, castSize * 2) }
}
/** 每步的台下互動題數 */
export const CHECKPOINTS_PER_STEP_RANGE = { min: 1, max: 2 }
/** AI 產生的主題標籤數量 */
export const TAG_RANGE = { min: 3, max: 5 }

const STR = { type: 'STRING' }
const STR_ARRAY = { type: 'ARRAY', items: STR }

/**
 * 演出人數：老師指定時 AI 只用這麼多個角色；未指定時（auto）AI 依主題決定，最多為場景角色數。
 */
export type CastRequest = number | undefined

/** 輸出結構與任務編輯器 / taskTemplates 的 DialogueTask 相同（id 由後端補上）；speaker 限定為場景角色 id */
export function buildDialogueTaskSchema(slotIds: string[]): Record<string, unknown> {
  return {
    type: 'OBJECT',
    properties: {
      title: STR,
      tags: STR_ARRAY,
      steps: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            title: STR,
            purpose: STR,
            lines: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  speaker: { type: 'STRING', enum: slotIds },
                  en: STR,
                  zh: STR,
                  gesture: { type: 'STRING', enum: [...GESTURE_IDS, NO_GESTURE] },
                },
                required: ['speaker', 'en', 'zh', 'gesture'],
              },
            },
            grammarPoints: STR_ARRAY,
            grammarNote: STR,
            teachingNotes: STR_ARRAY,
            checkpoints: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  kind: { type: 'STRING', enum: ['choice', 'truefalse'] },
                  title: STR,
                  question: STR,
                  options: STR_ARRAY,
                  answerIndex: { type: 'INTEGER' },
                  followUp: STR,
                },
                required: ['kind', 'title', 'question', 'options', 'answerIndex'],
              },
            },
          },
          required: ['title', 'purpose', 'lines', 'grammarPoints', 'grammarNote', 'teachingNotes', 'checkpoints'],
        },
      },
      castMerges: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { from: { type: 'STRING', enum: slotIds }, to: { type: 'STRING', enum: slotIds } },
          required: ['from', 'to'],
        },
      },
    },
    // castMerges 必填（2 人時為空陣列），否則模型常直接省略
    required: ['title', 'tags', 'steps', 'castMerges'],
  }
}

function describeCast(castSize: CastRequest, slotCount: number): string {
  if (castSize !== undefined) {
    return `- Cast size: the teacher wants EXACTLY ${castSize} speaking role${castSize > 1 ? 's' : ''}. Pick the ${castSize} most suitable roles from the list and use only them; every chosen role must speak at least 2 lines in the whole task, and the lines should be shared fairly.`
  }
  return `- Cast size: choose 2 to ${slotCount} speaking roles from the list that suit the topic best; every role you use must speak at least 2 lines in the whole task.`
}

export function buildDialogueTaskPrompt(
  topic: string, level: CefrLevel, ctx: SceneContext, teachingGoal?: string, castSize?: CastRequest,
): { systemInstruction: string; prompt: string } {
  const roles = ctx.slots.map(s => `"${s.id}" = ${s.label}`).join(', ')
  const maxCast = castSize ?? ctx.slots.length
  const lines = linesPerStepRange(maxCast)
  const example = ctx.slots[1]?.id ?? ctx.slots[0].id
  return {
    systemInstruction: `You are an experienced English conversation teacher in Taiwan writing a role-play dialogue task for a ${DIALOGUE_TASK_DURATION_MIN}-minute micro-lesson in a mixed-reality classroom, where students speak as avatars in a 3D scene.
Student level: ${LEVEL_GUIDE[level]}
${describeScene(ctx)}

The task is a dialogue flow split into steps (for example: greeting → asking → deciding → paying → goodbye). Students read and act out the whole flow, so it MUST fit in ${DIALOGUE_TASK_DURATION_MIN} minutes.

Rules:
- ${STEP_RANGE.min} to ${STEP_RANGE.max} steps, each with ${lines.min} to ${lines.max} lines (more speaking roles need more lines so everyone gets a turn). The whole dialogue must be one natural, continuous conversation from the first step to the last.
- "speaker" must be one of these role ids: ${roles}. Roles should take turns naturally; do not invent other speakers.
${describeCast(castSize, ctx.slots.length)}
- Keep facts consistent across steps (items, colours, prices, discounts, totals). If a later line depends on a calculation (e.g. a discounted total), make the numbers add up and explain the calculation in that step's "teachingNotes".
- "en": one short English line for that speaker, matching the student level. Keep vocabulary and grammar strictly within the level.
- "zh": a natural Traditional Chinese (Taiwan) translation of "en".
- "gesture": the body movement the speaker's 3D avatar makes while saying the line. One of:
  wave (greeting someone or saying goodbye), nod (agreeing, confirming, understanding),
  bow (polite thanks, apology or farewell), point (pointing at an item, place or direction),
  handOver (giving or receiving an item, receipt, money or card), thumbsUp (approval, "great", "good choice"),
  happy (pleased or excited), or none.
  Use a gesture only where it is natural — roughly one third to one half of the lines — and use none for the rest.
- "title" (task) and step "title": short Traditional Chinese names, e.g. 服飾店購物 / 招呼 / 報價.
- "tags": ${TAG_RANGE.min} to ${TAG_RANGE.max} short Traditional Chinese topic tags (2-4 characters each, no "#") naming the situations and communicative functions the task practises, so teachers can search and filter tasks, e.g. for clothing-store shopping: 購物, 詢價, 結帳.
- "purpose": a 2-6 character Traditional Chinese tag describing the communicative goal of the step, e.g. 問候引導, 價格查詢, 確認購買.
- "grammarPoints": 2 to 5 key sentence patterns actually used in the step's lines, written in English with placeholders in Chinese where helpful, e.g. "How much is + 單數商品?".
- "grammarNote": one line per grammar point, separated by a newline ("\n"). Each line is "pattern：Traditional Chinese explanation", e.g. "How much is + 單數商品?：詢問單一商品的價格。".
- "teachingNotes": 2 to 4 short, practical Traditional Chinese tips for the teacher: what students should notice or understand in this step, how to scaffold weaker students (e.g. full sentence first, then short answers), and substitution drills.
- "checkpoints": ${CHECKPOINTS_PER_STEP_RANGE.min} to ${CHECKPOINTS_PER_STEP_RANGE.max} audience questions per step. Only the students on stage act; the rest of the class watches and answers on their own tablets after the step is performed, so each question checks listening comprehension of a concrete fact said in THIS step (a colour, price, choice, reason, payment method…), never something only visible or not said.
  - "kind": "choice" (multiple choice) or "truefalse". Use both kinds across the task.
  - "title": a 4-character Traditional Chinese label for the skill, e.g. 顏色理解, 價格理解, 是非判斷.
  - "question": one short English question (or, for truefalse, one English statement) within the student level.
  - When the question mentions a role, write its role id in braces instead of a name, e.g. "What does {${example}} want to buy?" or "{${example}} pays by card." Never write role names like "Customer A" — the braces are replaced with the student's name in class.
  - "options": for "choice", 3 short, distinct English options (only one correct, the others plausible from the dialogue); for "truefalse", exactly ["True", "False"].
  - "answerIndex": the 0-based index of the correct option.
  - "followUp" (optional, may be empty): one English follow-up question the teacher can ask stronger students, e.g. "Which one is cheaper?".
- "castMerges": only when 3 or more roles speak. An ordered list of merges that let fewer students perform the same dialogue: after applying the first merge, the "from" role's lines are spoken by the "to" role, and so on, until only 2 roles are left. Merge a role into a role on the SAME side (shop assistant into shop assistant, customer into customer) so the dialogue still makes sense. "to" must be a role that is never merged away. Return an empty list when only 2 roles speak.`,
    prompt: teachingGoal
      ? `Lesson topic from the teacher: "${topic}".
Teaching goal from the teacher (every step should serve it): "${teachingGoal}".
The items, situation and lines must follow this topic (the examples in the rules are only examples). Write the dialogue task now.`
      : `Lesson topic from the teacher: "${topic}".
The items, situation and lines must follow this topic (the examples in the rules are only examples). Write the dialogue task now.`,
  }
}
