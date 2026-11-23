import { describe, it, expect } from 'vitest'
import { wavLevel } from './audioLevel.js'
import { judgeTurn, SILENCE_MODEL } from './speechJudge.js'

/** 16 kHz 單聲道 16-bit WAV：前 silentSec 秒靜音，接著 toneSec 秒 440 Hz、振幅 amp */
function wav(silentSec: number, toneSec: number, amp: number): string {
  const rate = 16000
  const n = Math.round((silentSec + toneSec) * rate)
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0, 'ascii'); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii'); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 'ascii'); buf.writeUInt32LE(n * 2, 40)
  const silentN = Math.round(silentSec * rate)
  for (let i = silentN; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * amp * 32767), 44 + i * 2)
  return buf.toString('base64')
}

describe('wavLevel', () => {
  it('全靜音：peak 0、沒有說話秒數', () => {
    expect(wavLevel(wav(3, 0, 0))).toEqual({ peak: 0, voicedSeconds: 0 })
  })
  it('有聲音的段落算進說話秒數', () => {
    const l = wavLevel(wav(1, 1.5, 0.3))!
    expect(l.peak).toBeGreaterThan(0.29)
    expect(l.voicedSeconds).toBeCloseTo(1.5, 1)
  })
  it('很小的底噪不算說話', () => {
    expect(wavLevel(wav(0, 3, 0.005))!.voicedSeconds).toBe(0)
  })
  it('不是 WAV 回 null', () => {
    expect(wavLevel(Buffer.from('hello world, not a wav file at all.......').toString('base64'))).toBeNull()
  })
})

describe('judgeTurn 靜音', () => {
  it('沒有說話聲：不呼叫模型，直接判沒有回應', async () => {
    const r = await judgeTurn({
      line: { en: 'Nice to meet you.', zh: '很高興認識你。' }, level: 'A1',
      audio: { data: wav(3, 0, 0), mimeType: 'audio/wav' }, models: ['no-such-model'],
    })
    expect(r.model).toBe(SILENCE_MODEL)
    expect(r.judgment).toMatchObject({ transcript: '', language: 'silent', issues: ['noResponse'], severity: 'severe' })
  })
})
