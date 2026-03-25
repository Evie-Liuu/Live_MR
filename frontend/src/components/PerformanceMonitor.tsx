import { useEffect, useState, useRef } from 'react';

interface PerformanceMonitorProps {
  label?: string;
  /**
   * Legacy trigger mode: FPS = number of trigger-changes per second.
   * Works when each change represents exactly one event.
   */
  trigger?: unknown;
  /**
   * Count mode: pass an ever-increasing counter.
   * FPS is computed as (countΔ / elapsedΔ) — accurate even when the
   * state driving this prop is throttled (e.g. updated every 250 ms).
   */
  count?: number;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

/**
 * A simple FPS monitor.
 * - No props → measures requestAnimationFrame throughput.
 * - `trigger` → measures frequency of trigger changes (legacy).
 * - `count`   → computes rate from a monotonic counter (preferred).
 */
export default function PerformanceMonitor({
  label = 'FPS',
  trigger,
  count,
  position = 'top-left',
}: PerformanceMonitorProps) {
  const [fps, setFps] = useState(0);
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(performance.now());
  const lastCountRef = useRef(count ?? 0);

  // ── Mode 1: rAF throughput (no trigger / no count) ──
  useEffect(() => {
    if (trigger !== undefined || count !== undefined) return;

    let rafId: number;
    let cancelled = false;

    const loop = () => {
      if (cancelled) return;
      const now = performance.now();
      frameCountRef.current++;
      if (now - lastTimeRef.current >= 1000) {
        setFps(Math.round((frameCountRef.current * 1000) / (now - lastTimeRef.current)));
        frameCountRef.current = 0;
        lastTimeRef.current = now;
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [trigger, count]);

  // ── Mode 2: count-based rate (preferred for throttled state) ──
  useEffect(() => {
    if (count === undefined) return;
    const now = performance.now();
    const elapsed = now - lastTimeRef.current;
    if (elapsed >= 1000) {
      const delta = count - lastCountRef.current;
      setFps(Math.round((delta * 1000) / elapsed));
      lastCountRef.current = count;
      lastTimeRef.current = now;
    }
  }, [count]);

  // ── Mode 3: legacy trigger-change counter ──
  useEffect(() => {
    if (trigger === undefined || count !== undefined) return;
    const now = performance.now();
    frameCountRef.current++;
    if (now - lastTimeRef.current >= 1000) {
      setFps(Math.round((frameCountRef.current * 1000) / (now - lastTimeRef.current)));
      frameCountRef.current = 0;
      lastTimeRef.current = now;
    }
  }, [trigger, count]);

  const posStyles: React.CSSProperties = {
    position: 'absolute',
    background: 'rgba(0, 0, 0, 0.7)',
    color: '#0f0',
    padding: '4px 8px',
    borderRadius: '4px',
    fontFamily: 'monospace',
    fontSize: '12px',
    zIndex: 9999,
    pointerEvents: 'none',
  };

  if (position.includes('top')) posStyles.top = 10;
  if (position.includes('bottom')) posStyles.bottom = 10;
  if (position.includes('left')) posStyles.left = 10;
  if (position.includes('right')) posStyles.right = 10;

  return (
    <div className="perf-monitor" style={posStyles}>
      {label}: <span style={{ fontWeight: 'bold' }}>{fps}</span>
    </div>
  );
}
