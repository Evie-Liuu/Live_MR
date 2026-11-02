import { describe, expect, it } from 'vitest';
import { computeVideoGridLayout, MIN_TILE_WIDTH } from './videoGridLayout';

const area = { width: 1400, height: 800, gap: 12 };

describe('computeVideoGridLayout', () => {
  it('四人以內最大只到 2×2 的一格', () => {
    for (const count of [1, 2, 3, 4]) {
      expect(computeVideoGridLayout({ ...area, count })).toEqual({ cols: 2, rows: 2, rowHeight: null });
    }
  });

  it('人數增加時欄列跟著增加，且格子數足夠', () => {
    for (const count of [3, 4, 6, 9, 12, 16]) {
      const { cols, rows, rowHeight } = computeVideoGridLayout({ ...area, count });
      expect(cols * rows).toBeGreaterThanOrEqual(count);
      expect(rowHeight).toBeNull();
    }
    expect(computeVideoGridLayout({ ...area, count: 4 })).toEqual({ cols: 2, rows: 2, rowHeight: null });
  });

  it('窄高區域改為直向堆疊', () => {
    const { cols, rows } = computeVideoGridLayout({ width: 400, height: 1200, gap: 12, count: 3 });
    expect(cols).toBe(1);
    expect(rows).toBe(3);
  });

  it('放不下時固定列高並捲動，格子不小於最小寬度', () => {
    const width = 1000;
    const { cols, rows, rowHeight } = computeVideoGridLayout({ width, height: 400, gap: 12, count: 30 });
    expect(rowHeight).not.toBeNull();
    expect((width - 12 * (cols - 1)) / cols).toBeGreaterThanOrEqual(MIN_TILE_WIDTH);
    expect(cols * rows).toBeGreaterThanOrEqual(30);
  });

  it('沒有人或區域尚未量到時不會出錯', () => {
    expect(computeVideoGridLayout({ ...area, count: 0 }).cols).toBe(1);
    expect(computeVideoGridLayout({ count: 5, width: 0, height: 0, gap: 12 }).cols).toBe(1);
  });
});
