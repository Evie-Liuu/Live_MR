import { describe, it, expect } from 'vitest';
import { handSides } from './handSides.ts';

/** 33 點姿態，只設左右手腕 */
function pose(left: [number, number], right: [number, number]) {
  const p = Array.from({ length: 33 }, () => ({ x: 0, y: 0 }));
  p[15] = { x: left[0], y: left[1] };
  p[16] = { x: right[0], y: right[1] };
  return p;
}
const hand = (x: number, y: number) => [{ x, y }];

describe('handSides', () => {
  // 未翻轉的鏡頭：本人左手腕在畫面右側
  const p = pose([0.7, 0.5], [0.3, 0.5]);

  it('依手腕離哪個姿態手腕近判斷左右，不管標籤', () => {
    expect(handSides([hand(0.72, 0.5)], ['Left'], p)).toEqual(['left']);
    expect(handSides([hand(0.28, 0.5)], ['Right'], p)).toEqual(['right']);
  });

  it('兩隻手都靠近同一邊時，比較偏左程度分配', () => {
    expect(handSides([hand(0.55, 0.5), hand(0.6, 0.5)], ['Left', 'Right'], p)).toEqual(['right', 'left']);
  });

  it('沒有姿態骨架時退回標籤（Left＝本人右手）', () => {
    expect(handSides([hand(0.5, 0.5), hand(0.5, 0.5)], ['Left', 'Right'], undefined)).toEqual(['right', 'left']);
    expect(handSides([hand(0.5, 0.5)], ['?'], [])).toEqual([null]);
  });
});
