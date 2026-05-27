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

export async function generateHint(
  prompt: string,
  signal?: AbortSignal,
): Promise<HintResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  signal?.addEventListener('abort', () => controller.abort())
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
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
