import { describe, it, expect } from 'vitest'
import {
  checkpointOptions, optionMark, recordAnswer, setPollStatus, startPoll, toScreenPoll, toStudentPoll,
  hasDuplicateOptions, resolveCastText, resolveCheckpoint,
} from './checkpointPoll.ts'
import { isLevelA1A2OrAbove } from '../types/lessonPlan.ts'
import type { AudienceCheckpoint } from '../types/dialogueTask.ts'

const choice: AudienceCheckpoint = { id: 'cp1', title: '聽力理解', question: 'Which color?', options: ['Red', 'Blue', 'Yellow'], answerIndex: 1 }
const tf: AudienceCheckpoint = { id: 'cp2', kind: 'truefalse', title: '是非', question: 'B wants red.', options: ['對', '錯'], answerIndex: 0 }

describe('checkpointPoll', () => {
  it('correctly identifies levels A1-A2 and above', () => {
    expect(isLevelA1A2OrAbove('preA1-A1')).toBe(false)
    expect(isLevelA1A2OrAbove('A1')).toBe(false)
    expect(isLevelA1A2OrAbove('A1-A2')).toBe(true)
    expect(isLevelA1A2OrAbove('A2-B1')).toBe(true)
    // Legacy support
    expect(isLevelA1A2OrAbove('B1')).toBe(true)
  })

  it('supports showQuestionText option and forwards to screenPoll', () => {
    const pollWithText = startPoll(choice, 's1', 'p1', true)
    expect(pollWithText.showQuestionText).toBe(true)
    expect(toScreenPoll(pollWithText, ['amy']).showQuestionText).toBe(true)

    const pollNoText = startPoll(choice, 's1', 'p2', false)
    expect(pollNoText.showQuestionText).toBe(false)
    expect(toScreenPoll(pollNoText, ['amy']).showQuestionText).toBe(false)
  })

  it('records the latest valid answer while open, ignores others', () => {
    let poll = startPoll(choice, 's1', 'p1')
    poll = recordAnswer(poll, 'amy', { pollId: 'p1', choice: 0 })
    poll = recordAnswer(poll, 'amy', { pollId: 'p1', choice: 1 }) // 改答案
    poll = recordAnswer(poll, 'ben', { pollId: 'old', choice: 2 }) // 別題
    poll = recordAnswer(poll, 'ben', { pollId: 'p1', choice: 5 }) // 不存在的選項
    poll = recordAnswer(poll, 'ben', { pollId: 'p1', choice: '1' }) // 型別錯
    expect(poll.answers).toEqual({ amy: 1 })

    poll = setPollStatus(poll, 'closed')
    expect(recordAnswer(poll, 'ben', { pollId: 'p1', choice: 0 })).toBe(poll) // 結束後不收
  })

  it('hides the answer from students until revealed', () => {
    const poll = startPoll(choice, 's1', 'p1')
    expect(toStudentPoll(poll)).not.toHaveProperty('answerIndex')
    expect(toStudentPoll(setPollStatus(poll, 'closed'))).not.toHaveProperty('answerIndex')
    expect(toStudentPoll(setPollStatus(poll, 'revealed')).answerIndex).toBe(1)
  })

  it('counts only students who are still online', () => {
    let poll = startPoll(choice, 's1', 'p1')
    for (const [id, c] of [['amy', 1], ['ben', 1], ['cat', 0], ['left', 2]] as const) poll = recordAnswer(poll, id, { pollId: 'p1', choice: c })
    const screen = toScreenPoll(poll, ['amy', 'ben', 'cat', 'dan'])
    expect(screen.counts).toEqual([1, 2, 0])
    expect(screen.answered).toBe(3)
    expect(screen.total).toBe(4)
    expect(screen).not.toHaveProperty('answerIndex')
  })

  it('true/false always uses True / False with O / X marks', () => {
    expect(checkpointOptions(tf)).toEqual(['True', 'False'])
    expect(toStudentPoll(startPoll(tf, 's1', 'p2')).kind).toBe('truefalse')
    expect([optionMark('truefalse', 0), optionMark('truefalse', 1), optionMark('choice', 2)]).toEqual(['O', 'X', 'C'])
  })
})

describe('只顯示選項', () => {
  it('學生裝置收不到題目與選項文字，大屏保留完整文字', () => {
    const poll = startPoll(choice, 's1', 'p1', false)
    const student = toStudentPoll(poll)
    expect(student.showQuestionText).toBe(false)
    expect(student.question).toBe('')
    expect(student.options).toEqual(['', '', ''])
    const screen = toScreenPoll(poll, [])
    expect(screen.question).toBe(choice.question)
    expect(screen.options).toEqual(choice.options)
    expect(screen.showQuestionText).toBe(false)
  })

  it('顯示題目時學生裝置收到完整文字', () => {
    const student = toStudentPoll(startPoll(choice, 's1', 'p1', true))
    expect(student.question).toBe(choice.question)
    expect(student.options).toEqual(choice.options)
  })
})

describe('題目角色代號', () => {
  const base = {
    slotLabels: { cashier: '店員A', customer: '顧客A', staff: '店員B', customer2: '顧客B' },
    slotAssignments: { customer: 'stu-1', customer2: 'stu-2' },
    names: { 'stu-1': 'Amy', 'stu-2': 'Ben' },
  }
  const cp: AudienceCheckpoint = {
    id: 'c', title: 't', question: 'Who wants red, {customer} or {customer2}?',
    options: ['{customer}', '{customer2}'], answerIndex: 1, followUp: 'Ask {staff}.',
  }

  it('換成演出者名字，沒指派時用角色名稱，非角色代號保留', () => {
    const r = resolveCheckpoint(cp, { ...base, merge: {} })
    expect(r.question).toBe('Who wants red, Amy or Ben?')
    expect(r.options).toEqual(['Amy', 'Ben'])
    expect(r.followUp).toBe('Ask 店員B.')
    expect(resolveCastText('{unknown} {customer}', { ...base, merge: {} })).toBe('{unknown} Amy')
    expect(hasDuplicateOptions(r)).toBe(false)
  })

  it('併角時換成接手角色的演出者', () => {
    const r = resolveCheckpoint(cp, { ...base, merge: { customer2: 'customer', staff: 'cashier' } })
    expect(r.question).toBe('Who wants red, Amy or Amy?')
    expect(r.followUp).toBe('Ask 店員A.')
    expect(hasDuplicateOptions(r)).toBe(true)
  })

  it('是非題不檢查選項重複', () => {
    expect(hasDuplicateOptions({ ...cp, kind: 'truefalse', options: ['x', 'x'] })).toBe(false)
  })
})
