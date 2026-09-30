import type { DialogueTask, DialogueTaskRecord, DialogueTaskSummary } from '../types/dialogueTask.ts'
import type { CefrLevel, SceneContext } from '../types/lessonPlan.ts'

const BASE = '/api/dialogue-tasks'
const GENERATE_TIMEOUT_MS = 70_000 // 比後端 60s 稍長，讓後端的 504 先到

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json() as { error?: string }
    if (body.error) return body.error
  } catch { /* not json */ }
  return `HTTP ${res.status}`
}

export async function createDialogueTask(
  req: { teacherUid: string; institutionId?: string; task: DialogueTask },
): Promise<DialogueTaskRecord> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) throw new Error(await readError(res))
  return res.json() as Promise<DialogueTaskRecord>
}

/** AI 生成對話任務草稿（不存檔，交給任務編輯器讓老師確認後再儲存） */
export async function generateDialogueTask(
  req: { sceneContext: SceneContext; topic: string; level: CefrLevel; teachingGoal?: string },
): Promise<DialogueTask> {
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
    return ((await res.json()) as { task: DialogueTask }).task
  } finally {
    clearTimeout(timer)
  }
}

export async function listDialogueTasks(teacherUid: string): Promise<DialogueTaskSummary[]> {
  const res = await fetch(`${BASE}?teacherUid=${encodeURIComponent(teacherUid)}`)
  if (!res.ok) throw new Error(await readError(res))
  return res.json() as Promise<DialogueTaskSummary[]>
}

export async function getDialogueTask(id: string): Promise<DialogueTaskRecord> {
  const res = await fetch(`${BASE}/${encodeURIComponent(id)}`)
  if (res.status === 404) throw new Error('not-found')
  if (!res.ok) throw new Error(await readError(res))
  return res.json() as Promise<DialogueTaskRecord>
}

export async function updateDialogueTask(id: string, task: DialogueTask): Promise<DialogueTaskRecord> {
  const res = await fetch(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task }),
  })
  if (!res.ok) throw new Error(await readError(res))
  return res.json() as Promise<DialogueTaskRecord>
}

export async function deleteDialogueTask(id: string): Promise<void> {
  const res = await fetch(`${BASE}/${encodeURIComponent(id)}/delete`, { method: 'POST' })
  if (!res.ok) throw new Error(await readError(res))
}

/** 把 API 錯誤轉成老師看得懂的文案 */
export function dialogueTaskErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (msg === 'not-found') return '任務已被刪除'
  if (msg.includes('GEMINI_API_KEY')) return 'Gemini 尚未設定 API 金鑰，請於後端 .env 設定 GEMINI_API_KEY'
  if (msg.includes('timed out') || msg.includes('abort')) return 'AI 生成逾時，請再試一次'
  if (msg.includes('storage unavailable')) return '任務資料庫無法使用，請檢查 data 資料夾權限'
  if (msg.includes('Failed to fetch')) return '無法連線後端服務'
  if (msg.includes('malformed')) return '任務內容格式有誤（可能超過長度或數量上限）'
  return `任務操作失敗：${msg}`
}
