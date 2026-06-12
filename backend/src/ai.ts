import { GoogleGenAI } from '@google/genai'

const DEFAULT_MODELS = 'gemini-2.5-flash,gemini-2.5-flash-lite,gemini-2.0-flash-lite'
const MODELS = (process.env.GEMINI_MODEL || DEFAULT_MODELS)
  .split(',')
  .map(m => m.trim())
  .filter(Boolean)
const TIMEOUT_MS = 60_000

let client: GoogleGenAI | null = null

function getClient(): GoogleGenAI {
  if (client) return client
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')
  client = new GoogleGenAI({ apiKey })
  return client
}

function isRetryable(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    msg.includes('503') ||
    msg.includes('429') ||
    msg.includes('unavailable') ||
    msg.includes('overloaded') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota')
  )
}

export interface HintResult {
  text: string
  model: string
}

export interface ChatTurn {
  role: 'user' | 'model'
  text: string
}

export interface GenerateHintOptions {
  history?: ChatTurn[]
  systemInstruction?: string
  signal?: AbortSignal
}

export interface HintsResult {
  question: string
  complete: string
  extend: string
  model: string
}

export async function generateHints(
  prompt: string,
  opts: GenerateHintOptions = {},
): Promise<HintsResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  opts.signal?.addEventListener('abort', () => controller.abort())
  try {
    let lastErr: unknown = new Error('No models configured')
    const useMultiTurn = !!opts.history && opts.history.length > 0
    const contents: unknown = useMultiTurn
      ? [
          ...opts.history!.map(h => ({ role: h.role, parts: [{ text: h.text }] })),
          { role: 'user', parts: [{ text: prompt }] },
        ]
      : prompt

    for (const model of MODELS) {
      try {
        const config: Record<string, unknown> = {
          temperature: 0.6,
          maxOutputTokens: 256,
          thinkingConfig: { thinkingBudget: 0 },
          abortSignal: controller.signal,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              question: { type: 'STRING' },
              complete: { type: 'STRING' },
              extend: { type: 'STRING' },
            },
            required: ['question', 'complete', 'extend'],
          },
        }
        if (opts.systemInstruction) config.systemInstruction = opts.systemInstruction
        const res = await getClient().models.generateContent({
          model,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          contents: contents as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          config: config as any,
        })
        const raw = (res.text ?? '').trim()
        if (!raw) throw new Error('Empty response')
        let parsed: { question?: unknown; complete?: unknown; extend?: unknown }
        try { parsed = JSON.parse(raw) }
        catch { parsed = { question: '', complete: raw, extend: '' } } // fallback: 純文字視為 complete
        const question = typeof parsed.question === 'string' ? parsed.question.trim() : ''
        const complete = typeof parsed.complete === 'string' ? parsed.complete.trim() : ''
        const extend = typeof parsed.extend === 'string' ? parsed.extend.trim() : ''
        if (!complete) throw new Error('Empty complete field')
        return { question, complete, extend, model }
      } catch (err) {
        lastErr = err
        const msg = err instanceof Error ? err.message : String(err)
        if (!isRetryable(err)) throw err
        console.warn(`[ai/hints] ${model} failed (${msg.slice(0, 120)}), trying next model`)
      }
    }
    throw lastErr
  } finally {
    clearTimeout(timer)
  }
}

export async function generateHint(
  prompt: string,
  opts: GenerateHintOptions = {},
): Promise<HintResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  opts.signal?.addEventListener('abort', () => controller.abort())
  try {
    let lastErr: unknown = new Error('No models configured')

    // Build the request shape once: stateless string prompt OR multi-turn contents array.
    const useMultiTurn = !!opts.history && opts.history.length > 0
    const contents: unknown = useMultiTurn
      ? [
          ...opts.history!.map(h => ({ role: h.role, parts: [{ text: h.text }] })),
          { role: 'user', parts: [{ text: prompt }] },
        ]
      : prompt

    for (const model of MODELS) {
      try {
        // @google/genai v2.x: systemInstruction belongs inside config, alongside
        // temperature / maxOutputTokens etc. Putting it at the top level silently
        // no-ops the system prompt at runtime.
        const config: Record<string, unknown> = {
          temperature: 0.6,
          maxOutputTokens: 128,
          thinkingConfig: { thinkingBudget: 0 },
          abortSignal: controller.signal,
        }
        if (opts.systemInstruction) config.systemInstruction = opts.systemInstruction
        const res = await getClient().models.generateContent({
          model,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          contents: contents as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          config: config as any,
        })
        const text = (res.text ?? '').trim()
        if (!text) throw new Error('Empty response')
        return { text, model }
      } catch (err) {
        lastErr = err
        const msg = err instanceof Error ? err.message : String(err)
        if (!isRetryable(err)) throw err
        console.warn(`[ai/hint] ${model} failed (${msg.slice(0, 120)}), trying next model`)
      }
    }
    throw lastErr
  } finally {
    clearTimeout(timer)
  }
}
