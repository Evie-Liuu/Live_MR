import { describe, it, expect } from 'vitest';
import { downsample, encodeWav, joinTail, toBase64 } from './wav.ts';

describe('wav', () => {
  it('48 kHz 降到 16 kHz 長度變成三分之一', () => {
    const input = new Float32Array(4800).map((_, i) => Math.sin(i / 10));
    expect(downsample(input, 48000).length).toBe(1600);
    expect(downsample(input, 16000)).toBe(input);
  });

  it('WAV 標頭正確、樣本轉成 16-bit 並截在 ±1', () => {
    const bytes = encodeWav(new Float32Array([0, 1, -1, 2]));
    const view = new DataView(bytes.buffer);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe('WAVE');
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(40, true)).toBe(8);
    expect([0, 1, 2, 3].map(i => view.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767]);
  });

  it('只留最後 N 個樣本', () => {
    const out = joinTail([new Float32Array([1, 2, 3]), new Float32Array([4, 5])], 3);
    expect([...out]).toEqual([3, 4, 5]);
    expect([...joinTail([new Float32Array([1, 2])], 10)]).toEqual([1, 2]);
  });

  it('base64 與 btoa 結果一致', () => {
    expect(toBase64(new Uint8Array([82, 73, 70, 70]))).toBe('UklGRg==');
  });
});
