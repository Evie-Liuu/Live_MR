import { describe, it, expect } from 'vitest'
import { extractRoomId } from './qrRoomId'

describe('extractRoomId', () => {
  it('extracts roomId from a join URL', () => {
    expect(extractRoomId('https://example.com/?roomId=abc-123')).toBe('abc-123')
  })

  it('extracts roomId when the URL has other query params too', () => {
    expect(extractRoomId('https://example.com/?screen=share&roomId=abc-123')).toBe('abc-123')
  })

  it('returns null for a valid URL with no roomId param', () => {
    expect(extractRoomId('https://example.com/')).toBeNull()
  })

  it('treats non-URL text as a raw room ID', () => {
    expect(extractRoomId('ROOM-4567')).toBe('ROOM-4567')
  })

  it('returns null for empty/whitespace input', () => {
    expect(extractRoomId('   ')).toBeNull()
    expect(extractRoomId('')).toBeNull()
  })
})

describe('room code helpers', () => {
  it('normalizes typed 6-digit codes with spaces or dashes', async () => {
    const { normalizeRoomId } = await import('./qrRoomId')
    expect(normalizeRoomId(' 482 913 ')).toBe('482913')
    expect(normalizeRoomId('482-913')).toBe('482913')
    expect(normalizeRoomId('39a3841e-a589-4b3d')).toBe('39a3841e-a589-4b3d')
  })

  it('formats 6-digit codes as two groups and leaves other ids unchanged', async () => {
    const { formatRoomId } = await import('./qrRoomId')
    expect(formatRoomId('482913')).toBe('482 913')
    expect(formatRoomId('39a3841e-a589')).toBe('39a3841e-a589')
  })

  it('normalizes codes taken from a QR / join URL', () => {
    expect(extractRoomId('https://example.com/?roomId=482913')).toBe('482913')
    expect(extractRoomId('482 913')).toBe('482913')
  })
})

describe('joinErrorText', () => {
  it('explains common join failures in plain language', async () => {
    const { joinErrorText } = await import('./qrRoomId')
    expect(joinErrorText(new Error('joinRequest failed: 404'))).toContain('找不到這個房號')
    expect(joinErrorText(new TypeError('Failed to fetch'))).toContain('連不上伺服器')
  })
})
