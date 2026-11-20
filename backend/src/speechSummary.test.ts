import { describe, it, expect } from 'vitest'
import { summarizeSpeech } from './speechSummary.js'
import type { SpeechFeedbackRecord } from './db/speechFeedbackRepo.js'

function rec(over: Partial<SpeechFeedbackRecord>): SpeechFeedbackRecord {
  return {
    id: Math.random().toString(36), roomId: 'r', studentId: 's', studentName: 'A', taskTitle: 't', stepIndex: 0, lineIndex: 0,
    lineEn: 'x', transcript: 'x', language: 'en', severity: 'ok', issues: [], missing: [], wrong: [],
    audioSeconds: 3, model: 'm', promptTokens: 0, audioTokens: 0, outputTokens: 0, costUsd: 0, createdAt: '',
    ...over,
  }
}

describe('summarizeSpeech', () => {
  it('同一句判斷多次只算最後一次', () => {
    const [a] = summarizeSpeech([
      rec({ severity: 'severe', issues: ['incomplete'], missing: ['name'] }),
      rec({ severity: 'ok' }),
    ])
    expect(a).toMatchObject({ lines: 1, ok: 1, severe: 0, issues: { incomplete: 0 } })
    expect(a.missing).toEqual([])
  })

  it('依學生分開，常錯的字依次數排序（不分大小寫）', () => {
    const out = summarizeSpeech([
      rec({ studentName: 'B', lineIndex: 0, severity: 'minor', issues: ['wrongWord'], wrong: [{ said: 'cake', expected: 'cakes' }] }),
      rec({ studentName: 'B', lineIndex: 1, severity: 'minor', issues: ['wrongWord', 'incomplete'], wrong: [{ said: 'Cake', expected: 'cakes' }], missing: ['Taiwan'] }),
      rec({ studentName: 'B', lineIndex: 2, severity: 'severe', issues: ['incomplete'], missing: ['taiwan', 'popular'] }),
      rec({ studentName: 'A', lineIndex: 0 }),
    ])
    expect(out.map(s => s.studentName)).toEqual(['A', 'B'])
    expect(out[1]).toMatchObject({ lines: 3, minor: 2, severe: 1, issues: { wrongWord: 2, incomplete: 2, chinese: 0 } })
    expect(out[1].wrong).toEqual([{ said: 'Cake', expected: 'cakes', count: 2 }])
    expect(out[1].missing).toEqual([{ word: 'Taiwan', count: 2 }, { word: 'popular', count: 1 }])
  })
})
