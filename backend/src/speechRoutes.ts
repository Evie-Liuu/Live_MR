import { Router, type Request, type Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import type { RoomStore } from './rooms.js'
import type { SpeechFeedbackRepo } from './db/speechFeedbackRepo.js'
import { judgeTurn } from './ai/speechJudge.js'
import { estimateCostUsd } from './ai/pricing.js'
import { summarizeSpeech } from './speechSummary.js'

export interface SpeechRouteDeps {
  store: RoomStore
  /** null＝資料庫開啟失敗：照常判斷，只是不存紀錄 */
  repo: SpeechFeedbackRepo | null
  judge?: typeof judgeTurn
  /** 每位學生每分鐘最多判斷幾次（防止重送或惡意灌爆用量） */
  maxPerMinute?: number
  /** 試用判斷（不需課堂）全部加起來每分鐘最多幾次 */
  previewPerMinute?: number
}

const SAFE_IDENTITY_RE = /^[\p{L}\p{N}_-]{1,128}$/u
/** 16 kHz 單聲道 16-bit WAV：20 秒約 640 KB，base64 後約 850 KB */
const MAX_AUDIO_BASE64 = 1_200_000
const MAX_AUDIO_SECONDS = 30
const MAX_TEXT = 1000
const MAX_NAME = 100
const DEFAULT_MAX_PER_MINUTE = 20
const DEFAULT_PREVIEW_PER_MINUTE = 30

function text(v: unknown, max = MAX_TEXT): string | null {
  return typeof v === 'string' && v.length <= max ? v : null
}

function index(v: unknown): number | null {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) < 1000 ? (v as number) : null
}

/**
 * 登台展演的 AI 口說輔助：
 *   POST /rooms/:roomId/speech-judge     學生 iPad 送一句的錄音，回傳判斷並存紀錄
 *   POST /speech-judge/preview           模擬學生回答頁：試用判斷，不需課堂、不存紀錄
 *   GET  /rooms/:roomId/speech-feedback  老師查本堂課的紀錄、每位學生的統計與 AI 用量（需 hostToken）
 */
export function createSpeechRouter(deps: SpeechRouteDeps): Router {
  const router = Router()
  const judge = deps.judge ?? judgeTurn
  const maxPerMinute = deps.maxPerMinute ?? DEFAULT_MAX_PER_MINUTE
  const previewPerMinute = deps.previewPerMinute ?? DEFAULT_PREVIEW_PER_MINUTE
  const recent = new Map<string, number[]>()

  const allow = (key: string, limit: number): boolean => {
    const now = Date.now()
    const list = (recent.get(key) ?? []).filter(t => now - t < 60_000)
    if (list.length >= limit) { recent.set(key, list); return false }
    list.push(now)
    recent.set(key, list)
    return true
  }

  /** 台詞、程度與錄音（課堂判斷與試用判斷共用）；不合法回錯誤訊息 */
  const parseJudgeBody = (body: Record<string, unknown>) => {
    const line = body.line as { en?: unknown; zh?: unknown } | undefined
    const en = text(line?.en)
    const audio = body.audio as { data?: unknown; mimeType?: unknown } | undefined
    const audioSeconds = typeof body.audioSeconds === 'number' && body.audioSeconds > 0 && body.audioSeconds <= MAX_AUDIO_SECONDS
      ? body.audioSeconds : null
    if (!en?.trim() || audioSeconds === null) return { error: 'invalid request' } as const
    if (audio?.mimeType !== 'audio/wav' || typeof audio.data !== 'string' || !audio.data || audio.data.length > MAX_AUDIO_BASE64) {
      return { error: 'audio must be base64 audio/wav' } as const
    }
    return {
      input: {
        line: { en, zh: text(line?.zh) ?? '' },
        prevLine: text(body.prevLine),
        level: text(body.level, 20) ?? 'A1',
        audio: { data: audio.data, mimeType: 'audio/wav' },
      },
      audioSeconds,
    } as const
  }

  /** 送 AI 判斷並估算用量 */
  const runJudge = async (input: Parameters<typeof judgeTurn>[0], audioSeconds: number) => {
    const startedAt = Date.now()
    const { judgment, model, usage } = await judge(input)
    const promptTokens = usage?.prompt ?? 0
    const outputTokens = usage?.output ?? 0
    // 模型沒回報音訊 token 時用每秒 32 token 估
    const audioTokens = usage?.audioPrompt ?? Math.min(promptTokens, Math.round(audioSeconds * 32))
    const costUsd = estimateCostUsd(model, { prompt: promptTokens, output: outputTokens, audioPrompt: audioTokens })
    return { judgment, model, promptTokens, audioTokens, outputTokens, costUsd, latencyMs: Date.now() - startedAt }
  }

  const sendJudgeError = (res: Response, err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[speech-judge] error:', msg)
    res.status(msg.includes('GEMINI_API_KEY') ? 503 : 502).json({ error: msg.includes('GEMINI_API_KEY') ? 'AI not configured' : 'AI judge failed' })
  }

  /**
   * 試用判斷（模擬學生回答頁）：不需要課堂、不存紀錄。
   * 全部共用一個次數上限，避免區網裡任何人都能無限制消耗 AI 用量。
   */
  router.post('/speech-judge/preview', async (req: Request, res: Response) => {
    const parsed = parseJudgeBody((req.body ?? {}) as Record<string, unknown>)
    if ('error' in parsed) { res.status(400).json({ error: parsed.error }); return }
    if (!allow('preview', previewPerMinute)) { res.status(429).json({ error: 'too many requests' }); return }
    try {
      const r = await runJudge(parsed.input, parsed.audioSeconds)
      res.json({
        judgment: r.judgment, model: r.model, costUsd: r.costUsd, latencyMs: r.latencyMs,
        usage: { prompt: r.promptTokens, audio: r.audioTokens, output: r.outputTokens },
      })
    } catch (err) {
      sendJudgeError(res, err)
    }
  })

  router.post('/rooms/:roomId/speech-judge', async (req: Request, res: Response) => {
    const roomId = req.params.roomId as string
    if (!deps.store.getRoom(roomId)) { res.status(404).json({ error: 'Room not found' }); return }
    const body = (req.body ?? {}) as Record<string, unknown>
    const studentId = text(body.studentId, 128)
    const studentName = text(body.studentName, MAX_NAME)
    const taskTitle = text(body.taskTitle, MAX_NAME) ?? ''
    const stepIndex = index(body.stepIndex)
    const lineIndex = index(body.lineIndex)
    if (!studentId || !SAFE_IDENTITY_RE.test(studentId) || !studentName || stepIndex === null || lineIndex === null) {
      res.status(400).json({ error: 'invalid request' })
      return
    }
    const parsed = parseJudgeBody(body)
    if ('error' in parsed) { res.status(400).json({ error: parsed.error }); return }
    const { audioSeconds } = parsed
    const en = parsed.input.line.en
    if (!allow(`${roomId}:${studentId}`, maxPerMinute)) { res.status(429).json({ error: 'too many requests' }); return }

    try {
      const { judgment, model, promptTokens, audioTokens, outputTokens, costUsd } = await runJudge(parsed.input, audioSeconds)
      const id = uuidv4()
      try {
        deps.repo?.add({
          id, roomId, studentId, studentName, taskTitle, stepIndex, lineIndex, lineEn: en,
          transcript: judgment.transcript, language: judgment.language, severity: judgment.severity,
          issues: judgment.issues, missing: judgment.missing, wrong: judgment.wrong,
          audioSeconds, model, promptTokens, audioTokens, outputTokens, costUsd,
        })
      } catch (err) {
        console.error('[speech-judge] failed to save feedback:', err instanceof Error ? err.message : String(err))
      }
      res.json({ id, judgment, model, costUsd })
    } catch (err) {
      sendJudgeError(res, err)
    }
  })

  router.get('/rooms/:roomId/speech-feedback', (req: Request, res: Response) => {
    const roomId = req.params.roomId as string
    if (!deps.store.getRoom(roomId)) { res.status(404).json({ error: 'Room not found' }); return }
    const header = req.headers['x-host-token']
    if (!deps.store.validateHost(roomId, typeof header === 'string' ? header : '')) {
      res.status(403).json({ error: 'Host token required' })
      return
    }
    if (!deps.repo) { res.status(503).json({ error: 'database unavailable' }); return }
    const records = deps.repo.listByRoom(roomId)
    res.json({ records, students: summarizeSpeech(records), usage: deps.repo.usageByRoom(roomId) })
  })

  return router
}
