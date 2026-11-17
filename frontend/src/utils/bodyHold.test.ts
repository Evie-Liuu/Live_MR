import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { isHandAtAnchor, placePropOnBody, type BodyFrame } from './bodyHold.ts';

/** 面向 +Z 的標準身高角色（左方是 +X） */
const body: BodyFrame = { left: new THREE.Vector3(1, 0, 0), forward: new THREE.Vector3(0, 0, 1), sizeFactor: 1 };
const hips = new THREE.Vector3(0, 0.85, 0);
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe('isHandAtAnchor', () => {
  it('手在腰前（中線附近）才算，手垂在身體兩側不算', () => {
    expect(isHandAtAnchor(v(0.05, 0.85, 0.15), hips, 'hips', body, false)).toBe(true);
    expect(isHandAtAnchor(v(0.22, 0.8, 0), hips, 'hips', body, false)).toBe(false);
    expect(isHandAtAnchor(v(0, 1.3, 0.15), hips, 'hips', body, false)).toBe(false);
  });

  it('已經貼上時範圍放寬，手要明顯移開才拿回手上', () => {
    const edge = v(0.17, 0.85, 0.1);
    expect(isHandAtAnchor(edge, hips, 'hips', body, false)).toBe(false);
    expect(isHandAtAnchor(edge, hips, 'hips', body, true)).toBe(true);
    expect(isHandAtAnchor(v(0.3, 0.85, 0.1), hips, 'hips', body, true)).toBe(false);
  });

  it('帽子：手要在頭頂上方', () => {
    const head = v(0, 1.4, 0);
    expect(isHandAtAnchor(v(0.05, 1.6, 0), head, 'head', body, false)).toBe(true);
    expect(isHandAtAnchor(v(0.05, 1.3, 0.1), head, 'head', body, false)).toBe(false);
  });

  it('左右距離以角色的左右為準：轉 90 度時看 Z 軸', () => {
    const turned = { left: v(0, 0, -1), sizeFactor: 1 };
    expect(isHandAtAnchor(v(0.15, 0.85, 0.05), hips, 'hips', turned, false)).toBe(true);
    expect(isHandAtAnchor(v(0, 0.85, 0.22), hips, 'hips', turned, false)).toBe(false);
  });

  it('小個子角色範圍跟著縮小', () => {
    const small = { ...body, sizeFactor: 0.5 };
    const smallHips = v(0, 0.425, 0);
    expect(isHandAtAnchor(v(0.1, 0.425, 0.05), smallHips, 'hips', small, false)).toBe(false);
    expect(isHandAtAnchor(v(0.05, 0.425, 0.05), smallHips, 'hips', small, false)).toBe(true);
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
