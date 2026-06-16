import { describe, it, expect } from 'vitest'
import { pickAudioMimeType } from './useTurnAudioRecorder'

describe('pickAudioMimeType', () => {
  it('prefers ogg/opus when supported', () => {
    const isSupported = (t: string) => t === 'audio/ogg;codecs=opus' || t === 'audio/webm;codecs=opus'
    expect(pickAudioMimeType(isSupported)).toBe('audio/ogg;codecs=opus')
  })

  it('falls back to webm/opus when ogg unsupported', () => {
    const isSupported = (t: string) => t === 'audio/webm;codecs=opus'
    expect(pickAudioMimeType(isSupported)).toBe('audio/webm;codecs=opus')
  })

  it('returns empty string when neither supported', () => {
    expect(pickAudioMimeType(() => false)).toBe('')
  })
})
