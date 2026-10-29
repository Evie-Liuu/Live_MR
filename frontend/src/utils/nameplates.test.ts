import { describe, it, expect } from 'vitest'
import { ROLE_COLORS, buildNameplates, layoutNameplates } from './nameplates.ts'

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

  it('任務前靜態展示：以 placeholder id 為 key，只顯示角色名稱', () => {
    const plates = buildNameplates({ ...base, rolesOnlyPrefix: '__placeholder__:' })
    expect(Object.keys(plates)).toEqual(['__placeholder__:cashier', '__placeholder__:customer'])
    expect(plates['__placeholder__:customer']).toEqual({ role: '顧客A', name: '', color: ROLE_COLORS[1], active: true, speaking: false })
  })

  it('scenes without slots show names only', () => {
    const plates = buildNameplates({ ...base, slots: [] })
    expect(plates).toEqual({ amy: { name: '王小明', color: ROLE_COLORS[0], active: true, speaking: false } })
  })
})

describe('layoutNameplates', () => {
  const box = (id: string, x: number, y = 300, w = 100, h = 30) => ({ id, x, y, w, h })

  it('不重疊時不移動', () => {
    expect(layoutNameplates([box('a', 100), box('b', 400)], 1000)).toEqual({ a: { dx: 0, dy: 0 }, b: { dx: 0, dy: 0 } })
  })

  it('靠近時左右各退一半', () => {
    const o = layoutNameplates([box('a', 480), box('b', 520)], 1000)
    // 需要中心距離 100 + 8，原本 40：各退 34
    expect(o).toEqual({ a: { dx: -34, dy: 0 }, b: { dx: 34, dy: 0 } })
  })

  it('幾乎同位置、推到上限還重疊：錨點較高的往上疊', () => {
    const o = layoutNameplates([box('a', 500, 300), box('b', 502, 290)], 1000, { maxShift: 10 })
    expect(o.a.dy).toBe(0)
    expect(o.b.dy).toBeLessThanOrEqual(-(30 + 4 - 10))
  })

  it('不會被推出畫面', () => {
    const o = layoutNameplates([box('a', 20), box('b', 40)], 1000)
    expect(20 + o.a.dx - 50).toBeGreaterThanOrEqual(8)
  })
})
