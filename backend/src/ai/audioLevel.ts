/**
 * 檢查 16-bit PCM WAV 裡有沒有說話聲（與前端 utils/wav.ts 的門檻相同）。
 * 沒有說話聲時不送模型：實測模型聽到靜音時，可能把提示詞裡的台詞當成學生說的內容，判成「正確」。
 */

/** 一個音框（20 ms）的 RMS 達到這個值才算有聲音（滿刻度 = 1） */
export const VOICE_RMS = 0.01
/** 有聲音的音框加起來至少這麼多秒才算有開口 */
export const MIN_VOICED_SECONDS = 0.3

export interface WavLevel {
  peak: number
  voicedSeconds: number
}

/** 解析 base64 WAV；不是 16-bit PCM 或格式不對時回 null（交給模型判斷） */
export function wavLevel(base64: string): WavLevel | null {
  const buf = Buffer.from(base64, 'base64')
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null
  let offset = 12
  let sampleRate = 0
  let channels = 0
  let bits = 0
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ' && body + 16 <= buf.length) {
      if (buf.readUInt16LE(body) !== 1) return null
      channels = buf.readUInt16LE(body + 2)
      sampleRate = buf.readUInt32LE(body + 4)
      bits = buf.readUInt16LE(body + 14)
    } else if (id === 'data') {
      if (bits !== 16 || channels < 1 || sampleRate <= 0) return null
      const end = Math.min(buf.length, body + size)
      const step = 2 * channels
      const frameSamples = Math.max(1, Math.round(sampleRate * 0.02))
      let peak = 0
      let voicedFrames = 0
      let sum = 0
      let n = 0
      for (let i = body; i + 1 < end; i += step) {
        const v = buf.readInt16LE(i) / 32768
        const a = Math.abs(v)
        if (a > peak) peak = a
        sum += v * v
        n += 1
        if (n === frameSamples) {
          if (Math.sqrt(sum / n) >= VOICE_RMS) voicedFrames += 1
          sum = 0
          n = 0
        }
      }
      if (n > 0 && Math.sqrt(sum / n) >= VOICE_RMS) voicedFrames += 1
      return { peak, voicedSeconds: (voicedFrames * frameSamples) / sampleRate }
    }
    offset = body + size + (size % 2)
  }
  return null
}
