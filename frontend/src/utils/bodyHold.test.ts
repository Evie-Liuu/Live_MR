import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DOUBLE_FIST_MS, placePropOnBody, stepDoubleFist, type BodyFrame } from './bodyHold.ts';

const hips = new THREE.Vector3(0, 0.85, 0);
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe('stepDoubleFist', () => {
  const timer = () => ({ since: 0, lastAt: 0, armed: true });

  it('雙手握拳維持一段時間才切換一次，鬆開後才能再切換', () => {
    const t = timer();
    expect(stepDoubleFist(t, true, true, 1000)).toBe(false);
    expect(stepDoubleFist(t, true, true, 1000 + DOUBLE_FIST_MS)).toBe(true);
    // 一直握著不會再切換
    expect(stepDoubleFist(t, true, true, 2000)).toBe(false);
    expect(stepDoubleFist(t, true, true, 3000)).toBe(false);
    // 鬆開再握，又可以切換
    expect(stepDoubleFist(t, false, true, 3100)).toBe(false);
    expect(stepDoubleFist(t, true, true, 3200)).toBe(false);
    expect(stepDoubleFist(t, true, true, 3200 + DOUBLE_FIST_MS)).toBe(true);
  });

  it('看得到雙手卻沒握拳 → 計時歸零', () => {
    const t = timer();
    stepDoubleFist(t, true, true, 1000);
    stepDoubleFist(t, false, true, 1100);
    expect(stepDoubleFist(t, true, true, 1000 + DOUBLE_FIST_MS)).toBe(false);
  });

  it('手部資料短暫缺漏不會讓計時歸零', () => {
    const t = timer();
    stepDoubleFist(t, true, true, 1000);
    stepDoubleFist(t, false, false, 1100);
    expect(stepDoubleFist(t, true, true, 1000 + DOUBLE_FIST_MS)).toBe(true);
  });
});

describe('placePropOnBody', () => {
  it('依身體方向換算位移，面向身體正前方，大小依身高縮放', () => {
    const g = new THREE.Group();
    const turned: BodyFrame = { left: v(0, 0, -1), forward: v(1, 0, 0), sizeFactor: 2 };
    placePropOnBody(g, hips, turned, { anchor: 'hips', offset: [0.1, 0.2, 0.3] }, 1.2, 1);
    // 右＝-左＝+Z、前＝+X，位移與大小都 ×2
    expect(g.position.x).toBeCloseTo(0.6);
    expect(g.position.y).toBeCloseTo(1.25);
    expect(g.position.z).toBeCloseTo(0.2);
    expect(g.scale.x).toBeCloseTo(2.4);
    // 道具正面（+Z）轉到身體正前方（+X）
    expect(v(0, 0, 1).applyQuaternion(g.quaternion).x).toBeCloseTo(1);
  });
});
