import type { JudgeIssue } from './ai/speechJudge.js'
import type { SpeechFeedbackRecord } from './db/speechFeedbackRepo.js'

/** 每位學生的口說統計：給老師課後參考、挑選練習重點 */
export interface StudentSpeechSummary {
  studentName: string
  lines: number
  ok: number
  minor: number
  severe: number
  issues: Record<JudgeIssue, number>
  /** 最常漏掉的字（次數多的在前，最多 5 個） */
  missing: { word: string; count: number }[]
  /** 最常說錯的字（最多 5 個） */
  wrong: { said: string; expected: string; count: number }[]
}

const TOP = 5

function top<T extends { count: number }>(map: Map<string, T>): T[] {
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, TOP)
}

/**
 * 同一句可能判斷多次（停住一次、說完一次），統計時每位學生每句只算最後一次。
 */
export function summarizeSpeech(records: readonly SpeechFeedbackRecord[]): StudentSpeechSummary[] {
  const latest = new Map<string, SpeechFeedbackRecord>()
  for (const r of records) latest.set(`${r.studentName}\u0000${r.taskTitle}\u0000${r.stepIndex}\u0000${r.lineIndex}`, r)
  const byStudent = new Map<string, SpeechFeedbackRecord[]>()
  for (const r of latest.values()) byStudent.set(r.studentName, [...(byStudent.get(r.studentName) ?? []), r])

  return [...byStudent.entries()].map(([studentName, list]) => {
    const issues: Record<JudgeIssue, number> = { chinese: 0, incomplete: 0, wrongWord: 0, noResponse: 0 }
    const missing = new Map<string, { word: string; count: number }>()
    const wrong = new Map<string, { said: string; expected: string; count: number }>()
    for (const r of list) {
      for (const i of r.issues) issues[i] += 1
      for (const w of r.missing) {
        const key = w.toLowerCase()
        missing.set(key, { word: missing.get(key)?.word ?? w, count: (missing.get(key)?.count ?? 0) + 1 })
      }
      for (const w of r.wrong) {
        const key = `${w.said.toLowerCase()}>${w.expected.toLowerCase()}`
        wrong.set(key, { said: w.said, expected: w.expected, count: (wrong.get(key)?.count ?? 0) + 1 })
      }
    }
    return {
      studentName,
      lines: list.length,
      ok: list.filter(r => r.severity === 'ok').length,
      minor: list.filter(r => r.severity === 'minor').length,
      severe: list.filter(r => r.severity === 'severe').length,
      issues,
      missing: top(missing),
      wrong: top(wrong),
    }
  }).sort((a, b) => a.studentName.localeCompare(b.studentName))
}
