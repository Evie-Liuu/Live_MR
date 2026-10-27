import { describe, it, expect, vi } from 'vitest'
import type { GeminiCallOptions, GeminiCallResult } from './client.js'
import type { GeminiCaller } from './lessonPlan.js'
import type { SceneContext } from '../lessonPlanTypes.js'
import { castOptionsFromMerges, generateDialogueTask, validateDialogueDraft } from './dialogueTask.js'
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

describe('topic tags', () => {
  it('keeps cleaned tags from the draft (strip #, dedupe, max 5)', async () => {
    const tags = ['#購物', '詢價', '購物', '結帳', '', 'x'.repeat(30), '付款', '找零', '道別']
    const { call } = fakeCaller([{ ...goodDraft, tags }])
    const task = await generateDialogueTask(req, { call })
    expect(task.tags).toEqual(['購物', '詢價', '結帳', '付款', '找零'])
  })

  it('omits tags when the model returns none, without retrying', async () => {
    const { call, calls } = fakeCaller([{ ...goodDraft, tags: [] }])
    const task = await generateDialogueTask(req, { call })
    expect(calls).toHaveLength(1)
    expect(task).not.toHaveProperty('tags')
  })

  it('asks for topic tags in the prompt', () => {
    expect(buildDialogueTaskPrompt('購物', 'A1', ctx).systemInstruction).toContain('"tags"')
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
    expect(schema.required).toEqual(['title', 'tags', 'steps', 'castMerges'])
    expect(schema.properties.steps.items.required).toEqual(['title', 'purpose', 'lines', 'grammarPoints', 'grammarNote', 'teachingNotes', 'checkpoints'])
    const line = (schema as unknown as { properties: { steps: { items: { properties: { lines: { items: { required: string[]; properties: { gesture: { enum: string[] } } } } } } } } })
      .properties.steps.items.properties.lines.items
    expect(line.required).toContain('gesture')
    expect(line.properties.gesture.enum).toEqual(['wave', 'nod', 'bow', 'point', 'handOver', 'thumbsUp', 'happy', 'none'])
  })
})

describe('台下互動題', () => {
  const cps = [
    { kind: 'choice', title: '顏色理解', question: 'Which color does {customer} want?', options: ['Red', 'Blue', 'Yellow'], answerIndex: 1, followUp: '' },
    { kind: 'truefalse', title: '是非判斷', question: '{cashier} is happy.', options: ['Yes', 'No', 'Maybe'], answerIndex: 0, followUp: 'Why?' },
    { kind: 'choice', title: '壞題', question: 'Who?', options: ['A', 'A', 'B'], answerIndex: 0 },
    { kind: 'choice', title: '未知角色', question: 'What does {robot} say?', options: ['Hi', 'Bye'], answerIndex: 0 },
    { kind: 'choice', title: '答案超出', question: 'What?', options: ['Hi', 'Bye'], answerIndex: 2 },
  ]

  it('keeps valid checkpoints with ids, forces True/False and drops bad ones', async () => {
    const { call, calls } = fakeCaller([{ ...goodDraft, steps: [{ ...step('招呼'), checkpoints: cps }, step('報價'), step('結帳')] }])
    const task = await generateDialogueTask(req, { call })
    expect(calls).toHaveLength(1)
    expect(task.steps[0].checkpoints).toEqual([
      { id: 'ai_s1_cp1', title: '顏色理解', question: 'Which color does {customer} want?', options: ['Red', 'Blue', 'Yellow'], answerIndex: 1 },
      { id: 'ai_s1_cp2', kind: 'truefalse', title: '是非判斷', question: '{cashier} is happy.', options: ['True', 'False'], answerIndex: 0, followUp: 'Why?' },
    ])
    expect(task.steps[1]).not.toHaveProperty('checkpoints')
  })

  it('asks for checkpoints with role tokens in the prompt', () => {
    const { systemInstruction } = buildDialogueTaskPrompt('購物', 'A1', ctx)
    expect(systemInstruction).toContain('"checkpoints"')
    expect(systemInstruction).toContain('{customer}')
  })
})

describe('角色扮演人數', () => {
  const ctx4: SceneContext = {
    ...ctx,
    slots: [{ id: 'cashier', label: '店員A' }, { id: 'customer', label: '顧客A' }, { id: 'staff', label: '店員B' }, { id: 'customer2', label: '顧客B' }],
  }
  const four = ['cashier', 'customer', 'staff', 'customer2']
  const step4 = (title: string) => ({
    ...step(title),
    lines: four.map((speaker, i) => ({ speaker, en: `Line ${i + 1}.`, zh: `第 ${i + 1} 句。` })),
  })
  const draft4 = { title: '結伴購物', steps: [step4('a'), step4('b'), step4('c')] }

  it('retries when the draft does not use exactly the requested number of roles', async () => {
    const { call, calls } = fakeCaller([goodDraft, draft4])
    const task = await generateDialogueTask({ ...req, sceneContext: ctx4, castSize: 4 }, { call })
    expect(calls).toHaveLength(2)
    expect(task.steps).toHaveLength(3)
    expect(String(calls[0].systemInstruction)).toContain('EXACTLY 4 speaking roles')
  })

  it('turns ordered merges into cast options and notes them for the teacher', async () => {
    const castMerges = [{ from: 'staff', to: 'cashier' }, { from: 'customer2', to: 'customer' }]
    const { call } = fakeCaller([{ ...draft4, castMerges }])
    const task = await generateDialogueTask({ ...req, sceneContext: ctx4 }, { call })
    expect(task.castOptions).toEqual([
      { merge: { staff: 'cashier' } },
      { merge: { staff: 'cashier', customer2: 'customer' } },
    ])
    expect(task.steps[0].teachingNotes.at(-1)).toBe('可 2–4 人演出（角色配置切換演出人數）：3 人時店員B的台詞由店員A說；2 人時顧客B的台詞由顧客A說。')
  })

  it('stops at the first invalid merge', () => {
    expect(castOptionsFromMerges([{ from: 'staff', to: 'cashier' }, { from: 'cashier', to: 'customer' }], four))
      .toEqual([{ merge: { staff: 'cashier' } }])
    expect(castOptionsFromMerges([{ from: 'staff', to: 'staff' }], four)).toEqual([])
    expect(castOptionsFromMerges([{ from: 'robot', to: 'cashier' }], four)).toEqual([])
    // 只剩 2 人就不再併
    expect(castOptionsFromMerges([{ from: 'customer', to: 'cashier' }], ['cashier', 'customer'])).toEqual([])
  })

  it('allows more lines per step for larger casts', () => {
    const eight = { ...step4('a'), lines: [...step4('a').lines, ...step4('a').lines] }
    expect(() => validateDialogueDraft({ title: 'x', steps: [eight, eight, eight] }, four)).not.toThrow()
    expect(() => validateDialogueDraft({ title: 'x', steps: [eight, eight, eight] }, SLOTS)).toThrow('lines')
  })
})
