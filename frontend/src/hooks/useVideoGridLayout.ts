import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { computeVideoGridLayout } from '../utils/videoGridLayout';

/** 須與 .hs-grid 的 gap 一致 */
const GRID_GAP = 12;

/**
 * 量測影像區大小，依人數回傳平均分配的 grid 樣式。
 * enabled 為 false 時（例如大屏預覽的精簡列）不回傳樣式，交給 CSS 排版。
 */
export function useVideoGridLayout(count: number, enabled: boolean) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const gridRef = useCallback((node: HTMLDivElement | null) => setEl(node), []);

  useEffect(() => {
    if (!el) return;
    const measure = () => {
      const next = { width: el.clientWidth, height: el.clientHeight };
      setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  const gridStyle = useMemo<CSSProperties | undefined>(() => {
    if (!enabled || size.width === 0 || size.height === 0) return undefined;
    const { cols, rows, rowHeight } = computeVideoGridLayout({ count, ...size, gap: GRID_GAP });
    return {
      gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      gridTemplateRows: rowHeight === null ? `repeat(${rows}, minmax(0, 1fr))` : `repeat(${rows}, ${rowHeight}px)`,
    };
  }, [enabled, count, size]);

  return { gridRef, gridStyle };
}
