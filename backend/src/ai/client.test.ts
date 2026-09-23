import { describe, it, expect, vi, beforeEach } from 'vitest'

const generateContentMock = vi.fn()

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContent: generateContentMock },
  })),
}))

describe('callGemini', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.GEMINI_API_KEY = 'test-key'
    process.env.GEMINI_MODEL = 'gemini-2.5-flash,gemini-2.0-flash-lite'
    generateContentMock.mockReset()
  })

  const base = { tag: '[test]', contents: 'hi', temperature: 0.5, maxOutputTokens: 100, thinkingBudget: 256 }

  it('returns parsed data, model and usage', async () => {
    generateContentMock.mockResolvedValue({
      text: '{"a":1}',
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 },
    })
    const { callGemini } = await import('./client.js')
    const res = await callGemini({ ...base, parse: t => JSON.parse(t) as { a: number } })
    expect(res.data).toEqual({ a: 1 })
    expect(res.model).toBe('gemini-2.5-flash')
    expect(res.usage).toEqual({ prompt: 3, output: 4, total: 7 })
  })

  it('falls back to the next model on a retryable error', async () => {
    generateContentMock
      .mockRejectedValueOnce(new Error('503 Service Unavailable'))
      .mockResolvedValueOnce({ text: 'ok' })
    const { callGemini } = await import('./client.js')
    const res = await callGemini({ ...base, parse: t => t })
    expect(res.data).toBe('ok')
    expect(res.model).toBe('gemini-2.0-flash-lite')
    expect(generateContentMock).toHaveBeenCalledTimes(2)
  })

  it('throws immediately on a non-retryable error', async () => {
    generateContentMock.mockRejectedValue(new Error('400 API key not valid'))
    const { callGemini } = await import('./client.js')
    await expect(callGemini({ ...base, parse: t => t })).rejects.toThrow('API key not valid')
    expect(generateContentMock).toHaveBeenCalledTimes(1)
  })

  it('treats a parse failure as a model failure and tries the next model', async () => {
    generateContentMock
      .mockResolvedValueOnce({ text: 'not json' })
      .mockResolvedValueOnce({ text: '{"ok":true}' })
    const { callGemini } = await import('./client.js')
    const res = await callGemini({ ...base, parse: t => JSON.parse(t) as { ok: boolean } })
    expect(res.data).toEqual({ ok: true })
    expect(res.model).toBe('gemini-2.0-flash-lite')
  })

  it('throws GeminiParseError when every model fails to parse', async () => {
    generateContentMock.mockResolvedValue({ text: 'garbage' })
    const { callGemini, GeminiParseError } = await import('./client.js')
    await expect(callGemini({ ...base, parse: t => JSON.parse(t) })).rejects.toBeInstanceOf(GeminiParseError)
  })

  it('throws on empty response without trying the next model', async () => {
    generateContentMock.mockResolvedValue({ text: '' })
    const { callGemini } = await import('./client.js')
    await expect(callGemini({ ...base, parse: t => t })).rejects.toThrow('Empty response')
    expect(generateContentMock).toHaveBeenCalledTimes(1)
  })

  it('sets JSON mime type and schema when responseSchema is given', async () => {
    generateContentMock.mockResolvedValue({ text: '{}' })
    const { callGemini } = await import('./client.js')
    const schema = { type: 'OBJECT', properties: {} }
    await callGemini({ ...base, responseSchema: schema, parse: t => JSON.parse(t) })
    const config = generateContentMock.mock.calls[0][0].config
    expect(config.responseMimeType).toBe('application/json')
    expect(config.responseSchema).toBe(schema)
    expect(config.systemInstruction).toBeUndefined()
  })

  it('omits thinkingConfig for 2.0 models', async () => {
    generateContentMock
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValueOnce({ text: 'x' })
    const { callGemini } = await import('./client.js')
    await callGemini({ ...base, parse: t => t })
    expect(generateContentMock.mock.calls[0][0].config.thinkingConfig).toEqual({ thinkingBudget: 256 })
    expect(generateContentMock.mock.calls[1][0].config.thinkingConfig).toBeUndefined()
  })

  it('raises thinkingBudget to 512 for 2.5 flash-lite', async () => {
    process.env.GEMINI_MODEL = 'gemini-2.5-flash,gemini-2.5-flash-lite'
    generateContentMock
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValueOnce({ text: 'x' })
    const { callGemini, thinkingBudgetFor } = await import('./client.js')
    await callGemini({ ...base, parse: t => t })
    expect(generateContentMock.mock.calls[0][0].config.thinkingConfig).toEqual({ thinkingBudget: 256 })
    expect(generateContentMock.mock.calls[1][0].config.thinkingConfig).toEqual({ thinkingBudget: 512 })
    expect(thinkingBudgetFor('gemini-2.5-flash-lite', 0)).toBe(0)
    expect(thinkingBudgetFor('gemini-2.5-flash-lite', 1024)).toBe(1024)
  })

  it('never sends thinkingBudget 0 to models that cannot disable thinking', async () => {
    const { thinkingBudgetFor } = await import('./client.js')
    // -latest 別名指向 3.x，thinkingBudget 0 會回 400 INVALID_ARGUMENT
    expect(thinkingBudgetFor('gemini-flash-lite-latest', 0)).toBeUndefined()
    expect(thinkingBudgetFor('gemini-flash-latest', 256)).toBe(256)
    expect(thinkingBudgetFor('gemini-2.5-pro', 0)).toBe(128)
    expect(thinkingBudgetFor('gemini-2.5-flash', 0)).toBe(0)
  })

  it('falls back to the next model when a model is retired (404)', async () => {
    generateContentMock
      .mockRejectedValueOnce(new Error('{"error":{"code":404,"message":"This model is no longer available.","status":"NOT_FOUND"}}'))
      .mockResolvedValueOnce({ text: 'ok' })
    const { callGemini } = await import('./client.js')
    const res = await callGemini({ ...base, parse: t => t })
    expect(res.model).toBe('gemini-2.0-flash-lite')
  })

  it('throws when GEMINI_API_KEY is missing', async () => {
    delete process.env.GEMINI_API_KEY
    const { callGemini } = await import('./client.js')
    await expect(callGemini({ ...base, parse: t => t })).rejects.toThrow('GEMINI_API_KEY')
  })
})
