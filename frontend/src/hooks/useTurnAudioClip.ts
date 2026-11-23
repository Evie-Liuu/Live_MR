import { useCallback, useEffect, useRef } from 'react';
import { MAX_CLIP_SECONDS } from '../utils/speechAssist.ts';
import { WAV_SAMPLE_RATE, audioLevelStats, downsample, encodeWav, joinTail, rmsOf, toBase64, type AudioLevelStats } from '../utils/wav.ts';

export interface AudioClip extends AudioLevelStats {
  /** base64 的 16 kHz 單聲道 WAV */
  data: string;
  seconds: number;
}

/**
 * 輪到自己發言時錄下麥克風（LiveKit 已發布的那條音軌，不另外開麥克風），
 * clip() 取出這一句開始到現在的錄音（最多 MAX_CLIP_SECONDS 秒）。
 * resetKey 改變（換句）時清空重錄；enabled 為 false 時停止並釋放音訊資源。
 *
 * 用 ScriptProcessorNode：雖然已不建議使用，但 iPad Safari 與 Chrome 都支援，
 * 不必另外載入 AudioWorklet 模組檔。
 */
export function useTurnAudioClip(
  enabled: boolean,
  resetKey: number | null,
  getMicTrack: () => MediaStreamTrack | null,
): { clip: () => AudioClip | null; level: () => number } {
  const chunksRef = useRef<Float32Array[]>([]);
  const samplesRef = useRef(0);
  const rateRef = useRef(48000);
  /** 最近一段的音量（RMS） */
  const levelRef = useRef(0);
  const getTrackRef = useRef(getMicTrack);
  useEffect(() => { getTrackRef.current = getMicTrack; }, [getMicTrack]);

  useEffect(() => {
    chunksRef.current = [];
    samplesRef.current = 0;
  }, [resetKey]);

  useEffect(() => {
    if (!enabled) return;
    let ctx: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let node: ScriptProcessorNode | null = null;
    let sink: GainNode | null = null;
    let retry: number | null = null;
    let stopped = false;
    let unlock: (() => void) | null = null;

    const start = () => {
      const track = getTrackRef.current();
      // 麥克風還沒發布（剛連上）：稍後再試
      if (!track || track.readyState !== 'live') {
        retry = window.setTimeout(start, 1000);
        return;
      }
      try {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctx = new Ctor();
        rateRef.current = ctx.sampleRate;
        source = ctx.createMediaStreamSource(new MediaStream([track]));
        node = ctx.createScriptProcessor(4096, 1, 1);
        // 不能直接接到 destination（會把自己的聲音放出來），接一個音量 0 的節點讓處理器持續運作
        sink = ctx.createGain();
        sink.gain.value = 0;
        const maxSamples = MAX_CLIP_SECONDS * ctx.sampleRate;
        node.onaudioprocess = e => {
          if (stopped) return;
          const data = new Float32Array(e.inputBuffer.getChannelData(0));
          levelRef.current = rmsOf(data);
          chunksRef.current.push(data);
          samplesRef.current += data.length;
          // 超過上限就丟掉最舊的片段（保留一點餘裕）
          while (samplesRef.current - chunksRef.current[0].length > maxSamples) {
            samplesRef.current -= chunksRef.current.shift()!.length;
          }
        };
        source.connect(node);
        node.connect(sink);
        sink.connect(ctx.destination);
        // iPad 上不是在點擊當下建立的 AudioContext 可能停在 suspended：先試著恢復，不行就等下一次觸碰畫面再恢復
        const c = ctx;
        void c.resume().catch(() => { /* ignore */ });
        if (c.state === 'suspended') {
          unlock = () => {
            void c.resume().catch(() => { /* ignore */ });
            if (c.state !== 'suspended' && unlock) {
              window.removeEventListener('pointerdown', unlock, true);
              window.removeEventListener('touchend', unlock, true);
              unlock = null;
            }
          };
          window.addEventListener('pointerdown', unlock, true);
          window.addEventListener('touchend', unlock, true);
        }
      } catch {
        /* 不支援：不錄音，口說判斷就不會觸發 */
      }
    };
    start();

    return () => {
      stopped = true;
      if (retry !== null) window.clearTimeout(retry);
      if (unlock) {
        window.removeEventListener('pointerdown', unlock, true);
        window.removeEventListener('touchend', unlock, true);
      }
      levelRef.current = 0;
      try { source?.disconnect(); node?.disconnect(); sink?.disconnect(); } catch { /* ignore */ }
      if (node) node.onaudioprocess = null;
      void ctx?.close().catch(() => { /* ignore */ });
    };
  }, [enabled]);

  const clip = useCallback((): AudioClip | null => {
    if (samplesRef.current === 0) return null;
    const rate = rateRef.current;
    const pcm = joinTail(chunksRef.current, MAX_CLIP_SECONDS * rate);
    const samples = downsample(pcm, rate, WAV_SAMPLE_RATE);
    return {
      data: toBase64(encodeWav(samples)),
      seconds: samples.length / WAV_SAMPLE_RATE,
      ...audioLevelStats(samples, WAV_SAMPLE_RATE),
    };
  }, []);

  const level = useCallback(() => levelRef.current, []);

  return { clip, level };
}
