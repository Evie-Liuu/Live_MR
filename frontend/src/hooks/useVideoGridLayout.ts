import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { computeVideoGridLayout } from '../utils/videoGridLayout';

/** 須與 .hs-grid 的 gap 一致 */
const GRID_GAP = 12;

/**
 * 量測影像區大小，依人數回傳平均分配的 grid 樣式。
 * enabled 為 false 時（例如大屏預覽的精簡列）不回傳樣式，交給 CSS 排版。
 * featured 為 true 時第一格（教師自己）放大；featuredStyle 要套在那一格上。
 */
export function useVideoGridLayout(count: number, enabled: boolean, featured = false) {
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

  const { gridStyle, featuredStyle } = useMemo<{
    gridStyle?: CSSProperties;
    featuredStyle?: CSSProperties;
  }>(() => {
    if (!enabled || size.width === 0 || size.height === 0) return {};
    const { cols, rows, rowHeight, featuredSpan } = computeVideoGridLayout({ count, ...size, gap: GRID_GAP, featured });
    return {
      gridStyle: {
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: rowHeight === null ? `repeat(${rows}, minmax(0, 1fr))` : `repeat(${rows}, ${rowHeight}px)`,
      },
      featuredStyle: featuredSpan > 1
        ? { gridColumn: `span ${featuredSpan}`, gridRow: `span ${featuredSpan}` }
        : undefined,
    };
  }, [enabled, count, size, featured]);

  return { gridRef, gridStyle, featuredStyle };
}
