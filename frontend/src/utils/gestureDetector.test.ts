import { describe, expect, it } from 'vitest';
import { FIST_HAND_GAP_MS, shouldResetFistTimer } from './gestureDetector';

describe('shouldResetFistTimer', () => {
  it('有手部資料但不是握拳：立刻歸零', () => {
    expect(shouldResetFistTimer(true, 1000, 990)).toBe(true);
  });

  it('沒有手部資料的影格（手部隔格才偵測）：不歸零', () => {
    expect(shouldResetFistTimer(false, 1033, 1000)).toBe(false);
    // 省電模式每 4 格才偵測一次
    expect(shouldResetFistTimer(false, 1133, 1000)).toBe(false);
  });

  it('太久沒有手部資料：當作手不見了，歸零', () => {
    expect(shouldResetFistTimer(false, 1000 + FIST_HAND_GAP_MS + 1, 1000)).toBe(true);
  });
});
