import { GoogleGenAI } from '@google/genai'

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
const TIMEOUT_MS = 60_000

let client: GoogleGenAI | null = null

function getClient(): GoogleGenAI {
  if (client) return client
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')
  client = new GoogleGenAI({ apiKey })
  return client
}

export async function generateHint(prompt: string, signal?: AbortSignal): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  signal?.addEventListener('abort', () => controller.abort())
  try {
    const res = await getClient().models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        temperature: 0.6,
        maxOutputTokens: 80,
        abortSignal: controller.signal,
      },
    })
    const text = (res.text ?? '').trim()
    if (!text) throw new Error('Empty response')
    return text
  } finally {
    clearTimeout(timer)
  }
}
