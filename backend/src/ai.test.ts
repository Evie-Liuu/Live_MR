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

  it('parses the transcript field when present', async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({
        transcript: 'So Angel, tell us about Wendy.',
        question: 'Tell us about Wendy.',
        complete: 'Wendy is my best friend.',
        extend: 'She likes reading.',
      }),
    })
    const { generateHints } = await import('./ai.js')
    const result = await generateHints('teacher ...')
    expect(result.transcript).toBe('So Angel, tell us about Wendy.')
  })

  it('defaults transcript to empty string when absent', async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({ question: 'q', complete: 'c', extend: 'e' }),
    })
    const { generateHints } = await import('./ai.js')
    const result = await generateHints('teacher ...')
    expect(result.transcript).toBe('')
  })

  it('sends audio as an inlineData part when audio option is provided', async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({ transcript: 't', question: 'q', complete: 'c', extend: 'e' }),
    })
    const { generateHints } = await import('./ai.js')
    await generateHints('', { audio: { data: 'QUJD', mimeType: 'audio/ogg' } })
    const call = generateContentMock.mock.calls[0][0]
    const parts = call.contents[call.contents.length - 1].parts
    expect(parts[0].inlineData).toEqual({ mimeType: 'audio/ogg', data: 'QUJD' })
  })
})
