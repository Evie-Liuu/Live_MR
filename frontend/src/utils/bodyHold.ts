// frontend/src/utils/bodyHold.ts
/**
 * 道具貼在身上（把衣服比在身上、戴帽子）：拿著道具的手移到腰前、胸前或頭頂時，道具改貼在角色身上。
 * 只用 VRM 標準人形骨架（hips、chest、head、肩膀、腳）判斷位置與身體方向，任何模型都適用。
 */
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { BodyHoldConfig } from '../types/vrm';

/** 標準身高角色的髖部高度（公尺）；設定裡的位移、大小與判斷距離都以此為準，依角色實際髖部高度縮放 */
const REFERENCE_HIPS_HEIGHT = 0.85;

/**
 * 手要在錨點附近多近才算「移到身上」（公尺，以標準身高為準）：
 * side＝離身體中線的左右距離上限；below / above＝比錨點低 / 高多少以內。
 * 只看左右與高低、不看前後：手垂在身體兩側時左右距離約 0.2 公尺，不會誤貼。
 */
const ANCHOR_ZONES: Record<BodyHoldConfig['anchor'], { side: number; below: number; above: number }> = {
  hips: { side: 0.13, below: 0.25, above: 0.2 },
  chest: { side: 0.13, below: 0.15, above: 0.2 },
  head: { side: 0.18, below: 0, above: 0.4 },
};
/** 已經貼上時，手要離開這麼多倍的範圍才拿回手上，避免在邊界來回跳 */
const RELEASE_ZONE_SCALE = 1.6;
/** 比錨點高低範圍額外放寬（公尺，以標準身高為準） */
const RELEASE_ZONE_MARGIN = 0.1;

export interface BodyFrame {
  /** 角色的左方（水平單位向量，取自兩肩連線） */
  left: THREE.Vector3;
  /** 角色的正前方（水平單位向量） */
  forward: THREE.Vector3;
  /** 角色身高相對標準身高的比例 */
  sizeFactor: number;
}

/**
 * 手（世界座標）是否在錨點的範圍內。
 * wasOn＝目前已經貼在身上：範圍放寬，手要明顯移開才算離開。
 */
export function isHandAtAnchor(
  hand: THREE.Vector3,
  anchor: THREE.Vector3,
  anchorKind: BodyHoldConfig['anchor'],
  body: Pick<BodyFrame, 'left' | 'sizeFactor'>,
  wasOn: boolean,
): boolean {
  const zone = ANCHOR_ZONES[anchorKind];
  const k = body.sizeFactor;
  const widen = wasOn ? RELEASE_ZONE_SCALE : 1;
  const margin = wasOn ? RELEASE_ZONE_MARGIN : 0;
  const dx = hand.x - anchor.x;
  const dz = hand.z - anchor.z;
  const side = Math.abs(dx * body.left.x + dz * body.left.z);
  const dy = hand.y - anchor.y;
  return side <= zone.side * widen * k
    && dy >= -(zone.below * widen + margin) * k
    && dy <= (zone.above * widen + margin) * k;
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
