import { describe, it, expect } from 'vitest'
import { ROLE_COLORS, buildNameplates } from './nameplates.ts'

const slots = [{ id: 'cashier', label: '店員A' }, { id: 'customer', label: '顧客A' }, { id: 'staff', label: '店員B' }]
const base = {
  slots,
  slotAssignments: { cashier: 'host-1', customer: 'amy' },
  participantNames: new Map([['amy', '王小明']]),
  lesson: null,
  speaking: new Set<string>(),
}

describe('buildNameplates', () => {
  it('shows role + performer for assigned slots only, teacher falls back to 老師', () => {
    const plates = buildNameplates(base)
    expect(Object.keys(plates)).toEqual(['host-1', 'amy'])
    expect(plates['host-1']).toMatchObject({ role: '店員A', name: '老師', color: ROLE_COLORS[0], active: true })
    expect(plates.amy).toMatchObject({ role: '顧客A', name: '王小明', color: ROLE_COLORS[1] })
  })

  it('dims roles without lines in the current step while the task is running', () => {
    const lesson = { phase: 'during' as const, allDone: false, roles: ['顧客A'] }
    const plates = buildNameplates({ ...base, lesson, speaking: new Set(['amy']) })
    expect(plates['host-1'].active).toBe(false)
    expect(plates.amy).toMatchObject({ active: true, speaking: true })
    // 任務前／後或已完成時不淡化
    expect(buildNameplates({ ...base, lesson: { ...lesson, phase: 'pre' } })['host-1'].active).toBe(true)
    expect(buildNameplates({ ...base, lesson: { ...lesson, allDone: true } })['host-1'].active).toBe(true)
  })

  it('scenes without slots show names only', () => {
    const plates = buildNameplates({ ...base, slots: [] })
    expect(plates).toEqual({ amy: { name: '王小明', color: ROLE_COLORS[0], active: true, speaking: false } })
  })
})
