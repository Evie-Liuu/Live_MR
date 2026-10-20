import { describe, it, expect } from 'vitest'
import { PENDING_ROOM_STORAGE_KEY, readPendingRoomId, resolveAuthRoute } from './state'

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

describe('readPendingRoomId', () => {
  const memory = () => {
    const data: Record<string, string> = {}
    return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v }, data }
  }

  it('takes the room from the QR / join URL (normalized) and remembers it', () => {
    const storage = memory()
    expect(readPendingRoomId('?roomId=482%20913', storage)).toBe('482913')
    expect(storage.data[PENDING_ROOM_STORAGE_KEY]).toBe('482913')
  })

  it('falls back to the remembered room after a refresh cleared the URL', () => {
    const storage = memory()
    readPendingRoomId('?roomId=482913', storage)
    expect(readPendingRoomId('', storage)).toBe('482913')
  })

  it('returns null without a URL room or remembered room, and works without storage', () => {
    expect(readPendingRoomId('', memory())).toBeNull()
    expect(readPendingRoomId('?roomId=123456', null)).toBe('123456')
  })
})
