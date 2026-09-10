import { describe, it, expect } from 'vitest'
import { resolveAuthRoute } from './state'

describe('resolveAuthRoute', () => {
  it('routes teacher to teacher-home regardless of pendingRoomId', () => {
    expect(resolveAuthRoute('teacher', 'room-123')).toEqual({ action: 'teacher-home' })
    expect(resolveAuthRoute('teacher', null)).toEqual({ action: 'teacher-home' })
  })

  it('routes admin and institution_admin to host', () => {
    expect(resolveAuthRoute('admin', null)).toEqual({ action: 'teacher-home' })
    expect(resolveAuthRoute('institution_admin', null)).toEqual({ action: 'teacher-home' })
  })

  it('routes student with a pending roomId to auto-join', () => {
    expect(resolveAuthRoute('student', 'room-123')).toEqual({ action: 'auto-join', roomId: 'room-123' })
  })

  it('routes student with no pending roomId to student-home', () => {
    expect(resolveAuthRoute('student', null)).toEqual({ action: 'student-home' })
  })

  it('treats visitor the same as student', () => {
    expect(resolveAuthRoute('visitor', 'room-456')).toEqual({ action: 'auto-join', roomId: 'room-456' })
    expect(resolveAuthRoute('visitor', null)).toEqual({ action: 'student-home' })
  })
})
