import { useEffect, useState, useRef } from 'react';

interface PerformanceMonitorProps {
  label?: string;
  trigger?: unknown; // Track updates from a changing prop (e.g. poseData)
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

/**
 * A simple FPS monitor.
 * - If `trigger` is omitted, it measures requestAnimationFrame speed.
 * - If `trigger` is provided, it measures the frequency of `trigger` updates.
 */
export default function PerformanceMonitor({
  label = 'FPS',
  trigger,
  position = 'top-left',
}: PerformanceMonitorProps) {
  const [fps, setFps] = useState(0);
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(performance.now());

  useEffect(() => {
    let rafId: number;
    let cancelled = false;

    if (trigger === undefined) {
      // Loop tracking requestAnimationFrame
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
    }
  }, [trigger]);

  // Track manual updates if trigger is defined
  useEffect(() => {
    if (trigger !== undefined) {
      const now = performance.now();
      frameCountRef.current++;
      if (now - lastTimeRef.current >= 1000) {
        setFps(Math.round((frameCountRef.current * 1000) / (now - lastTimeRef.current)));
        frameCountRef.current = 0;
        lastTimeRef.current = now;
      }
    }
  }, [trigger]);

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
