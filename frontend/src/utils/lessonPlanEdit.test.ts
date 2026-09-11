import { describe, it, expect } from 'vitest'
import { initEditState, editReducer } from './lessonPlanEdit'
import type { LessonPlan } from '../types/lessonPlan'

const hint = { keyStructure: 'k', partialSentence: 'p', unscramble: ['Hi.'], completeSentence: 'Hi.', extraPhrases: [] }
const plan: LessonPlan = {
  title: 'T', sceneId: 's', topic: 't', level: 'A1', durationMin: 15,
  objectives: [], timeline: [], grammarNotes: [], teachingNotes: [], sceneConstraint: 'c',
  modules: [
    { id: 'm1', label: 'M1', icon: '📘', tasks: [{ id: 't1', label: 'One.', hint }, { id: 't2', label: 'Two.', hint }] },
    { id: 'm2', label: 'M2', icon: '📗', tasks: [{ id: 't3', label: 'Three.', hint }] },
  ],
}

describe('editReducer', () => {
  it('starts clean from the plan', () => {
    const s = initEditState(plan)
    expect(s.title).toBe('T')
    expect(s.modules).toHaveLength(2)
    expect(s.dirty).toBe(false)
  })

  it('set-title marks dirty', () => {
    const s = editReducer(initEditState(plan), { type: 'set-title', title: 'New' })
    expect(s.title).toBe('New')
    expect(s.dirty).toBe(true)
  })

  it('edit-task-label changes only that task without mutating input', () => {
    const init = initEditState(plan)
    const s = editReducer(init, { type: 'edit-task-label', taskId: 't2', label: 'Two!' })
    expect(s.modules[0].tasks[1].label).toBe('Two!')
    expect(s.modules[0].tasks[0].label).toBe('One.')
    expect(init.modules[0].tasks[1].label).toBe('Two.')
    expect(s.dirty).toBe(true)
  })

  it('delete-task removes the task and drops a module that becomes empty', () => {
    const s = editReducer(initEditState(plan), { type: 'delete-task', taskId: 't3' })
    expect(s.modules).toHaveLength(1)
    expect(s.modules[0].id).toBe('m1')
    expect(s.dirty).toBe(true)
  })

  it('reset returns to the given plan and clears dirty', () => {
    const dirty = editReducer(initEditState(plan), { type: 'set-title', title: 'X' })
    const s = editReducer(dirty, { type: 'reset', plan })
    expect(s.title).toBe('T')
    expect(s.dirty).toBe(false)
  })
})
