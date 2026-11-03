import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { attachPropToHand } from './propInteraction';

/** 面向 +Z 的假角色：左肩在 +X；turn 可把整個角色繞 Y 軸轉 */
function fakeVrm(turn = 0): VRM {
  const root = new THREE.Group();
  root.rotation.y = turn;
  const bone = (x: number, y: number) => {
    const o = new THREE.Object3D();
    o.position.set(x, y, 0);
    root.add(o);
    return o;
  };
  const bones: Record<string, THREE.Object3D> = {
    leftUpperArm: bone(0.2, 1.4),
    rightUpperArm: bone(-0.2, 1.4),
    leftHand: bone(0.3, 1.6),
    rightHand: bone(-0.3, 1.6),
  };
  return { humanoid: { getNormalizedBoneNode: (name: string) => bones[name] ?? null } } as unknown as VRM;
}

const NO_OFFSET: [number, number, number] = [0, 0, 0];

describe('attachPropToHand sideOffset', () => {
  it('沒設定時道具就在手的位置', () => {
    const prop = new THREE.Group();
    attachPropToHand(prop, fakeVrm(), 'right', true, undefined, NO_OFFSET);
    expect(prop.position.x).toBeCloseTo(0.3);
    expect(prop.position.y).toBeCloseTo(1.6);
  });

  it('往這隻手那一側的外側偏移（本人右手對應 VRM 左手，兩邊鏡像）', () => {
    const prop = new THREE.Group();
    attachPropToHand(prop, fakeVrm(), 'right', true, 0.2, NO_OFFSET);
    expect(prop.position.x).toBeCloseTo(0.5);
    attachPropToHand(prop, fakeVrm(), 'left', true, 0.2, NO_OFFSET);
    expect(prop.position.x).toBeCloseTo(-0.5);
    expect(prop.position.y).toBeCloseTo(1.6);
  });

  it('角色轉向時偏移方向跟著轉', () => {
    const prop = new THREE.Group();
    attachPropToHand(prop, fakeVrm(Math.PI), 'right', true, 0.2, NO_OFFSET);
    expect(prop.position.x).toBeCloseTo(-0.5);
  });
});
