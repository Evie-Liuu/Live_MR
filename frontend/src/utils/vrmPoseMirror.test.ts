/**
 * 追蹤動作的鏡像方向：本人往自己左側（未翻轉影像的右側）的動作，
 * 面向鏡頭的角色在畫面上都要往左（-X），跟鏡像後的影像同方向。
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { PoseFrame } from '../types/vrm';
import { applyPoseToVrm, createPoseApplyState, type ApplyPoseOptions } from './vrmPoseApplier.ts';

type Lm = { x: number; y: number; z: number; visibility: number };

const ANGLE = (20 * Math.PI) / 180;

/** MediaPipe 世界座標的站姿：x 向右（本人左側）、y 向下、z 離鏡頭為正 */
function body(): Lm[] {
  const p: Lm[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
  const set = (i: number, x: number, y: number, z = 0) => { p[i] = { x, y, z, visibility: 1 }; };
  set(0, 0, -0.62, -0.08);
  for (let i = 1; i <= 10; i++) set(i, (i % 2 ? 1 : -1) * 0.03, -0.64, -0.08);
  set(11, 0.18, -0.45); set(12, -0.18, -0.45);
  set(13, 0.2, -0.17); set(14, -0.2, -0.17);
  set(15, 0.2, 0.08, -0.03); set(16, -0.2, 0.08, -0.03);
  for (const i of [17, 19, 21]) set(i, 0.2, 0.13, -0.03);
  for (const i of [18, 20, 22]) set(i, -0.2, 0.13, -0.03);
  set(23, 0.1, 0); set(24, -0.1, 0);
  set(25, 0.1, 0.4); set(26, -0.1, 0.4); set(27, 0.1, 0.8); set(28, -0.1, 0.8);
  set(29, 0.1, 0.85); set(30, -0.1, 0.85); set(31, 0.1, 0.85, -0.1); set(32, -0.1, 0.85, -0.1);
  return p;
}

const normalized = (world: Lm[], shiftX = 0): Lm[] =>
  world.map(q => ({ x: q.x / 2.2 + 0.5 + shiftX, y: q.y / 2.2 + 0.5, z: q.z / 2.2, visibility: 1 }));

/** 臉部 478 點：21、172 在本人右側（影像左），251、397 在本人左側（影像右） */
function face(yaw = 0, roll = 0): Lm[] {
  const at = (x: number, y: number, z: number): Lm => {
    const x1 = x * Math.cos(roll) - y * Math.sin(roll);
    const y1 = x * Math.sin(roll) + y * Math.cos(roll);
    return { x: x1 * Math.cos(yaw) - z * Math.sin(yaw) + 0.5, y: y1 + 0.4, z: x1 * Math.sin(yaw) + z * Math.cos(yaw), visibility: 1 };
  };
  const lm = Array.from({ length: 478 }, (_, i) => at(Math.sin(i) * 0.04, Math.cos(i) * 0.04, -0.03));
  lm[21] = at(-0.07, -0.06, 0.02);
  lm[251] = at(0.07, -0.06, 0.02);
  lm[172] = at(-0.06, 0.07, 0.02);
  lm[397] = at(0.06, 0.07, 0.02);
  return lm;
}

/** 反覆套用同一個姿勢直到收斂，回傳各骨頭 */
function settle(makeFrame: () => Partial<PoseFrame>, opts: ApplyPoseOptions = {}) {
  const bones = new Map<string, THREE.Object3D>();
  const vrm = {
    humanoid: {
      getNormalizedBoneNode(name: string) {
        if (!bones.has(name)) bones.set(name, new THREE.Object3D());
        return bones.get(name);
      },
    },
  } as unknown as VRM;
  const state = createPoseApplyState();
  // Face.solve 會就地放大座標，所以每次都要新的 frame
  for (let i = 0; i < 60; i++) applyPoseToVrm(vrm, state, makeFrame() as PoseFrame, 1 / 30, opts);
  return (name: string) => bones.get(name) ?? new THREE.Object3D();
}

const axisX = (bone: THREE.Object3D, v: [number, number, number]) =>
  new THREE.Vector3(...v).applyQuaternion(bone.quaternion).x;

const standing = () => {
  const world = body();
  return { worldLandmarks: world, landmarks: normalized(world) };
};

const rollUpperBody = (angle: number) => body().map((q, i) => (i <= 22
  ? { ...q, x: q.x * Math.cos(angle) - q.y * Math.sin(angle), y: q.x * Math.sin(angle) + q.y * Math.cos(angle) }
  : q));

describe('tracking mirror direction', () => {
  it('head yaw: turning to own left turns the avatar towards screen left', () => {
    const left = settle(() => ({ ...standing(), faceLandmarks: face(ANGLE) }))('head');
    const right = settle(() => ({ ...standing(), faceLandmarks: face(-ANGLE) }))('head');
    expect(axisX(left, [0, 0, 1])).toBeLessThan(-0.1);
    expect(axisX(right, [0, 0, 1])).toBeGreaterThan(0.1);
  });

  it('head roll: tilting to own left tilts the avatar towards screen left', () => {
    const left = settle(() => ({ ...standing(), faceLandmarks: face(0, ANGLE) }))('head');
    const right = settle(() => ({ ...standing(), faceLandmarks: face(0, -ANGLE) }))('head');
    expect(axisX(left, [0, 1, 0])).toBeLessThan(-0.1);
    expect(axisX(right, [0, 1, 0])).toBeGreaterThan(0.1);
  });

  it('spine: leaning to own left leans the avatar towards screen left', () => {
    const frame = (angle: number) => () => {
      const world = rollUpperBody(angle);
      return { worldLandmarks: world, landmarks: normalized(world) };
    };
    expect(axisX(settle(frame(ANGLE))('spine'), [0, 1, 0])).toBeLessThan(-0.1);
    expect(axisX(settle(frame(-ANGLE))('spine'), [0, 1, 0])).toBeGreaterThan(0.1);
  });

  it('hips position: moving to own left moves the avatar towards screen left', () => {
    const frame = (shift: number) => () => {
      const world = body();
      return { worldLandmarks: world, landmarks: normalized(world, shift) };
    };
    const center = settle(frame(0))('hips').position.x;
    expect(settle(frame(0.2))('hips').position.x).toBeLessThan(center);
    expect(settle(frame(-0.2))('hips').position.x).toBeGreaterThan(center);
  });

  it('arms: raising the left arm drives the avatar arm on screen left', () => {
    const frame = () => {
      const world = body();
      world[13] = { ...world[13], x: 0.45, y: -0.47 };
      world[15] = { ...world[15], x: 0.7, y: -0.5 };
      for (const i of [17, 19, 21]) world[i] = { ...world[i], x: 0.75, y: -0.5 };
      return { worldLandmarks: world, landmarks: normalized(world) };
    };
    const raised = settle(frame);
    const rest = settle(standing);
    // 角色右臂在畫面左側（-X）。手臂伸向 -X，舉起時往上（+Y）
    const lift = (bone: THREE.Object3D) => new THREE.Vector3(-1, 0, 0).applyQuaternion(bone.quaternion).y;
    expect(lift(raised('rightUpperArm'))).toBeGreaterThan(lift(rest('rightUpperArm')) + 0.3);
    expect(raised('leftUpperArm').quaternion.angleTo(rest('leftUpperArm').quaternion)).toBeLessThan(0.01);
  });

  it('same-side mode is the reflection of mirror mode', () => {
    const roll = (mirror: boolean) => settle(() => ({ ...standing(), faceLandmarks: face(0, ANGLE) }), { mirror })('head');
    expect(axisX(roll(false), [0, 1, 0])).toBeCloseTo(-axisX(roll(true), [0, 1, 0]), 5);
  });
});
