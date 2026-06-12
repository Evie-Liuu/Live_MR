import { describe, it, expect } from 'vitest'
import { buildHintsSystemInstruction } from './aiAssistant'

describe('buildHintsSystemInstruction', () => {
  const constraint = 'Setting: A clothing store checkout.'

  it('instructs the model to extract the single student-directed question', () => {
    const out = buildHintsSystemInstruction(constraint)
    expect(out).toContain(constraint)
    // 過濾長獨白、鎖定單一針對學生的提問
    expect(out.toLowerCase()).toContain('monologue')
    expect(out.toLowerCase()).toContain('question')
  })

  it('asks for a JSON object with question, complete and extend fields', () => {
    const out = buildHintsSystemInstruction(constraint)
    expect(out).toContain('"question"')
    expect(out).toContain('"complete"')
    expect(out).toContain('"extend"')
  })
})
