import { GoogleGenAI } from '@google/genai'

const DEFAULT_MODELS = 'gemini-2.5-flash,gemini-2.5-flash-lite,gemini-flash-lite-latest'
export const MODELS = (process.env.GEMINI_MODEL || DEFAULT_MODELS)
  .split(',')
  .map(m => m.trim())
  .filter(Boolean)
const DEFAULT_TIMEOUT_MS = 60_000
/** 2.5 Flash-Lite 的 thinkingBudget 只接受 0（關閉）或 512–24576，小於 512 會回 400 INVALID_ARGUMENT */
const FLASH_LITE_MIN_THINKING_BUDGET = 512
/** 2.5 Pro 不能關閉推理，thinkingBudget 下限 128 */
const PRO_MIN_THINKING_BUDGET = 128

/**
 * 依模型調整 thinkingBudget；回傳 undefined 表示不送 thinkingConfig（用模型預設）。
 *   - 1.x / 2.0：不支援推理，不送
 *   - 2.5 Flash：照原值
 *   - 2.5 Flash-Lite：0 或 ≥512
 *   - 2.5 Pro：不能關閉，≥128
 *   - 其他（3.x、gemini-*-latest 別名）：不能關閉推理，送 0 會 400；要求 0 時改用模型預設
 */
export function thinkingBudgetFor(model: string, requested: number): number | undefined {
  if (/gemini-(1\.|2\.0)/.test(model)) return undefined
  if (model.includes('2.5')) {
    if (model.includes('pro')) return Math.max(requested, PRO_MIN_THINKING_BUDGET)
    if (model.includes('lite') && requested > 0) return Math.max(requested, FLASH_LITE_MIN_THINKING_BUDGET)
    return requested
  }
  return requested > 0 ? requested : undefined
}

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
    msg.includes('quota') ||
    // 模型已下架 / 名稱不存在：換下一個模型
    msg.includes('404') ||
    msg.includes('not_found') ||
    msg.includes('no longer available')
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
  /** 期望的推理預算；實際送出的值依模型調整，見 thinkingBudgetFor */
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
        const thinkingBudget = thinkingBudgetFor(model, opts.thinkingBudget)
        const config: Record<string, unknown> = {
          temperature: opts.temperature,
          maxOutputTokens: opts.maxOutputTokens,
          abortSignal: controller.signal,
        }
        if (thinkingBudget !== undefined) config.thinkingConfig = { thinkingBudget }
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
