// frontend/src/utils/bodyHold.ts
/**
 * 道具貼在身上（把衣服比在身上、戴帽子）：拿著道具時雙手握拳一下，道具改貼在角色身上，再雙手握拳一下拿回手上。
 * 貼的位置只用 VRM 標準人形骨架（hips、chest、head、肩膀、腳）算出，任何模型都適用。
 */
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { BodyHoldConfig } from '../types/vrm';
import { shouldResetFistTimer } from './gestureDetector';

/** 標準身高角色的髖部高度（公尺）；設定裡的位移與大小都以此為準，依角色實際髖部高度縮放 */
const REFERENCE_HIPS_HEIGHT = 0.85;

/** 雙手握拳要維持這麼久才切換（貼上身／拿回手上） */
export const DOUBLE_FIST_MS = 300;

/** 雙手握拳的計時狀態 */
export interface DoubleFistTimer {
  /** 開始雙手握拳的時間（0＝沒在計時） */
  since: number;
  /** 上次偵測到雙手握拳的時間（手部不是每格都有資料） */
  lastAt: number;
  /** 切換後要先鬆開過一次才能再切換，避免一直握著就來回切換 */
  armed: boolean;
}

export function resetDoubleFist(t: DoubleFistTimer): void {
  t.since = 0;
  t.lastAt = 0;
  t.armed = true;
}

/**
 * 每幀更新雙手握拳計時；回 true 表示這一幀要切換。
 * bothHandsSeen＝兩隻手都有資料：有資料卻不是雙手握拳就歸零；沒資料要隔一段時間才歸零（同單手握拳的規則）。
 */
export function stepDoubleFist(t: DoubleFistTimer, doubleFist: boolean, bothHandsSeen: boolean, now: number): boolean {
  if (doubleFist) {
    t.lastAt = now;
    if (!t.armed) return false;
    if (t.since === 0) t.since = now;
    if (now - t.since < DOUBLE_FIST_MS) return false;
    t.since = 0;
    t.armed = false;
    return true;
  }
  if (shouldResetFistTimer(bothHandsSeen, now, t.lastAt)) {
    t.since = 0;
    t.armed = true;
  }
  return false;
}

export interface BodyFrame {
  /** 角色的左方（水平單位向量，取自兩肩連線） */
  left: THREE.Vector3;
  /** 角色的正前方（水平單位向量） */
  forward: THREE.Vector3;
  /** 角色身高相對標準身高的比例 */
  sizeFactor: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** 由兩肩與髖部、腳的骨頭算出身體方向與身高比例；模型缺骨頭時回 false */
export function readBodyFrame(vrm: VRM, out: BodyFrame): boolean {
  const h = vrm.humanoid;
  const lArm = h.getNormalizedBoneNode('leftUpperArm');
  const rArm = h.getNormalizedBoneNode('rightUpperArm');
  const hips = h.getNormalizedBoneNode('hips');
  if (!lArm || !rArm || !hips) return false;
  lArm.getWorldPosition(_a);
  rArm.getWorldPosition(_b);
  out.left.subVectors(_a, _b).setY(0);
  if (out.left.lengthSq() < 1e-8) return false;
  out.left.normalize();
  // 角色面向 +Z 時左方是 +X：左 × 上＝前
  out.forward.crossVectors(out.left, _up).normalize();

  hips.getWorldPosition(_a);
  let footY = Infinity;
  for (const name of ['leftFoot', 'rightFoot'] as const) {
    const foot = h.getNormalizedBoneNode(name);
    if (foot) footY = Math.min(footY, foot.getWorldPosition(_b).y);
  }
  const hipsHeight = Number.isFinite(footY) ? _a.y - footY : REFERENCE_HIPS_HEIGHT;
  out.sizeFactor = hipsHeight > 0.2 ? hipsHeight / REFERENCE_HIPS_HEIGHT : 1;
  return true;
}

/** 錨點骨頭的世界座標；胸部骨頭是選配的，沒有就用脊椎 */
export function anchorBonePosition(vrm: VRM, anchor: BodyHoldConfig['anchor'], out: THREE.Vector3): boolean {
  const h = vrm.humanoid;
  const bone = anchor === 'chest'
    ? h.getNormalizedBoneNode('chest') ?? h.getNormalizedBoneNode('spine')
    : h.getNormalizedBoneNode(anchor);
  if (!bone) return false;
  bone.getWorldPosition(out);
  return true;
}

const _target = new THREE.Vector3();
const _euler = new THREE.Euler();
const _yawQuat = new THREE.Quaternion();
const _localQuat = new THREE.Quaternion();
const _right = new THREE.Vector3();

/**
 * 每幀把道具往身上的位置移一點（t 為 0~1 的插值比例，1＝直接到位）：
 * 位置＝錨點＋依身體方向換算的位移，角度＝面向身體正前方再套上設定的角度，大小依身高縮放。
 */
export function placePropOnBody(
  group: THREE.Group,
  anchorPos: THREE.Vector3,
  body: BodyFrame,
  cfg: BodyHoldConfig,
  baseScale: number,
  t: number,
): void {
  const k = body.sizeFactor;
  const [right, up, fwd] = cfg.offset ?? [0, 0, 0];
  _right.copy(body.left).negate();
  _target.copy(anchorPos)
    .addScaledVector(_right, right * k)
    .addScaledVector(_up, up * k)
    .addScaledVector(body.forward, fwd * k);
  const a = Math.min(1, t);
  group.position.lerp(_target, a);

  _yawQuat.setFromAxisAngle(_up, Math.atan2(body.forward.x, body.forward.z));
  _localQuat.setFromEuler(_euler.set(...(cfg.rotation ?? [0, 0, 0])));
  _yawQuat.multiply(_localQuat);
  group.quaternion.slerp(_yawQuat, a);

  const scale = (cfg.scale ?? baseScale) * k;
  group.scale.setScalar(THREE.MathUtils.lerp(group.scale.x, scale, a));
}
