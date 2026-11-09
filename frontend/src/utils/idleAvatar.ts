/**
 * idleAvatar.ts
 *
 * 大屏角色不跟姿勢偵測時的待機動作：登台展演中，非發言者改播 idle.vrma，避免全班一起動。
 * 與姿勢驅動共用同一組 normalized bone，用指數逼近切換，所以進出待機都不會跳動。
 */
import * as THREE from 'three';
import { VRMHumanBoneList, type VRM, type VRMHumanBoneName } from '@pixiv/three-vrm';
import type { VRMAnimation } from '@pixiv/three-vrm-animation';
import { IDLE_ANIMATION_URL } from '../config/gestures.ts';
import { DEFAULT_BODY_TYPE, loadAnimation, type BodyType } from './animationLibrary.ts';
import { createInterpolant, idleLoopSample } from './scriptedAvatar.ts';

/**
 * 待機動作檔，依體型挑版本（大人先找 idle.adult.vrma），每個檔案整個 app 只下載一次；
 * 缺檔或載入失敗回傳 null，呼叫端改用程式待機姿勢
 */
export function loadIdleAnimation(bodyType: BodyType = DEFAULT_BODY_TYPE): Promise<VRMAnimation | null> {
  return loadAnimation(IDLE_ANIMATION_URL, bodyType);
}

/**
 * 這個角色現在該不該播待機動作。
 *
 * @param poseOnlyIdentity undefined＝不限制（沒在登台展演）；null＝目前沒有人可以動（暫停、本步結束）；
 *                         字串＝只有這位發言者可以動
 * @param hasFreshPose     最近有收到這個人的姿勢；發言者沒有姿勢時也播待機，不會變成 T-pose 或定格
 */
export function shouldPlayIdle(identity: string, poseOnlyIdentity: string | null | undefined, hasFreshPose: boolean): boolean {
  if (poseOnlyIdentity === undefined) return false;
  return identity !== poseOnlyIdentity || !hasFreshPose;
}

export interface IdlePose {
  /** 設定待機動作（由 createVRMAnimationClip 建立）；沒設定時手臂放下站好 */
  setClip(clip: THREE.AnimationClip): void;
  /** 每幀呼叫一次：往待機姿勢逼近 */
  update(delta: number, elapsed: number): void;
  /**
   * 回到姿勢驅動後呼叫：姿勢不會每幀寫入的骨頭（下半身、胸、肩、脖子、頭、手指）放回原位，
   * 否則會停在待機動作的最後一個姿勢。傳 Infinity 直接歸位。
   */
  release(delta: number): void;
}

/** 進出待機時逼近目標的速度（越大越快），約 0.5 秒到位 */
const BLEND_SPEED = 6;
/** 回到姿勢驅動後，放回待機動作碰過的骨頭要花的秒數 */
export const IDLE_RELEASE_SECONDS = 1;
const ARM_DOWN = (70 * Math.PI) / 180;
const MOUTH_SHAPES = ['aa', 'ee', 'ih', 'oh', 'ou'] as const;
/** 姿勢解算每次都會寫入的骨頭，放回原位時不用碰 */
const ALWAYS_POSED = new Set<VRMHumanBoneName>([
  'spine', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand',
]);

const blendT = (delta: number) => 1 - Math.exp(-BLEND_SPEED * delta);

export interface IdlePoseOptions {
  /**
   * 髖部維持模型原本的高度，只疊加擺動量。給沒有姿勢驅動的靜態角色用：
   * 它們的髖部停在模型的原始高度，不是姿勢驅動時的 0。
   */
  keepHipsHeight?: boolean;
}

export function createIdlePose(vrm: VRM, seed = Math.random() * 10, options: IdlePoseOptions = {}): IdlePose {
  const h = vrm.humanoid;
  const bones = VRMHumanBoneList
    .map(name => ({ name, node: h.getNormalizedBoneNode(name) }))
    .filter((b): b is { name: VRMHumanBoneName; node: THREE.Object3D } => !!b.node);
  const hips = h.getNormalizedBoneNode('hips');
  const hipsBase = options.keepHipsHeight && hips ? hips.position.clone() : new THREE.Vector3();
  const leftArm = h.getNormalizedBoneNode('leftUpperArm');
  const rightArm = h.getNormalizedBoneNode('rightUpperArm');
  const armDownL = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -ARM_DOWN));
  const armDownR = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, ARM_DOWN));
  const identity = new THREE.Quaternion();
  const released = bones.filter(b => !ALWAYS_POSED.has(b.name)).map(b => b.node);

  let clip: {
    duration: number;
    rotations: { bone: THREE.Object3D; interp: THREE.Interpolant }[];
    /** 髖部位移軌道；取樣值減去 center 只留擺動量 */
    hips: { interp: THREE.Interpolant; center: THREE.Vector3 } | null;
    /** 動作檔沒有的骨頭，待機時放回原位 */
    others: THREE.Object3D[];
  } | null = null;
  const quat = new THREE.Quaternion();
  const wrapQuat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const wrapPos = new THREE.Vector3();

  return {
    setClip(next) {
      const rotations: { bone: THREE.Object3D; interp: THREE.Interpolant }[] = [];
      let hipsTrack: { interp: THREE.Interpolant; center: THREE.Vector3 } | null = null;
      for (const track of next.tracks) {
        const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
        const obj = vrm.scene.getObjectByName(nodeName);
        if (!obj) continue;
        if (propertyName === 'quaternion') {
          rotations.push({ bone: obj, interp: createInterpolant(track) });
        } else if (propertyName === 'position' && obj === hips) {
          const center = new THREE.Vector3();
          const count = track.values.length / 3;
          for (let i = 0; i < count; i++) center.add(pos.fromArray(track.values, i * 3));
          hipsTrack = { interp: createInterpolant(track), center: center.divideScalar(count || 1) };
        }
      }
      const animated = new Set(rotations.map(r => r.bone));
      clip = { duration: next.duration, rotations, hips: hipsTrack, others: bones.map(b => b.node).filter(b => !animated.has(b)) };
    },

    update(delta, elapsed) {
      const t = blendT(delta);
      if (clip) {
        const s = idleLoopSample(elapsed + seed, clip.duration);
        for (const { bone, interp } of clip.rotations) {
          quat.fromArray(interp.evaluate(s.time) as unknown as number[]);
          if (s.wrapWeight > 0) quat.slerp(wrapQuat.fromArray(interp.evaluate(s.wrapTime) as unknown as number[]), s.wrapWeight);
          bone.quaternion.slerp(quat, t);
        }
        for (const bone of clip.others) bone.quaternion.slerp(identity, t);
        if (hips) {
          // 姿勢驅動時髖部高度是 0（整個模型由 slot 位置墊高）。動作檔存的是絕對高度，
          // 直接套用模型會浮起來，所以只取相對於動作中心的擺動量，兩種模式站在同一個位置。
          if (clip.hips) {
            pos.fromArray(clip.hips.interp.evaluate(s.time) as unknown as number[]);
            if (s.wrapWeight > 0) pos.lerp(wrapPos.fromArray(clip.hips.interp.evaluate(s.wrapTime) as unknown as number[]), s.wrapWeight);
            pos.sub(clip.hips.center).add(hipsBase);
          } else {
            pos.copy(hipsBase);
          }
          hips.position.lerp(pos, t);
        }
      } else {
        // 沒有動作檔（缺檔或還在載入）：手臂放下站好
        for (const { node } of bones) {
          if (node === leftArm) node.quaternion.slerp(armDownL, t);
          else if (node === rightArm) node.quaternion.slerp(armDownR, t);
          else node.quaternion.slerp(identity, t);
        }
        hips?.position.lerp(pos.copy(hipsBase), t);
      }

      // 嘴巴闔上；姿勢驅動時由臉部偵測寫入，不歸零會停在最後的嘴型
      const em = vrm.expressionManager;
      if (em) for (const shape of MOUTH_SHAPES) em.setValue(shape, (em.getValue(shape) ?? 0) * (1 - t));
    },

    release(delta) {
      const t = blendT(delta);
      for (const bone of released) bone.quaternion.slerp(identity, t);
    },
  };
}
