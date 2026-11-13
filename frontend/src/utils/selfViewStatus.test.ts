import { describe, expect, it } from 'vitest';
import { coverRect, selfViewStatus } from './selfViewStatus.ts';
import type { PoseLandmark } from '../types/vrm.ts';

/** 33 個點都看得到，再把指定編號設成看不到 */
function pose(hidden: number[] = []): PoseLandmark[] {
  return Array.from({ length: 33 }, (_, i) => ({ x: 0.5, y: 0.5, z: 0, visibility: hidden.includes(i) ? 0.1 : 0.9 }));
}

describe('selfViewStatus', () => {
  it('沒有姿勢或過時 → 沒偵測到人', () => {
    expect(selfViewStatus(undefined, false).level).toBe('lost');
    expect(selfViewStatus(pose(), true).level).toBe('lost');
  });

  it('全身關鍵點都在 → 追蹤良好', () => {
    expect(selfViewStatus(pose(), false)).toEqual({ level: 'ok', text: '追蹤良好' });
  });

  it('依序提示：臉 → 肩膀 → 手', () => {
    expect(selfViewStatus(pose([0, 15]), false).text).toContain('臉');
    expect(selfViewStatus(pose([12, 15]), false).text).toContain('肩膀');
    expect(selfViewStatus(pose([15, 16]), false).text).toBe('看不到雙手，手勢不會同步');
    expect(selfViewStatus(pose([15]), false).text).toBe('看不到左手');
    expect(selfViewStatus(pose([16]), false).text).toBe('看不到右手');
  });
});

describe('coverRect', () => {
  it('較寬的容器：上下裁切，影像置中', () => {
    expect(coverRect(400, 200, 640, 480)).toEqual({ left: 0, top: -50, width: 400, height: 300 });
  });

  it('較高的容器：左右裁切', () => {
    expect(coverRect(300, 300, 640, 480)).toEqual({ left: -50, top: 0, width: 400, height: 300 });
  });

  it('尺寸未知時回傳整個容器', () => {
    expect(coverRect(300, 200, 0, 0)).toEqual({ left: 0, top: 0, width: 300, height: 200 });
  });
});
