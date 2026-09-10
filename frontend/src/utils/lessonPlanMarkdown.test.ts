import { describe, it, expect } from 'vitest'
import { lessonPlanToMarkdown } from './lessonPlanMarkdown'
import type { LessonPlan } from '../types/lessonPlan'

const plan: LessonPlan = {
  title: '退換貨', sceneId: 'clothingStore_cashier', topic: '退換貨', level: 'A2', durationMin: 15,
  objectives: ['能提出退貨要求', '能詢問退款方式'],
  timeline: [
    { phase: '暖身', minutes: 3, activity: '問候', teacherScript: 'Hello everyone.' },
    { phase: '練習', minutes: 12, activity: '角色扮演', teacherScript: 'Now practice.' },
  ],
  grammarNotes: [{ point: 'would like to', explanation: '禮貌請求', examples: ['I would like to return this.'] }],
  teachingNotes: ['注意語速'],
  sceneConstraint: 'Setting: returns.',
  modules: [{ id: 'plan_p_m1', label: 'Return', icon: '🔁', tasks: [
    { id: 'plan_p_1', label: 'Ask to return a T-shirt.', hint: {
      keyStructure: 'I + would like to + return + [item]', partialSentence: 'I would like to _____ this T-shirt.',
      unscramble: ['return', 'I', 'to', 'like', 'would', 'this', 'T-shirt.'],
      completeSentence: 'I would like to return this T-shirt.', extraPhrases: ['Can I return this T-shirt?'],
    } },
  ] }],
}

describe('lessonPlanToMarkdown', () => {
  const md = lessonPlanToMarkdown(plan)

  it('starts with the title and metadata', () => {
    expect(md.startsWith('# 退換貨\n')).toBe(true)
    expect(md).toContain('A2')
    expect(md).toContain('15 分鐘')
  })

  it('renders objectives, timeline with scripts, grammar, notes and tasks', () => {
    expect(md).toContain('- 能提出退貨要求')
    expect(md).toContain('### 暖身（3 分鐘）')
    expect(md).toContain('Hello everyone.')
    expect(md).toContain('**would like to**')
    expect(md).toContain('- 注意語速')
    expect(md).toContain('### 🔁 Return')
    expect(md).toContain('1. Ask to return a T-shirt.')
    expect(md).toContain('I would like to return this T-shirt.')
  })

  it('does not include the sceneConstraint (internal AI text)', () => {
    expect(md).not.toContain('Setting: returns.')
  })
})
