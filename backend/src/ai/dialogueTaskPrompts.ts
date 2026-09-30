import type { CefrLevel, SceneContext } from '../lessonPlanTypes.js'
import { LEVEL_GUIDE, describeScene } from './lessonPlanPrompts.js'

/** AI 生成的任務固定為 5 分鐘微教案（前端 modal 顯示同一數值，不可更改） */
export const DIALOGUE_TASK_DURATION_MIN = 5

/** 5 分鐘內能讓學生讀完並角色扮演一輪的份量 */
export const STEP_RANGE = { min: 3, max: 5 }
export const LINES_PER_STEP_RANGE = { min: 2, max: 4 }

const STR = { type: 'STRING' }
const STR_ARRAY = { type: 'ARRAY', items: STR }

/** 輸出結構與任務編輯器 / taskTemplates 的 DialogueTask 相同（id 由後端補上）；speaker 限定為場景角色 id */
export function buildDialogueTaskSchema(slotIds: string[]): Record<string, unknown> {
  return {
    type: 'OBJECT',
    properties: {
      title: STR,
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
                properties: { speaker: { type: 'STRING', enum: slotIds }, en: STR, zh: STR },
                required: ['speaker', 'en', 'zh'],
              },
            },
            grammarPoints: STR_ARRAY,
            grammarNote: STR,
            teachingNotes: STR_ARRAY,
          },
          required: ['title', 'purpose', 'lines', 'grammarPoints', 'grammarNote', 'teachingNotes'],
        },
      },
    },
    required: ['title', 'steps'],
  }
}

export function buildDialogueTaskPrompt(
  topic: string, level: CefrLevel, ctx: SceneContext, teachingGoal?: string,
): { systemInstruction: string; prompt: string } {
  const roles = ctx.slots.map(s => `"${s.id}" = ${s.label}`).join(', ')
  return {
    systemInstruction: `You are an experienced English conversation teacher in Taiwan writing a role-play dialogue task for a ${DIALOGUE_TASK_DURATION_MIN}-minute micro-lesson in a mixed-reality classroom, where students speak as avatars in a 3D scene.
Student level: ${LEVEL_GUIDE[level]}
${describeScene(ctx)}

The task is a dialogue flow split into steps (for example: greeting → asking → deciding → paying → goodbye). Students read and act out the whole flow, so it MUST fit in ${DIALOGUE_TASK_DURATION_MIN} minutes.

Rules:
- ${STEP_RANGE.min} to ${STEP_RANGE.max} steps, each with ${LINES_PER_STEP_RANGE.min} to ${LINES_PER_STEP_RANGE.max} lines. The whole dialogue must be one natural, continuous conversation from the first step to the last.
- "speaker" must be one of these role ids: ${roles}. Roles should take turns naturally; do not invent other speakers.
- "en": one short English line for that speaker, matching the student level. Keep vocabulary and grammar strictly within the level.
- "zh": a natural Traditional Chinese (Taiwan) translation of "en".
- "title" (task) and step "title": short Traditional Chinese names, e.g. 服飾店購物 / 招呼 / 報價.
- "purpose": a 2-6 character Traditional Chinese tag describing the communicative goal of the step, e.g. 問候引導, 價格查詢, 確認購買.
- "grammarPoints": 1 to 3 key sentence patterns used in the step, written in English with placeholders in Chinese where helpful, e.g. "How much is + 單數物品?".
- "grammarNote": one or two Traditional Chinese sentences explaining the grammar for the teacher.
- "teachingNotes": 1 to 3 short, practical Traditional Chinese tips for the teacher (pronunciation, substitution drills, gestures).`,
    prompt: teachingGoal
      ? `Lesson topic from the teacher: "${topic}".
Teaching goal from the teacher (every step should serve it): "${teachingGoal}".
Write the dialogue task now.`
      : `Lesson topic from the teacher: "${topic}". Write the dialogue task now.`,
  }
}
