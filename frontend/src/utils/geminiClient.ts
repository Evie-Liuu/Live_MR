const ENDPOINT = '/api/ai/hint'
const TIMEOUT_MS = 60_000
const WARMUP_TIMEOUT_MS = 90_000

let warmupPromise: Promise<void> | null = null

export function warmupGemini(): Promise<void> {
  if (warmupPromise) return warmupPromise
  warmupPromise = (async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), WARMUP_TIMEOUT_MS)
    try {
      await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'hi' }),
        signal: controller.signal,
      })
    } catch {
      warmupPromise = null
    } finally {
      clearTimeout(timer)
    }
  })()
  return warmupPromise
}

export function toFriendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (msg.includes('GEMINI_API_KEY')) {
    return 'Gemini 尚未設定 API 金鑰，請於後端 .env 設定 GEMINI_API_KEY'
  }
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
    return '無法連線後端 AI 服務'
  }
  if (msg.includes('AbortError') || msg.includes('aborted')) {
    return 'AI 回應逾時，請重試'
  }
  if (msg.includes('Empty response')) {
    return 'AI 未能生成提示，請重試'
  }
  return `AI 生成失敗：${msg}`
}

export interface HintResult {
  text: string
  model: string
}

export interface GenerateHintOptions {
  /** Prior chat turns; when provided, the request becomes multi-turn. */
  history?: Array<{ role: 'user' | 'model'; text: string }>
  /** Gemini systemInstruction applied to the whole conversation. */
  systemInstruction?: string
  /** Caller-provided cancellation signal. */
  signal?: AbortSignal
  /** 當前輪改送音訊（base64）；history 仍為文字。 */
  audio?: { data: string; mimeType: string }
}

export async function generateHint(
  prompt: string,
  opts: GenerateHintOptions = {},
): Promise<HintResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  opts.signal?.addEventListener('abort', () => controller.abort())
  try {
    const body: Record<string, unknown> = { prompt }
    if (opts.history && opts.history.length > 0) body.history = opts.history
    if (opts.systemInstruction) body.systemInstruction = opts.systemInstruction
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(data.error || `AI HTTP ${res.status}`)
    }
    const data = await res.json() as { text?: string; model?: string }
    const text = (data.text ?? '').trim()
    if (!text) throw new Error('Empty response')
    return { text, model: data.model ?? 'unknown' }
  } finally {
    clearTimeout(timer)
  }
}

export interface TokenUsage {
  prompt: number
  output: number
  total: number
}

export interface HintsResult {
  question: string
  complete: string
  extend: string
  transcript: string
  model: string
  /** Gemini token 用量（dev 用量檢視）；後端無回傳時為 undefined。 */
  usage?: TokenUsage
}

const HINTS_ENDPOINT = '/api/ai/hints'

export async function generateHints(
  prompt: string,
  opts: GenerateHintOptions = {},
): Promise<HintsResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  opts.signal?.addEventListener('abort', () => controller.abort())
  try {
    const body: Record<string, unknown> = { prompt }
    if (opts.history && opts.history.length > 0) body.history = opts.history
    if (opts.systemInstruction) body.systemInstruction = opts.systemInstruction
    if (opts.audio) body.audio = opts.audio
    const res = await fetch(HINTS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(data.error || `AI HTTP ${res.status}`)
    }
    const data = await res.json() as {
      transcript?: string; question?: string; complete?: string; extend?: string; model?: string
      usage?: { prompt?: number; output?: number; total?: number }
    }
    const complete = (data.complete ?? '').trim()
    if (!complete) throw new Error('Empty response')
    return {
      transcript: (data.transcript ?? '').trim(),
      question: (data.question ?? '').trim(),
      complete,
      extend: (data.extend ?? '').trim(),
      model: data.model ?? 'unknown',
      usage: data.usage
        ? { prompt: data.usage.prompt ?? 0, output: data.usage.output ?? 0, total: data.usage.total ?? 0 }
        : undefined,
    }
  } finally {
    clearTimeout(timer)
  }
}
