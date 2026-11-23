/**
 * 把麥克風的 PCM（Float32、瀏覽器的取樣率）轉成 16 kHz 單聲道 16-bit WAV。
 * 用 WAV 而不用 MediaRecorder：iPad Safari 只錄得出 mp4、Chrome 是 webm，Gemini 對 WAV 支援最穩，
 * 16 kHz 也是語音模型實際使用的取樣率，檔案小（每秒 32 KB）。
 */
export const WAV_SAMPLE_RATE = 16000;

/** 線性內插降取樣（語音用夠了） */
export function downsample(input: Float32Array, fromRate: number, toRate = WAV_SAMPLE_RATE): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    out[i] = input[i0] + (input[i1] - input[i0]) * (pos - i0);
  }
  return out;
}

export function encodeWav(samples: Float32Array, sampleRate = WAV_SAMPLE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, s: string) => { for (let i = 0; i < s.length; i++) bytes[offset + i] = s.charCodeAt(i); };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** 把多段 Float32 接起來，只留最後 maxSamples 個 */
export function joinTail(chunks: readonly Float32Array[], maxSamples: number): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const length = Math.min(total, maxSamples);
  const out = new Float32Array(length);
  let skip = total - length;
  let offset = 0;
  for (const c of chunks) {
    if (skip >= c.length) { skip -= c.length; continue; }
    const part = skip > 0 ? c.subarray(skip) : c;
    skip = 0;
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** 一個音框（20 ms）的音量（RMS）達到這個值才算有聲音；開了降噪的安靜環境約 0.001–0.005，說話約 0.03 以上 */
export const VOICE_RMS = 0.01;
/** 有聲音的音框加起來至少這麼多秒，才算學生有開口（低於這個值不送 AI，避免模型把台詞當成聽到的內容） */
export const MIN_VOICED_SECONDS = 0.3;

export interface AudioLevelStats {
  /** 最大振幅（0 表示錄到的全是 0：麥克風沒有把聲音送進來） */
  peak: number;
  /** 有聲音的音框總秒數 */
  voicedSeconds: number;
}

export function audioLevelStats(samples: Float32Array, sampleRate: number): AudioLevelStats {
  const frame = Math.max(1, Math.round(sampleRate * 0.02));
  let peak = 0;
  let voicedFrames = 0;
  for (let start = 0; start < samples.length; start += frame) {
    const end = Math.min(samples.length, start + frame);
    let sum = 0;
    for (let i = start; i < end; i++) {
      const v = samples[i];
      sum += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    if (Math.sqrt(sum / (end - start)) >= VOICE_RMS) voicedFrames += 1;
  }
  return { peak, voicedSeconds: (voicedFrames * frame) / sampleRate };
}

/** 一段 PCM 的 RMS 音量（即時音量條用） */
export function rmsOf(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}
