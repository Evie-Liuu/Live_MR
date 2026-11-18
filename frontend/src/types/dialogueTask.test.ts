import { describe, it, expect } from 'vitest'
import {
  applyCastMerge, castChoices, castSize, cloneStep, estimateLineSeconds, formatClock, newLine, newStep, remapRoles, speakingSlots, stepTimings,
  type DialogueTask,
} from './dialogueTask.ts'

describe('dialogueTask helpers', () => {
  it('estimates at least 2 seconds, ~3 words per second', () => {
    expect(estimateLineSeconds('')).toBe(2)
    expect(estimateLineSeconds('Hi.')).toBe(2)
    expect(estimateLineSeconds('Hello! Welcome to our clothing store. How can I help you today?')).toBe(4)
  })

  it('computes line ranges with a 1 second gap and the step total', () => {
    const lines = [
      { ...newLine('cashier'), en: 'Hello! Welcome to our clothing store. How can I help you today?' },
      { ...newLine('customer'), en: "I'm looking for a T-shirt." },
    ]
    const { ranges, total } = stepTimings(lines)
    expect(ranges).toEqual([{ start: 0, end: 4 }, { start: 5, end: 7 }])
    expect(total).toBe(7)
    expect(stepTimings([]).total).toBe(0)
  })

  it('formats seconds as mm:ss', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(75)).toBe('01:15')
  })

  it('cloneStep copies content with fresh ids', () => {
    const step = { ...newStep('招呼', ['cashier']), grammarPoints: ['Hello!'] }
    const copy = cloneStep(step)
    expect(copy.id).not.toBe(step.id)
    expect(copy.lines[0].id).not.toBe(step.lines[0].id)
    expect(copy.title).toBe('招呼（副本）')
    copy.grammarPoints.push('x')
    expect(step.grammarPoints).toEqual(['Hello!'])
  })
})

describe('併角方案', () => {
  const line = (speakerSlotId: string) => ({ id: speakerSlotId, speakerSlotId, en: 'Hi', zh: '嗨' })
  const task: DialogueTask = {
    title: 'x', sceneId: 'clothingStore_cashier', level: 'A1',
    steps: [{
      id: 's', title: 't', purpose: '', grammarPoints: [], grammarNote: '', teachingNotes: [],
      lines: [line('cashier'), line('customer'), line('staff'), line('customer2'), line('staff')],
    }],
    castOptions: [
      { merge: { staff: 'cashier', customer2: 'customer' } },
      { merge: { staff: 'cashier' } },
      { merge: { customer2: 'customer' } }, // 同樣是 3 人：略過
      { merge: { staff: 'customer2', customer2: 'customer' } }, // 連鎖：無效
    ],
  }

  it('依人數列出可選方案，最後是完整人數', () => {
    expect(castChoices(task).map(c => c.size)).toEqual([2, 3, 4])
  })

  it('不成立的規則回 null', () => {
    expect(castSize(task, { staff: 'staff' })).toBeNull()
    expect(castSize(task, { staff: 'nobody' })).toBeNull()
    expect(castSize(task, { staff: 'customer2', customer2: 'customer' })).toBeNull()
    expect(castSize(task, { ghost: 'cashier' })).toBe(4)
  })

  it('刪掉角色：他的台詞與標成他支線的台詞都拿掉，人數扣掉他', () => {
    const withBranch: DialogueTask = {
      ...task,
      steps: [{ ...task.steps[0], lines: [...task.steps[0].lines, { ...line('cashier'), id: 'toB', branch: 'customer2' }] }],
    }
    expect(castSize(withBranch, { staff: 'cashier' }, ['customer2'])).toBe(2)
    const cut = applyCastMerge(withBranch, { staff: 'cashier' }, ['customer2'])
    expect(speakingSlots(cut)).toEqual(['cashier', 'customer'])
    expect(cut.steps[0].lines.map(l => l.id)).toEqual(['cashier', 'customer', 'staff', 'staff'])
    expect(withBranch.steps[0].lines).toHaveLength(6)
  })

  it('併掉角色：標成他支線的台詞（包括他自己說的）拿掉，其他台詞改由接手的人說', () => {
    const withBranch: DialogueTask = {
      ...task,
      steps: [{ ...task.steps[0], lines: [...task.steps[0].lines, { ...line('staff'), id: 'staffOnly', branch: 'staff' }] }],
    }
    const cut = applyCastMerge(withBranch, { staff: 'cashier' })
    expect(cut.steps[0].lines.map(l => `${l.id}:${l.speakerSlotId}`)).toEqual([
      'cashier:cashier', 'customer:customer', 'staff:cashier', 'customer2:customer2', 'staff:cashier',
    ])
    expect(applyCastMerge(withBranch, { customer2: 'customer' }).steps[0].lines).toHaveLength(6)
  })

  it('不能把台詞併給被刪掉的角色；同時被併又被刪以刪掉為準', () => {
    expect(castSize(task, { staff: 'customer2' }, ['customer2'])).toBeNull()
    expect(castSize(task, { customer2: 'customer' }, ['customer2'])).toBe(3)
  })

  it('有刪角的方案也列在可選人數裡', () => {
    const t: DialogueTask = { ...task, castOptions: [{ merge: { staff: 'cashier' }, omit: ['customer2'] }] }
    expect(castChoices(t)).toEqual([
      { size: 2, merge: { staff: 'cashier' }, omit: ['customer2'] },
      { size: 4, merge: {}, omit: [] },
    ])
  })

  it('換場景改角色：說話者、支線、互動點代號、併角方案一起換', () => {
    const t: DialogueTask = {
      ...task,
      steps: [{
        ...task.steps[0],
        lines: [...task.steps[0].lines, { ...line('cashier'), id: 'b', branch: 'customer2' }],
        checkpoints: [{ id: 'cp', title: 'x', question: 'Who helps {customer2}? {cashier}', options: ['{cashier}', '{nobody}'], answerIndex: 0 }],
      }],
      castOptions: [{ merge: { staff: 'cashier' } }, { merge: { staff: 'cashier' }, omit: ['customer2'] }],
    }
    const out = remapRoles(t, { cashier: 'staff', staff: 'cashier' }, ['cashier', 'staff', 'customer', 'customer2'])
    expect(out.steps[0].lines.map(l => l.speakerSlotId)).toEqual(['staff', 'customer', 'cashier', 'customer2', 'cashier', 'staff'])
    expect(out.steps[0].lines[5].branch).toBe('customer2')
    expect(out.steps[0].checkpoints?.[0].question).toBe('Who helps {customer2}? {staff}')
    expect(out.steps[0].checkpoints?.[0].options).toEqual(['{staff}', '{nobody}'])
    expect(out.castOptions).toEqual([{ merge: { cashier: 'staff' } }, { merge: { cashier: 'staff' }, omit: ['customer2'] }])
    expect(t.steps[0].lines[0].speakerSlotId).toBe('cashier')
  })

  it('換場景改角色：兩個角色改成同一人，不成立的併角方案與支線拿掉', () => {
    const t: DialogueTask = {
      ...task,
      steps: [{ ...task.steps[0], lines: [...task.steps[0].lines, { ...line('staff'), id: 'b', branch: 'staff' }] }],
      castOptions: [{ merge: { staff: 'cashier' } }, { merge: { customer2: 'customer' } }],
    }
    const out = remapRoles(t, { staff: 'cashier' }, ['cashier', 'customer', 'customer2'])
    expect(speakingSlots(out)).toEqual(['cashier', 'customer', 'customer2'])
    expect(out.steps[0].lines[5].branch).toBeUndefined()
    expect(out.castOptions).toEqual([{ merge: { customer2: 'customer' } }])
    expect(remapRoles(t, { staff: 'cashier', customer2: 'customer' }, ['cashier', 'customer']).castOptions).toBeUndefined()
  })

  it('併角後台詞改由對應角色說，原任務不變', () => {
    const merged = applyCastMerge(task, { staff: 'cashier' })
    expect(speakingSlots(merged)).toEqual(['cashier', 'customer', 'customer2'])
    expect(speakingSlots(task)).toHaveLength(4)
  })
})
