import { describe, it, expect } from 'vitest'
import { buildSceneContext } from './sceneContext'

describe('buildSceneContext', () => {
  it('returns null for an unknown scene', () => {
    expect(buildSceneContext('nope')).toBeNull()
  })

  it('collects theme, scene, slots, module labels and hinted example tasks for the cashier scene', () => {
    const ctx = buildSceneContext('clothingStore_cashier')!
    expect(ctx.sceneId).toBe('clothingStore_cashier')
    expect(ctx.themeLabel).toBe('服飾店')
    expect(ctx.sceneLabel).toBe('收銀台')
    expect(ctx.sceneLabelEn).toBe('Cashier')
    expect(ctx.slots.map(s => s.id)).toEqual(['cashier', 'customer'])
    expect(ctx.existingModuleLabels).toContain('Price')
    expect(ctx.exampleTasks.length).toBeGreaterThan(0)
    expect(ctx.exampleTasks.length).toBeLessThanOrEqual(3)
    expect(ctx.exampleTasks[0].label).toBe('Ask for the price of a blue T-shirt.')
    expect(ctx.exampleTasks[0].hint.completeSentence).toBe('What is the price of the blue T-shirt?')
  })
})
