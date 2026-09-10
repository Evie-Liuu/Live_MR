import { GoogleGenAI } from '@google/genai'

const DEFAULT_MODELS = 'gemini-2.5-flash,gemini-2.5-flash-lite,gemini-2.0-flash-lite'
export const MODELS = (process.env.GEMINI_MODEL || DEFAULT_MODELS)
  .split(',')
  .map(m => m.trim())
  .filter(Boolean)
const DEFAULT_TIMEOUT_MS = 60_000

let client: GoogleGenAI | null = null

function getClient(): GoogleGenAI {
  if (client) return client
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')
  client = new GoogleGenAI({ apiKey })
  return client
}

export function isRetryable(err: unknown): boolean {
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

export interface TokenUsage {
  prompt: number
  output: number
  total: number
}

/** 模型回傳文字無法被 parse 成預期形狀；視為該模型失敗、換下一個模型。 */
export class GeminiParseError extends Error {
  constructor(model: string, cause: unknown) {
    super(`[${model}] response parse failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'GeminiParseError'
  }
}

export interface GeminiCallOptions<T> {
  /** log 前綴，例如 '[ai/hints]' */
  tag: string
  /** 純字串 prompt，或已是 @google/genai Content[] 形狀的多輪內容 */
  contents: unknown
  systemInstruction?: string
  temperature: number
  maxOutputTokens: number
  /** 只對 2.5 系列生效；2.0 系列傳 thinkingBudget 會報錯，一律送 0 */
  thinkingBudget: number
  /** 有給就強制 JSON 輸出 */
  responseSchema?: Record<string, unknown>
  signal?: AbortSignal
  timeoutMs?: number
  /** 把模型文字轉成結果；拋錯視為該模型失敗 */
  parse: (text: string) => T
}

export interface GeminiCallResult<T> {
  data: T
  model: string
  usage?: TokenUsage
}

export async function callGemini<T>(opts: GeminiCallOptions<T>): Promise<GeminiCallResult<T>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  opts.signal?.addEventListener('abort', () => controller.abort())
  try {
    let lastErr: unknown = new Error('No models configured')
    for (const model of MODELS) {
      try {
        const thinkingBudget = model.includes('2.5') ? opts.thinkingBudget : 0
        const config: Record<string, unknown> = {
          temperature: opts.temperature,
          maxOutputTokens: opts.maxOutputTokens,
          thinkingConfig: { thinkingBudget },
          abortSignal: controller.signal,
        }
        if (opts.responseSchema) {
          config.responseMimeType = 'application/json'
          config.responseSchema = opts.responseSchema
        }
        if (opts.systemInstruction) config.systemInstruction = opts.systemInstruction
        const res = await getClient().models.generateContent({
          model,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          contents: opts.contents as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          config: config as any,
        })
        const text = (res.text ?? '').trim()
        if (!text) throw new Error('Empty response')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const um = (res as any).usageMetadata
        const usage: TokenUsage | undefined = um
          ? { prompt: um.promptTokenCount ?? 0, output: um.candidatesTokenCount ?? 0, total: um.totalTokenCount ?? 0 }
          : undefined
        let data: T
        try {
          data = opts.parse(text)
        } catch (parseErr) {
          throw new GeminiParseError(model, parseErr)
        }
        if (usage) console.log(`${opts.tag} ${model} tokens prompt=${usage.prompt} output=${usage.output} total=${usage.total}`)
        return { data, model, usage }
      } catch (err) {
        lastErr = err
        const msg = err instanceof Error ? err.message : String(err)
        if (!isRetryable(err) && !(err instanceof GeminiParseError)) throw err
        console.warn(`${opts.tag} ${model} failed (${msg.slice(0, 120)}), trying next model`)
      }
    }
    throw lastErr
  } finally {
    clearTimeout(timer)
  }
}
