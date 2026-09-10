import { describe, it, expect } from 'vitest'
import { resolveModules, resolveTaskHint, resolveSceneConstraint, PLAN_MODULE_PREFIX } from './content'
import type { LessonPlan } from '../types/lessonPlan'
import type { SceneModule } from '../types/vrm'

const hint = { keyStructure: 'k', partialSentence: 'p', unscramble: ['Hi.'], completeSentence: 'Hi.', extraPhrases: [] }
const plan: LessonPlan = {
  title: '退換貨', sceneId: 'clothingStore_cashier', topic: 't', level: 'A1', durationMin: 15,
  objectives: [], timeline: [], grammarNotes: [], teachingNotes: [],
  sceneConstraint: 'PLAN CONSTRAINT',
  modules: [{ id: 'plan_p_m1', label: 'Return', icon: '🔁', tasks: [{ id: 'plan_p_1', label: 'Ask.', hint }] }],
}
const staticModules: SceneModule[] = [{ id: 'ask_price', label: 'Price', icon: '💰', tasks: [{ id: 'ask_price_1', label: 'Ask for the price of a blue T-shirt.' }] }]

describe('resolveModules', () => {
  it('returns static modules unchanged without a plan', () => {
    expect(resolveModules(staticModules, null, 'clothingStore_cashier')).toBe(staticModules)
  })

  it('prepends plan modules (with prefix and task hints) when the scene matches', () => {
    const out = resolveModules(staticModules, plan, 'clothingStore_cashier')
    expect(out).toHaveLength(2)
    expect(out[0].id).toBe('plan_p_m1')
    expect(out[0].label).toBe(`${PLAN_MODULE_PREFIX}：Return`)
    expect(out[0].tasks[0].hint).toEqual(hint)
    expect(out[1]).toBe(staticModules[0])
  })

  it('ignores the plan when a different scene is selected', () => {
    expect(resolveModules(staticModules, plan, 'otherScene')).toBe(staticModules)
  })
})

describe('resolveTaskHint', () => {
  it('finds plan task hints first, then falls back to TASK_HINTS', () => {
    expect(resolveTaskHint('plan_p_1', plan)).toEqual(hint)
    expect(resolveTaskHint('ask_price_1', plan)?.completeSentence).toBe('What is the price of the blue T-shirt?')
    expect(resolveTaskHint('ask_price_1', null)?.completeSentence).toBe('What is the price of the blue T-shirt?')
    expect(resolveTaskHint('unknown', plan)).toBeUndefined()
  })
})

describe('resolveSceneConstraint', () => {
  it('uses the plan constraint only when the scene matches', () => {
    expect(resolveSceneConstraint('clothingStore_cashier', plan)).toBe('PLAN CONSTRAINT')
    expect(resolveSceneConstraint('clothingStore_cashier', null)).toContain('clothing store checkout')
    expect(resolveSceneConstraint('otherScene', plan)).toBeUndefined()
  })
})
