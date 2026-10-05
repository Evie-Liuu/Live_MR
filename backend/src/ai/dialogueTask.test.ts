import { describe, it, expect, vi } from 'vitest'
import type { GeminiCallOptions, GeminiCallResult } from './client.js'
import type { GeminiCaller } from './lessonPlan.js'
import type { SceneContext } from '../lessonPlanTypes.js'
import { generateDialogueTask, validateDialogueDraft } from './dialogueTask.js'
import { DIALOGUE_TASK_DURATION_MIN, buildDialogueTaskPrompt, buildDialogueTaskSchema } from './dialogueTaskPrompts.js'

const ctx: SceneContext = {
  sceneId: 'clothingStore_cashier', themeLabel: '服飾店', sceneLabel: '收銀台', sceneLabelEn: 'Cashier',
  slots: [{ id: 'cashier', label: '收銀員' }, { id: 'customer', label: '顧客' }],
  existingModuleLabels: [], exampleTasks: [],
}
const SLOTS = ['cashier', 'customer']

function step(title: string, n = 2) {
  return {
    title, purpose: '問候引導',
    lines: Array.from({ length: n }, (_, i) => ({ speaker: SLOTS[i % 2], en: `Line ${i + 1}.`, zh: `第 ${i + 1} 句。` })),
    grammarPoints: ['Hello!'], grammarNote: '開場用語。', teachingNotes: ['注意語調。'],
  }
}
const goodDraft = { title: '服飾店購物', steps: [step('招呼'), step('報價', 3), step('結帳')] }

function fakeCaller(responses: unknown[]) {
  const calls: GeminiCallOptions<unknown>[] = []
  const call = vi.fn(async <T,>(opts: GeminiCallOptions<T>): Promise<GeminiCallResult<T>> => {
    calls.push(opts as GeminiCallOptions<unknown>)
    const next = responses.shift()
    return { data: opts.parse(JSON.stringify(next)), model: 'fake' }
  })
  return { call: call as unknown as GeminiCaller, calls }
}

const req = { topic: '購物', level: 'A1' as const, sceneContext: ctx }

describe('generateDialogueTask', () => {
  it('returns a task in editor format with ids, scene and level', async () => {
    const { call, calls } = fakeCaller([goodDraft])
    const task = await generateDialogueTask(req, { call })
    expect(calls).toHaveLength(1)
    expect(task.sceneId).toBe('clothingStore_cashier')
    expect(task.level).toBe('A1')
    expect(task.steps.map(s => s.id)).toEqual(['ai_s1', 'ai_s2', 'ai_s3'])
    expect(task.steps[1].lines[2]).toEqual({ id: 'ai_s2_l3', speakerSlotId: 'cashier', en: 'Line 3.', zh: '第 3 句。' })
    expect(task.steps[0].grammarNote).toBe('開場用語。')
  })

  it('keeps valid gestures and drops none / unknown ones', async () => {
    const draft = {
      ...goodDraft,
      steps: [
        { ...step('招呼'), lines: [
          { speaker: 'cashier', en: 'Hi.', zh: '嗨。', gesture: 'wave' },
          { speaker: 'customer', en: 'Hello.', zh: '哈囉。', gesture: 'none' },
          { speaker: 'cashier', en: 'Welcome.', zh: '歡迎。', gesture: 'dance' },
        ] },
        step('報價'), step('結帳'),
      ],
    }
    const { call } = fakeCaller([draft])
    const task = await generateDialogueTask(req, { call })
    expect(task.steps[0].lines.map(l => l.gesture)).toEqual(['wave', undefined, undefined])
    expect(task.steps[0].lines[1]).not.toHaveProperty('gesture')
  })

  it('retries once when the draft is invalid, then succeeds', async () => {
    const { call, calls } = fakeCaller([{ title: 'x', steps: [step('only one')] }, goodDraft])
    const task = await generateDialogueTask(req, { call })
    expect(calls).toHaveLength(2)
    expect(task.steps).toHaveLength(3)
  })

  it('fails after the retry is also invalid', async () => {
    const bad = { title: 'x', steps: [step('a'), step('b'), { ...step('c'), lines: [{ speaker: 'robot', en: 'Hi.', zh: '嗨。' }, { speaker: 'cashier', en: 'Hi.', zh: '嗨。' }] }] }
    const { call } = fakeCaller([bad, bad])
    await expect(generateDialogueTask(req, { call })).rejects.toThrow('unknown speaker')
  })

  it('sends the teaching goal and restricts speakers in the schema', async () => {
    const { call, calls } = fakeCaller([goodDraft])
    await generateDialogueTask({ ...req, teachingGoal: '能詢問價格' }, { call })
    expect(String(calls[0].contents)).toContain('能詢問價格')
    const schema = calls[0].responseSchema as { properties: { steps: { items: { properties: { lines: { items: { properties: { speaker: { enum: string[] } } } } } } } } }
    expect(schema.properties.steps.items.properties.lines.items.properties.speaker.enum).toEqual(SLOTS)
  })
})

describe('validateDialogueDraft', () => {
  it('trims text and drops blank list items', () => {
    const draft = validateDialogueDraft({
      title: '  購物 ', steps: [
        { ...step('招呼'), grammarPoints: ['  A  ', '', 3], teachingNotes: [] },
        step('報價'), step('結帳'),
      ],
    }, SLOTS)
    expect(draft.title).toBe('購物')
    expect(draft.steps[0].grammarPoints).toEqual(['A'])
  })

  it('rejects too few steps and empty lines', () => {
    expect(() => validateDialogueDraft({ title: 'x', steps: [step('a'), step('b')] }, SLOTS)).toThrow('steps')
    expect(() => validateDialogueDraft({ title: 'x', steps: [step('a'), step('b'), step('c', 1)] }, SLOTS)).toThrow('lines')
    const blank = { ...step('c'), lines: [{ speaker: 'cashier', en: ' ', zh: '嗨' }, { speaker: 'customer', en: 'Hi', zh: '嗨' }] }
    expect(() => validateDialogueDraft({ title: 'x', steps: [step('a'), step('b'), blank] }, SLOTS)).toThrow('text missing')
  })
})

describe('buildDialogueTaskPrompt', () => {
  it('states the fixed duration, roles and level', () => {
    const { systemInstruction, prompt } = buildDialogueTaskPrompt('購物', 'A2-B1', ctx)
    expect(systemInstruction).toContain(`${DIALOGUE_TASK_DURATION_MIN}-minute`)
    expect(systemInstruction).toContain('"cashier" = 收銀員')
    expect(systemInstruction).toContain('A2 to B1')
    expect(prompt).not.toContain('Teaching goal')
  })

  it('schema requires every field the editor needs', () => {
    const schema = buildDialogueTaskSchema(SLOTS) as { required: string[]; properties: { steps: { items: { required: string[] } } } }
    expect(schema.required).toEqual(['title', 'steps'])
    expect(schema.properties.steps.items.required).toEqual(['title', 'purpose', 'lines', 'grammarPoints', 'grammarNote', 'teachingNotes'])
    const line = (schema as unknown as { properties: { steps: { items: { properties: { lines: { items: { required: string[]; properties: { gesture: { enum: string[] } } } } } } } } })
      .properties.steps.items.properties.lines.items
    expect(line.required).toContain('gesture')
    expect(line.properties.gesture.enum).toEqual(['wave', 'nod', 'bow', 'point', 'handOver', 'thumbsUp', 'happy', 'none'])
  })
})
