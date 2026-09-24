import { describe, it, expect } from 'vitest'
import { cloneStep, estimateLineSeconds, formatClock, newLine, newStep, stepTimings } from './dialogueTask.ts'

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
