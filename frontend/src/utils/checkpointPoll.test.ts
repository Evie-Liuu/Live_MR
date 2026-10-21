import { describe, it, expect } from 'vitest'
import {
  checkpointOptions, optionMark, recordAnswer, setPollStatus, startPoll, toScreenPoll, toStudentPoll,
} from './checkpointPoll.ts'
import type { AudienceCheckpoint } from '../types/dialogueTask.ts'

const choice: AudienceCheckpoint = { id: 'cp1', title: '聽力理解', question: 'Which color?', options: ['Red', 'Blue', 'Yellow'], answerIndex: 1 }
const tf: AudienceCheckpoint = { id: 'cp2', kind: 'truefalse', title: '是非', question: 'B wants red.', options: ['對', '錯'], answerIndex: 0 }

describe('checkpointPoll', () => {
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
