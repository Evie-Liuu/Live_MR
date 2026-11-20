import type { DatabaseSync } from 'node:sqlite'
import type { JudgeIssue, JudgeSeverity, SpokenLanguage, WrongWord } from '../ai/speechJudge.js'

/** 一句台詞的 AI 口說判斷紀錄（課後練習與老師參考用） */
export interface SpeechFeedbackRecord {
  id: string
  roomId: string
  studentId: string
  studentName: string
  taskTitle: string
  stepIndex: number
  lineIndex: number
  lineEn: string
  transcript: string
  language: SpokenLanguage
  severity: JudgeSeverity
  issues: JudgeIssue[]
  missing: string[]
  wrong: WrongWord[]
  audioSeconds: number
  model: string
  promptTokens: number
  audioTokens: number
  outputTokens: number
  costUsd: number
  createdAt: string
}

export type NewSpeechFeedback = Omit<SpeechFeedbackRecord, 'createdAt'>

export interface SpeechUsageSummary {
  calls: number
  audioSeconds: number
  promptTokens: number
  audioTokens: number
  outputTokens: number
  costUsd: number
}

interface Row {
  id: string
  room_id: string
  student_id: string
  student_name: string
  task_title: string
  step_index: number
  line_index: number
  line_en: string
  transcript: string
  language: string
  severity: string
  issues_json: string
  missing_json: string
  wrong_json: string
  audio_seconds: number
  model: string
  prompt_tokens: number
  audio_tokens: number
  output_tokens: number
  cost_usd: number
  created_at: string
}

function rowToRecord(r: Row): SpeechFeedbackRecord {
  return {
    id: r.id,
    roomId: r.room_id,
    studentId: r.student_id,
    studentName: r.student_name,
    taskTitle: r.task_title,
    stepIndex: r.step_index,
    lineIndex: r.line_index,
    lineEn: r.line_en,
    transcript: r.transcript,
    language: r.language as SpokenLanguage,
    severity: r.severity as JudgeSeverity,
    issues: JSON.parse(r.issues_json) as JudgeIssue[],
    missing: JSON.parse(r.missing_json) as string[],
    wrong: JSON.parse(r.wrong_json) as WrongWord[],
    audioSeconds: r.audio_seconds,
    model: r.model,
    promptTokens: r.prompt_tokens,
    audioTokens: r.audio_tokens,
    outputTokens: r.output_tokens,
    costUsd: r.cost_usd,
    createdAt: r.created_at,
  }
}

export class SpeechFeedbackRepo {
  constructor(private readonly db: DatabaseSync) {}

  add(input: NewSpeechFeedback): SpeechFeedbackRecord {
    const createdAt = new Date().toISOString()
    this.db.prepare(
      `INSERT INTO speech_feedback (
         id, room_id, student_id, student_name, task_title, step_index, line_index, line_en, transcript, language, severity,
         issues_json, missing_json, wrong_json, audio_seconds, model, prompt_tokens, audio_tokens, output_tokens, cost_usd, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id, input.roomId, input.studentId, input.studentName, input.taskTitle, input.stepIndex, input.lineIndex,
      input.lineEn, input.transcript, input.language, input.severity,
      JSON.stringify(input.issues), JSON.stringify(input.missing), JSON.stringify(input.wrong),
      input.audioSeconds, input.model, input.promptTokens, input.audioTokens, input.outputTokens, input.costUsd, createdAt,
    )
    return { ...input, createdAt }
  }

  listByRoom(roomId: string, limit = 500): SpeechFeedbackRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM speech_feedback WHERE room_id = ? ORDER BY created_at, id LIMIT ?',
    ).all(roomId, limit) as unknown as Row[]
    return rows.map(rowToRecord)
  }

  usageByRoom(roomId: string): SpeechUsageSummary {
    const row = this.db.prepare(
      `SELECT COUNT(*) AS calls, COALESCE(SUM(audio_seconds), 0) AS audio_seconds, COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
              COALESCE(SUM(audio_tokens), 0) AS audio_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(cost_usd), 0) AS cost_usd
       FROM speech_feedback WHERE room_id = ?`,
    ).get(roomId) as { calls: number; audio_seconds: number; prompt_tokens: number; audio_tokens: number; output_tokens: number; cost_usd: number }
    return {
      calls: row.calls,
      audioSeconds: row.audio_seconds,
      promptTokens: row.prompt_tokens,
      audioTokens: row.audio_tokens,
      outputTokens: row.output_tokens,
      costUsd: row.cost_usd,
    }
  }
}
