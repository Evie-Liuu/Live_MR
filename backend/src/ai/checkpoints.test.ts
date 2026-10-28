import { describe, it, expect, vi } from 'vitest'
import { buildCheckpointPrompt, generateCheckpoints, type CheckpointRequest } from './checkpoints.js'

const req: CheckpointRequest = {
  level: 'A1',
  roles: [{ id: 'cashier', label: '店員' }, { id: 'customer', label: '顧客' }],
  step: {
    title: '報價', purpose: '價格查詢',
    lines: [
      { speaker: 'customer', en: 'How much is the red T-shirt?', zh: '紅色 T 恤多少錢？' },
      { speaker: 'cashier', en: 'It is 300 dollars.', zh: '三百元。' },
    ],
  },
  avoid: ['How much is the T-shirt?'],
  kind: 'mixed',
  count: 2,
}

function caller(...responses: unknown[]) {
  const fn = vi.fn()
  for (const r of responses) fn.mockResolvedValueOnce({ data: r, model: 'm', usage: null })
  return fn
}

describe('generateCheckpoints', () => {
  it('prompt 帶入台詞、角色代號與要避開的題目', () => {
    const { prompt, systemInstruction } = buildCheckpointPrompt(req)
    expect(prompt).toContain('{customer} (顧客): How much is the red T-shirt?')
    expect(prompt).toContain('- How much is the T-shirt?')
    expect(prompt).toContain('exactly 2 new audience questions')
    expect(systemInstruction).toContain('cashier, customer')
  })

  it('略過不合格與重複的題目，補上 id', async () => {
    const call = caller({
      checkpoints: [
        { kind: 'choice', title: '價格理解', question: 'How much is the T-shirt?', options: ['100', '200', '300'], answerIndex: 2 },
        { kind: 'choice', title: '價格理解', question: 'How much does {customer} pay?', options: ['100', '200', '300'], answerIndex: 2 },
        { kind: 'truefalse', title: '是非判斷', question: '{boss} wants a red T-shirt.', options: ['True', 'False'], answerIndex: 0 },
        { kind: 'truefalse', title: '是非判斷', question: 'The T-shirt is red.', options: ['x'], answerIndex: 0 },
      ],
    })
    const list = await generateCheckpoints(req, { call: call as never })
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ question: 'How much does {customer} pay?', answerIndex: 2 })
    expect(list[0].id).toMatch(/^ai_cp_/)
    expect(list[1]).toMatchObject({ kind: 'truefalse', options: ['True', 'False'] })
  })

  it('指定題型時只留該題型；一題都沒有時重試一次，仍沒有就拋錯', async () => {
    const tf = { kind: 'truefalse', title: '是非判斷', question: 'The T-shirt is red.', options: ['True', 'False'], answerIndex: 0 }
    const call = caller({ checkpoints: [tf] }, { checkpoints: [] })
    await expect(generateCheckpoints({ ...req, kind: 'choice' }, { call: call as never })).rejects.toThrow('no valid question')
    expect(call).toHaveBeenCalledTimes(2)
    const ok = await generateCheckpoints({ ...req, kind: 'truefalse', count: 1 }, { call: caller({ checkpoints: [tf] }) as never })
    expect(ok).toHaveLength(1)
  })
})
