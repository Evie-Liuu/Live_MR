const OLLAMA_URL = 'http://localhost:11434/api/generate'
const MODEL = 'qwen2.5:3b'
const TIMEOUT_MS = 60_000
const WARMUP_TIMEOUT_MS = 90_000

let warmupPromise: Promise<void> | null = null

export function warmupOllama(): Promise<void> {
  if (warmupPromise) return warmupPromise
  warmupPromise = (async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), WARMUP_TIMEOUT_MS)
    try {
      await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, prompt: 'hi', stream: false, options: { num_predict: 1 } }),
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
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ECONNREFUSED')) {
    return '無法連線 Ollama，請確認本機已啟動 `ollama serve`'
  }
  if (msg.includes('404')) {
    return `模型 ${MODEL} 未安裝，請執行 \`ollama pull ${MODEL}\``
  }
  if (msg.includes('AbortError') || msg.includes('aborted')) {
    return 'AI 回應逾時，請重試'
  }
  if (msg.includes('Empty response')) {
    return 'AI 未能生成提示，請重試'
  }
  return `AI 生成失敗：${msg}`
}

export async function generateHint(
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  signal?.addEventListener('abort', () => controller.abort())
  try {
    const res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.6, num_predict: 80 },
      }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
    const data = await res.json() as { response?: string }
    const text = (data.response ?? '').trim()
    if (!text) throw new Error('Empty response')
    return text
  } finally {
    clearTimeout(timer)
  }
}
