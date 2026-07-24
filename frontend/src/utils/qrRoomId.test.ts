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
