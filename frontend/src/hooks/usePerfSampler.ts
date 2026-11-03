import { useCallback, useEffect, useRef, useState } from 'react';
import { flushPerfMetrics, perfCount, perfGauge, perfValue, setPerfEnabled } from '../utils/perfRecorder';

/** 教師端記錄中每隔這麼久重送一次訊號，讓晚進來或重連的裝置也開始記錄 */
export const PERF_HEARTBEAT_MS = 5000;
/** 超過這麼久沒收到訊號就自行停止（例如教師端關掉了） */
const PERF_FOLLOWER_TIMEOUT_MS = 15000;

/**
 * 記錄期間每隔 intervalMs 輸出一筆指標。這個視窗本身的主執行緒狀況在這裡量：
 * - raf / frameGapMs：頁面實際更新的頻率與最長間隔
 * - longTask：超過 50ms 的卡頓（Safari 不支援，iPad 上不會有這項）
 * - heapMb：JS 記憶體（只有 Chromium 有）
 */
export function usePerfSampler(
  enabled: boolean,
  intervalMs: number,
  onSample: (metrics: Record<string, number>) => void,
  collect?: () => void,
): void {
  const onSampleRef = useRef(onSample);
  const collectRef = useRef(collect);
  useEffect(() => {
    onSampleRef.current = onSample;
    collectRef.current = collect;
  });

  useEffect(() => {
    if (!enabled) return;
    setPerfEnabled(true);

    let rafId = 0;
    let lastFrame = performance.now();
    const onFrame = (now: number) => {
      perfCount('raf');
      perfValue('frameGapMs', now - lastFrame);
      lastFrame = now;
      rafId = requestAnimationFrame(onFrame);
    };
    rafId = requestAnimationFrame(onFrame);

    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          perfCount('longTask');
          perfValue('longTaskMs', entry.duration);
        }
      });
      observer.observe({ type: 'longtask' });
    } catch {
      observer = null; // Safari 不支援 longtask
    }

    let lastSample = performance.now();
    const sample = () => {
      const now = performance.now();
      const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      if (memory) perfGauge('heapMb', memory.usedJSHeapSize / 1048576);
      perfGauge('hidden', document.hidden ? 1 : 0);
      collectRef.current?.();
      onSampleRef.current(flushPerfMetrics(now - lastSample));
      lastSample = now;
    };
    const timer = window.setInterval(sample, intervalMs);

    return () => {
      window.clearInterval(timer);
      cancelAnimationFrame(rafId);
      observer?.disconnect();
      sample(); // 最後不足一個週期的部分也送出
      setPerfEnabled(false);
    };
  }, [enabled, intervalMs]);
}

/**
 * 學生平板、大屏用：跟著教師端的訊號開始／停止記錄，回傳收到訊號時要呼叫的函式。
 * 太久沒收到訊號會自行停止，避免教師端關掉後還一直記錄。
 */
export function usePerfFollower(
  intervalMs: number,
  onSample: (metrics: Record<string, number>) => void,
  collect?: () => void,
): (active: boolean) => void {
  const [recording, setRecording] = useState(false);
  const watchdogRef = useRef(0);

  const onRecordSignal = useCallback((active: boolean) => {
    window.clearTimeout(watchdogRef.current);
    setRecording(active);
    if (active) watchdogRef.current = window.setTimeout(() => setRecording(false), PERF_FOLLOWER_TIMEOUT_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(watchdogRef.current), []);

  usePerfSampler(recording, intervalMs, onSample, collect);
  return onRecordSignal;
}
