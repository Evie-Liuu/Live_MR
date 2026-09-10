import type { GenerateLessonPlanRequest, LessonPlanModule, LessonPlanRecord, LessonPlanSummary } from '../types/lessonPlan.ts'

const BASE = '/api/lesson-plans'
const GENERATE_TIMEOUT_MS = 100_000 // 比後端 90s 稍長，讓後端的 504 先到

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json() as { error?: string }
    if (body.error) return body.error
  } catch { /* not json */ }
  return `HTTP ${res.status}`
}

export async function generateLessonPlan(req: GenerateLessonPlanRequest): Promise<LessonPlanRecord> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(await readError(res))
    return res.json() as Promise<LessonPlanRecord>
  } finally {
    clearTimeout(timer)
  }
}

export async function listLessonPlans(teacherUid: string): Promise<LessonPlanSummary[]> {
  const res = await fetch(`${BASE}?teacherUid=${encodeURIComponent(teacherUid)}`)
  if (!res.ok) throw new Error(await readError(res))
  return res.json() as Promise<LessonPlanSummary[]>
}

export async function getLessonPlan(id: string): Promise<LessonPlanRecord> {
  const res = await fetch(`${BASE}/${encodeURIComponent(id)}`)
  if (res.status === 404) throw new Error('not-found')
  if (!res.ok) throw new Error(await readError(res))
  return res.json() as Promise<LessonPlanRecord>
}

export async function updateLessonPlan(
  id: string,
  patch: { title?: string; modules?: LessonPlanModule[] },
): Promise<LessonPlanRecord> {
  const res = await fetch(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(await readError(res))
  return res.json() as Promise<LessonPlanRecord>
}

export async function deleteLessonPlan(id: string): Promise<void> {
  const res = await fetch(`${BASE}/${encodeURIComponent(id)}/delete`, { method: 'POST' })
  if (!res.ok) throw new Error(await readError(res))
}

/** 把 API 錯誤轉成老師看得懂的文案 */
export function lessonPlanErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (msg.includes('GEMINI_API_KEY')) return 'Gemini 尚未設定 API 金鑰，請於後端 .env 設定 GEMINI_API_KEY'
  if (msg.includes('timed out') || msg.includes('abort')) return '教案生成逾時，請再試一次'
  if (msg.includes('storage unavailable')) return '教案資料庫無法使用，請檢查 data 資料夾權限'
  if (msg.includes('Failed to fetch')) return '無法連線後端服務'
  return `教案生成失敗：${msg}`
}
