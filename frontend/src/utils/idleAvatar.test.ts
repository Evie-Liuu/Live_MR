import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { createIdlePose, shouldPlayIdle } from './idleAvatar.ts';

const ROT = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0, 0));
const REST = new THREE.Quaternion();

/** 只有 hips、head、upperLeg、leftUpperArm 的假模型 */
function stubVrm() {
  const scene = new THREE.Group();
  const nodes = new Map<string, THREE.Object3D>();
  for (const name of ['hips', 'head', 'leftUpperLeg', 'leftUpperArm', 'rightUpperArm', 'leftIndexProximal']) {
    const o = new THREE.Object3D();
    o.name = `n_${name}`;
    scene.add(o);
    nodes.set(name, o);
  }
  const values = new Map<string, number>([['aa', 0.8]]);
  const vrm = {
    scene,
    humanoid: { getNormalizedBoneNode: (name: string) => nodes.get(name) ?? null },
    expressionManager: { getValue: (k: string) => values.get(k) ?? 0, setValue: (k: string, v: number) => { values.set(k, v); } },
  } as unknown as VRM;
  return { vrm, bone: (name: string) => nodes.get(name)!, values };
}

/** head、leftUpperLeg 固定旋轉；髖部高度 1.1 附近上下擺 0.01 */
const clip = () => new THREE.AnimationClip('idle', 4, [
  new THREE.QuaternionKeyframeTrack('n_head.quaternion', [0, 4], [...ROT.toArray(), ...ROT.toArray()]),
  new THREE.QuaternionKeyframeTrack('n_leftUpperLeg.quaternion', [0, 4], [...ROT.toArray(), ...ROT.toArray()]),
  new THREE.VectorKeyframeTrack('n_hips.position', [0, 2, 4], [0, 1.09, 0, 0, 1.11, 0, 0, 1.09, 0]),
]);

/** 跑到收斂 */
function run(fn: (delta: number, elapsed: number) => void, seconds = 3) {
  for (let i = 0; i < seconds * 60; i++) fn(1 / 60, i / 60);
}

describe('shouldPlayIdle', () => {
  it('outside a performance everyone follows their own pose', () => {
    expect(shouldPlayIdle('amy', undefined, true)).toBe(false);
    expect(shouldPlayIdle('amy', undefined, false)).toBe(false);
  });

  it('during a turn only the speaker with live pose data moves', () => {
    expect(shouldPlayIdle('amy', 'amy', true)).toBe(false);
    expect(shouldPlayIdle('ben', 'amy', true)).toBe(true);
    expect(shouldPlayIdle('amy', 'amy', false)).toBe(true);
  });

  it('nobody moves when paused or the speaker is unassigned', () => {
    expect(shouldPlayIdle('amy', null, true)).toBe(true);
  });
});

describe('createIdlePose', () => {
  it('reaches the clip pose without floating the hips', () => {
    const { vrm, bone } = stubVrm();
    const idle = createIdlePose(vrm, 0);
    idle.setClip(clip());
    run((d, e) => idle.update(d, e));
    expect(bone('head').quaternion.angleTo(ROT)).toBeLessThan(0.01);
    // 只留擺動量，不是動作檔的絕對高度 1.1
    expect(Math.abs(bone('hips').position.y)).toBeLessThan(0.02);
  });

  it('returns bones the clip does not animate to rest', () => {
    const { vrm, bone } = stubVrm();
    bone('leftIndexProximal').quaternion.copy(ROT);
    const idle = createIdlePose(vrm, 0);
    idle.setClip(clip());
    run((d, e) => idle.update(d, e));
    expect(bone('leftIndexProximal').quaternion.angleTo(REST)).toBeLessThan(0.01);
  });

  it('closes the mouth left open by face tracking', () => {
    const { vrm, values } = stubVrm();
    const idle = createIdlePose(vrm, 0);
    idle.setClip(clip());
    run((d, e) => idle.update(d, e));
    expect(values.get('aa')).toBeLessThan(0.01);
  });

  it('blends instead of snapping on the first frame', () => {
    const { vrm, bone } = stubVrm();
    const idle = createIdlePose(vrm, 0);
    idle.setClip(clip());
    idle.update(1 / 60, 0);
    const angle = bone('head').quaternion.angleTo(REST);
    expect(angle).toBeGreaterThan(0);
    expect(angle).toBeLessThan(ROT.angleTo(REST) * 0.2);
  });

  it('keeps the model height for static avatars', () => {
    const { vrm, bone } = stubVrm();
    bone('hips').position.y = 0.9;
    const idle = createIdlePose(vrm, 0, { keepHipsHeight: true });
    idle.setClip(clip());
    run((d, e) => idle.update(d, e));
    expect(Math.abs(bone('hips').position.y - 0.9)).toBeLessThan(0.02);
  });

  it('stands with arms down when there is no clip', () => {
    const { vrm, bone } = stubVrm();
    bone('hips').position.y = 0.9;
    const idle = createIdlePose(vrm, 0);
    run((d, e) => idle.update(d, e));
    expect(bone('leftUpperArm').rotation.z).toBeCloseTo(-(70 * Math.PI) / 180, 2);
    expect(bone('rightUpperArm').rotation.z).toBeCloseTo((70 * Math.PI) / 180, 2);
    expect(bone('hips').position.y).toBeCloseTo(0, 2);
  });

  it('release puts back bones pose tracking never writes, and leaves solved bones alone', () => {
    const { vrm, bone } = stubVrm();
    const idle = createIdlePose(vrm, 0);
    bone('leftUpperLeg').quaternion.copy(ROT);
    bone('leftUpperArm').quaternion.copy(ROT);
    idle.release(Infinity);
    expect(bone('leftUpperLeg').quaternion.angleTo(REST)).toBeCloseTo(0);
    expect(bone('leftUpperArm').quaternion.angleTo(ROT)).toBeCloseTo(0);
  });
});
