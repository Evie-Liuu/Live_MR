import { describe, it, expect } from 'vitest'
import { buildJudgeInstruction, normalizeJudgment } from './speechJudge.js'
import { estimateCostUsd } from './pricing.js'

const base = { transcript: "Hi! I'm Alex. What's your name?", language: 'en', meaningConveyed: true, missing: [], wrong: [], severity: 'ok' }

describe('normalizeJudgment', () => {
  it('正確：沒有問題、不打擾', () => {
    expect(normalizeJudgment(base)).toMatchObject({ severity: 'ok', issues: [], language: 'en' })
  })

  it('意思有傳達只是有小錯：最多算輕微（只記錄）', () => {
    const j = normalizeJudgment({ ...base, missing: ['your'], severity: 'severe' })
    expect(j.severity).toBe('severe') // 模型判嚴重且確實有缺漏
    expect(normalizeJudgment({ ...base, missing: ['your'], severity: 'minor' })).toMatchObject({ severity: 'minor', issues: ['incomplete'] })
    expect(normalizeJudgment({ ...base, wrong: [{ said: 'shirt', expected: 'skirt' }], severity: 'ok' })).toMatchObject({ severity: 'minor', issues: ['wrongWord'] })
  })

  it('說中文或中英混用一律嚴重（鼓勵改用英文）', () => {
    expect(normalizeJudgment({ ...base, transcript: '我叫 Alex', language: 'zh', meaningConveyed: false })).toMatchObject({ severity: 'severe', issues: ['chinese'] })
    expect(normalizeJudgment({ ...base, transcript: 'Hi 我是 Alex', language: 'mixed', meaningConveyed: false })).toMatchObject({ severity: 'severe', issues: ['chinese'] })
    expect(normalizeJudgment({ ...base, transcript: 'I love 牛肉麵', language: 'mixed', meaningConveyed: true })).toMatchObject({ severity: 'severe', issues: ['chinese'] })
  })

  it('沒有聲音：完全沒有回應', () => {
    expect(normalizeJudgment({ ...base, transcript: '', language: 'en' })).toMatchObject({ language: 'silent', severity: 'severe', issues: ['noResponse'] })
  })

  it('判嚴重卻沒列原因時當作句子不完整', () => {
    expect(normalizeJudgment({ ...base, transcript: 'Hi', meaningConveyed: false })).toMatchObject({ severity: 'severe', issues: ['incomplete'] })
  })

  it('過濾空白、相同的錯字，限制數量', () => {
    const j = normalizeJudgment({
      ...base,
      missing: ['a', 'b', 'c', 'd', 'e', 'f', ''],
      wrong: [{ said: 'Name', expected: 'name' }, { said: '', expected: 'x' }, { said: 'cat', expected: 'cake' }],
      severity: 'minor',
    })
    expect(j.missing).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(j.wrong).toEqual([{ said: 'cat', expected: 'cake' }])
  })

  it('形狀不對時拋錯（讓 client 換下一個模型）', () => {
    expect(() => normalizeJudgment(null)).toThrow()
    expect(() => normalizeJudgment({ ...base, language: 'fr' })).toThrow()
  })
})

describe('buildJudgeInstruction', () => {
  it('帶入台詞、中文、前一句與程度', () => {
    const s = buildJudgeInstruction({ line: { en: 'Where are you from?', zh: '你來自哪裡？' }, prevLine: 'Hi!', level: 'A1-A2' })
    expect(s).toContain('"Where are you from?"')
    expect(s).toContain('你來自哪裡？')
    expect(s).toContain('"Hi!"')
    expect(s).toContain('A1 to A2')
  })
})

describe('estimateCostUsd', () => {
  it('音訊與文字分開計價', () => {
    // 2.5 Flash-Lite：500 文字 ×0.10 + 200 音訊 ×0.30 + 80 輸出 ×0.40（每百萬）
    expect(estimateCostUsd('gemini-2.5-flash-lite', { prompt: 700, audioPrompt: 200, output: 80 })).toBeCloseTo(0.000142, 9)
  })

  it('不認得的模型用 2.5 Flash 的價格估', () => {
    expect(estimateCostUsd('gemini-flash-lite-latest', { prompt: 1_000_000, output: 0 })).toBeCloseTo(0.30, 6)
  })
})
