import { describe, it, expect, vi, beforeEach } from 'vitest'

const generateContentMock = vi.fn()

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContent: generateContentMock },
  })),
}))

describe('generateHints', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.GEMINI_API_KEY = 'test-key'
    generateContentMock.mockReset()
  })

  it('parses the question field from the model JSON', async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({
        question: 'How much is this blue shirt?',
        complete: 'It is 200 dollars.',
        extend: 'Would you like to try it on?',
      }),
    })
    const { generateHints } = await import('./ai.js')
    const result = await generateHints('teacher long monologue ...')
    expect(result.question).toBe('How much is this blue shirt?')
    expect(result.complete).toBe('It is 200 dollars.')
    expect(result.extend).toBe('Would you like to try it on?')
  })

  it('defaults question to empty string when model returns non-JSON', async () => {
    generateContentMock.mockResolvedValue({ text: 'It is 200 dollars.' })
    const { generateHints } = await import('./ai.js')
    const result = await generateHints('teacher long monologue ...')
    expect(result.question).toBe('')
    expect(result.complete).toBe('It is 200 dollars.')
    expect(result.extend).toBe('')
  })
})
