import { describe, it, expect, vi } from 'vitest'
import type { GeminiCallOptions, GeminiCallResult } from './client.js'
import type { GeminiCaller } from './lessonPlan.js'
import type { SceneContext, TaskHint } from '../lessonPlanTypes.js'

const ctx: SceneContext = {
  sceneId: 'clothingStore_cashier', themeLabel: '服飾店', sceneLabel: '收銀台', sceneLabelEn: 'Cashier',
  slots: [{ id: 'cashier', label: '收銀員' }, { id: 'customer', label: '顧客' }],
  existingModuleLabels: ['Price'],
  exampleTasks: [{ label: 'Ask for the price of a blue T-shirt.', hint: {
    keyStructure: 'What + is + the price of + the + [color] + [item]?',
    partialSentence: 'What is the _____ of the _____ _____?',
    unscramble: ['What', 'the', 'T-shirt?', 'price', 'of', 'is', 'the', 'blue'],
    completeSentence: 'What is the price of the blue T-shirt?',
    extraPhrases: ['How much is the blue T-shirt?'],
  } }],
}

const outline = {
  title: '退換貨', objectives: ['能提出退貨'],
  timeline: [{ phase: '暖身', minutes: 5, activity: '問候' }, { phase: '練習', minutes: 10, activity: '角色扮演' }],
  modules: [{ label: 'Return', icon: '🔁', taskLabels: ['Ask to return a T-shirt.', 'Ask for a refund.'] }],
  sceneConstraint: 'Setting: returns.',
}

function goodHint(label: string, sentence: string) {
  const words = sentence.split(' ')
  return { label, keyStructure: 'K', partialSentence: 'P', unscramble: [...words].reverse(), completeSentence: sentence, extraPhrases: ['E'] }
}

/** 依 tag 回假資料的 caller；可用 overrides 改單一 tag 的行為 */
function fakeCaller(overrides: Partial<Record<string, (opts: GeminiCallOptions<unknown>) => unknown>> = {}) {
  const calls: GeminiCallOptions<unknown>[] = []
  const defaults: Record<string, (opts: GeminiCallOptions<unknown>) => unknown> = {
    '[ai/lesson/outline]': () => outline,
    '[ai/lesson/script]': () => ({ teacherScript: 'Hello class. ' + 'word '.repeat(600) }),
    '[ai/lesson/hints]': () => ({ tasks: [
      goodHint('Ask to return a T-shirt.', 'I would like to return this T-shirt.'),
      goodHint('Ask for a refund.', 'Can I get a refund?'),
    ] }),
    '[ai/lesson/notes]': () => ({ grammarNotes: [{ point: 'would like to', explanation: '禮貌', examples: ['x'] }], teachingNotes: ['慢慢說'] }),
  }
  const call = vi.fn(async <T,>(opts: GeminiCallOptions<T>): Promise<GeminiCallResult<T>> => {
    calls.push(opts as GeminiCallOptions<unknown>)
    const fn = overrides[opts.tag] ?? defaults[opts.tag]
    if (!fn) throw new Error('unexpected tag ' + opts.tag)
    // 走真實 parse，確保 schema 驗證邏輯也被測到
    const data = opts.parse(JSON.stringify(fn(opts as GeminiCallOptions<unknown>)))
    return { data, model: 'fake', usage: { prompt: 1, output: 1, total: 2 } }
  })
  // vi.fn() 包住 generic function 會把 T 坍縮成 unknown；cast 回 GeminiCaller 只是恢復型別，行為不變。
  return { call: call as unknown as GeminiCaller, calls }
}

const req = { sceneId: 'clothingStore_cashier', topic: '退換貨', level: 'A2' as const, sceneContext: ctx }

describe('generateLessonPlan', () => {
  it('assembles a full plan with prefixed ids', async () => {
    const { generateLessonPlan } = await import('./lessonPlan.js')
    const { call, calls } = fakeCaller()
    const plan = await generateLessonPlan(req, 'p1', { call })
    expect(plan.title).toBe('退換貨')
    expect(plan.level).toBe('A2')
    expect(plan.durationMin).toBe(15)
    expect(plan.sceneId).toBe('clothingStore_cashier')
    expect(plan.timeline).toHaveLength(2)
    expect(plan.timeline[0].teacherScript.startsWith('Hello class.')).toBe(true)
    expect(plan.modules[0].id).toBe('plan_p1_m1')
    expect(plan.modules[0].tasks.map(t => t.id)).toEqual(['plan_p1_1', 'plan_p1_2'])
    expect(plan.modules[0].tasks[1].hint.completeSentence).toBe('Can I get a refund?')
    expect(plan.grammarNotes[0].point).toBe('would like to')
    expect(plan.sceneConstraint).toBe('Setting: returns.')
    const tags = calls.map(c => c.tag)
    expect(tags.filter(t => t === '[ai/lesson/outline]')).toHaveLength(1)
    expect(tags.filter(t => t === '[ai/lesson/script]')).toHaveLength(2)
    expect(tags.filter(t => t === '[ai/lesson/hints]')).toHaveLength(1)
    expect(tags.filter(t => t === '[ai/lesson/notes]')).toHaveLength(1)
  })

  it('retries the outline once when minutes do not sum to 15, then throws', async () => {
    const { generateLessonPlan } = await import('./lessonPlan.js')
    const bad = { ...outline, timeline: [{ phase: 'a', minutes: 5, activity: 'x' }] }
    const { call, calls } = fakeCaller({ '[ai/lesson/outline]': () => bad })
    await expect(generateLessonPlan(req, 'p1', { call })).rejects.toThrow(/15/)
    expect(calls.filter(c => c.tag === '[ai/lesson/outline]')).toHaveLength(2)
  })

  it('accepts the outline on the second attempt', async () => {
    const { generateLessonPlan } = await import('./lessonPlan.js')
    let n = 0
    const { call } = fakeCaller({ '[ai/lesson/outline]': () => (n++ === 0 ? { ...outline, timeline: [] } : outline) })
    const plan = await generateLessonPlan(req, 'p1', { call })
    expect(plan.timeline).toHaveLength(2)
  })

  it('retries a module once on unscramble mismatch, then repairs from completeSentence', async () => {
    const { generateLessonPlan } = await import('./lessonPlan.js')
    const broken = { tasks: [
      { ...goodHint('Ask to return a T-shirt.', 'I would like to return this T-shirt.'), unscramble: ['wrong', 'words'] },
      goodHint('Ask for a refund.', 'Can I get a refund?'),
    ] }
    const { call, calls } = fakeCaller({ '[ai/lesson/hints]': () => broken })
    const plan = await generateLessonPlan(req, 'p1', { call })
    expect(calls.filter(c => c.tag === '[ai/lesson/hints]')).toHaveLength(2)
    const repaired = plan.modules[0].tasks[0].hint.unscramble
    expect([...repaired].sort()).toEqual('I would like to return this T-shirt.'.split(' ').sort())
  })

  it('fails the whole generation when a script call throws', async () => {
    const { generateLessonPlan } = await import('./lessonPlan.js')
    const { call } = fakeCaller({ '[ai/lesson/script]': () => { throw new Error('503 boom') } })
    await expect(generateLessonPlan(req, 'p1', { call })).rejects.toThrow('503 boom')
  })

  it('throws when a module returns fewer tasks than labels', async () => {
    const { generateLessonPlan } = await import('./lessonPlan.js')
    const { call } = fakeCaller({ '[ai/lesson/hints]': () => ({ tasks: [goodHint('Ask for a refund.', 'Can I get a refund?')] }) })
    await expect(generateLessonPlan(req, 'p1', { call })).rejects.toThrow(/task count/)
  })
})

describe('helpers', () => {
  it('unscrambleMatches compares token multisets', async () => {
    const { unscrambleMatches } = await import('./lessonPlan.js')
    const base: TaskHint = { keyStructure: '', partialSentence: '', unscramble: ['b', 'a', 'a'], completeSentence: 'a a b', extraPhrases: [] }
    expect(unscrambleMatches(base)).toBe(true)
    expect(unscrambleMatches({ ...base, unscramble: ['a', 'b'] })).toBe(false)
  })

  it('repairUnscramble keeps all tokens', async () => {
    const { repairUnscramble } = await import('./lessonPlan.js')
    expect([...repairUnscramble('Can I get a refund?')].sort()).toEqual(['Can', 'I', 'a', 'get', 'refund?'])
  })

  it('validateOutline rejects missing modules', async () => {
    const { validateOutline } = await import('./lessonPlan.js')
    expect(() => validateOutline({ ...outline, modules: [] })).toThrow(/module/)
  })
})
