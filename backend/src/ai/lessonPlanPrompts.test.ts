import { describe, it, expect } from 'vitest'
import { buildOutlinePrompt, LEVEL_GUIDE } from './lessonPlanPrompts.js'
import { CEFR_LEVELS } from '../lessonPlanTypes.js'

const ctx = {
  sceneId: 'clothingStore_cashier', themeLabel: '服飾店', sceneLabel: '收銀台', sceneLabelEn: 'Cashier',
  slots: [{ id: 'cashier', label: '收銀員' }], existingModuleLabels: [], exampleTasks: [],
}

describe('buildOutlinePrompt', () => {
  it('every level has a guide', () => {
    for (const level of CEFR_LEVELS) expect(LEVEL_GUIDE[level]).toMatch(/CEFR/)
  })

  it('includes the teaching goal only when given', () => {
    expect(buildOutlinePrompt('退換貨', 'A1', ctx).prompt).not.toContain('Teaching goal')
    const { prompt, systemInstruction } = buildOutlinePrompt('退換貨', 'A2-B1', ctx, '能說明退貨原因')
    expect(prompt).toContain('Teaching goal from the teacher')
    expect(prompt).toContain('能說明退貨原因')
    expect(systemInstruction).toContain(LEVEL_GUIDE['A2-B1'])
  })
})
