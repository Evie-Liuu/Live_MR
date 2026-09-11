import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from './connection.js'
import { LessonPlanRepo } from './lessonPlanRepo.js'
import type { LessonPlan, LessonPlanModule } from '../lessonPlanTypes.js'

function hint(sentence: string) {
  const words = sentence.split(' ')
  return { keyStructure: 'X', partialSentence: '___', unscramble: [...words].reverse(), completeSentence: sentence, extraPhrases: ['Y'] }
}

function samplePlan(planId: string): LessonPlan {
  return {
    title: '退換貨', sceneId: 'clothingStore_cashier', topic: 'returns', level: 'A2', durationMin: 15,
    objectives: ['能提出退貨要求'],
    timeline: [
      { phase: '暖身', minutes: 5, activity: '問候', teacherScript: 'Hello everyone.' },
      { phase: '練習', minutes: 10, activity: '角色扮演', teacherScript: 'Now practice.' },
    ],
    grammarNotes: [{ point: 'would like to', explanation: '禮貌請求', examples: ['I would like to return this.'] }],
    teachingNotes: ['注意語速'],
    sceneConstraint: 'Setting: returns counter.',
    modules: [
      { id: `plan_${planId}_m1`, label: 'Return', icon: '🔁', tasks: [
        { id: `plan_${planId}_1`, label: 'Ask to return a T-shirt.', hint: hint('I would like to return this T-shirt.') },
        { id: `plan_${planId}_2`, label: 'Ask for a refund.', hint: hint('Can I get a refund?') },
      ] },
    ],
  }
}

describe('LessonPlanRepo', () => {
  let repo: LessonPlanRepo
  beforeEach(() => { repo = new LessonPlanRepo(openDatabase(':memory:')) })

  it('create then get returns the same plan with metadata', () => {
    const rec = repo.create({ id: 'p1', teacherUid: 't1', institutionId: 'inst9', plan: samplePlan('p1') })
    expect(rec.id).toBe('p1')
    expect(rec.institutionId).toBe('inst9')
    expect(rec.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(repo.get('p1')).toEqual(rec)
    expect(repo.countTasks('p1')).toBe(2)
  })

  it('get returns null for unknown id', () => {
    expect(repo.get('nope')).toBeNull()
  })

  it('list returns only that teacher, newest updated first, without plan body', async () => {
    repo.create({ id: 'a', teacherUid: 't1', plan: samplePlan('a') })
    repo.create({ id: 'b', teacherUid: 't2', plan: samplePlan('b') })
    repo.create({ id: 'c', teacherUid: 't1', plan: { ...samplePlan('c'), title: 'newer' } })
    await new Promise(r => setTimeout(r, 2))
    repo.update('a', { title: 'touched' })
    const list = repo.list('t1')
    expect(list.map(s => s.id)).toEqual(['a', 'c'])
    expect(list[0]).not.toHaveProperty('plan')
    expect(list[0].title).toBe('touched')
  })

  it('update replaces title and modules, rewriting lesson_tasks rows', () => {
    repo.create({ id: 'p1', teacherUid: 't1', plan: samplePlan('p1') })
    const modules: LessonPlanModule[] = [
      { id: 'plan_p1_m1', label: 'Return', icon: '🔁', tasks: [
        { id: 'plan_p1_1', label: 'Ask to return a jacket.', hint: hint('I would like to return this jacket.') },
      ] },
    ]
    const rec = repo.update('p1', { title: 'New title', modules })
    expect(rec?.plan.title).toBe('New title')
    expect(rec?.plan.modules[0].tasks).toHaveLength(1)
    expect(rec?.plan.modules[0].tasks[0].label).toBe('Ask to return a jacket.')
    expect(repo.countTasks('p1')).toBe(1)
    expect(repo.get('p1')?.plan.objectives).toEqual(['能提出退貨要求'])
  })

  it('update returns null for unknown id', () => {
    expect(repo.update('nope', { title: 'x' })).toBeNull()
  })

  it('remove deletes plan and cascades tasks', () => {
    repo.create({ id: 'p1', teacherUid: 't1', plan: samplePlan('p1') })
    expect(repo.remove('p1')).toBe(true)
    expect(repo.get('p1')).toBeNull()
    expect(repo.countTasks('p1')).toBe(0)
    expect(repo.remove('p1')).toBe(false)
  })
})
