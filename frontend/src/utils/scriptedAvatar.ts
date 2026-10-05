/**
 * scriptedAvatar.ts
 *
 * 劇本模擬器用的程式動畫（不需要動作檔）：
 *   - 待機：手臂放下、胸口呼吸起伏、身體微幅擺動
 *   - 自動眨眼（隨機間隔）
 *   - 轉頭看向目標（說話者看聽者、聽者看說話者）
 *   - 說話：嘴巴開合（假的音節節奏，瀏覽器 TTS 拿不到音訊無法真正對嘴）＋輕微點頭
 *   - 動作（VRMA）：playGesture 播放一次性動作，淡入淡出與待機姿勢混合，轉頭疊加在最上層
 *
 * 只寫 normalized bone 與 expression，呼叫端每幀要再呼叫 vrm.update(delta)。
 */
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

export interface AnimatorInput {
  /** 這個角色是否正在說台詞 */
  speaking: boolean;
  /** 要看的世界座標（通常是另一個角色的頭）；null = 看正前方 */
  lookTarget: THREE.Vector3 | null;
}

export interface AvatarAnimator {
  update(delta: number, elapsed: number, input: AnimatorInput): void;
  /** 播放一次性動作（由 createVRMAnimationClip 建立）；會中斷正在播的動作 */
  playGesture(clip: THREE.AnimationClip): void;
  /** 目前頭部的世界座標（給其他角色當 lookTarget） */
  headWorldPosition(out: THREE.Vector3): THREE.Vector3;
}

const DEG = Math.PI / 180;
const ARM_DOWN = 70 * DEG;
const MAX_HEAD_YAW = 55 * DEG;
const MAX_HEAD_PITCH = 20 * DEG;
/** 頭部轉向的追隨速度（越大越快） */
const LOOK_SPEED = 4;
const MOUTH_SPEED = 18;
/** 動作開始 / 結束時與待機姿勢混合的秒數 */
const GESTURE_FADE_IN = 0.25;
const GESTURE_FADE_OUT = 0.35;

/** 動作的混合權重：開頭淡入、結尾淡出（0~1） */
export function gestureWeight(time: number, duration: number): number {
  const smooth = (u: number) => u * u * (3 - 2 * u);
  const fadeIn = smooth(THREE.MathUtils.clamp(time / GESTURE_FADE_IN, 0, 1));
  const fadeOut = smooth(THREE.MathUtils.clamp((duration - time) / GESTURE_FADE_OUT, 0, 1));
  return Math.min(fadeIn, fadeOut);
}
const UP = new THREE.Vector3(0, 1, 0);

/**
 * 目標方向相對於角色的水平角與仰角。
 * forward / left 為角色的水平朝向（世界座標、單位向量）；yaw 正值 = 往角色左邊轉，up 正值 = 往上看。
 */
export function lookAngles(
  forward: THREE.Vector3, left: THREE.Vector3, toTarget: THREE.Vector3,
): { yaw: number; up: number } {
  const f = toTarget.dot(forward);
  const l = toTarget.dot(left);
  const yaw = Math.atan2(l, f);
  const up = Math.atan2(toTarget.y, Math.hypot(f, l));
  return {
    yaw: THREE.MathUtils.clamp(yaw, -MAX_HEAD_YAW, MAX_HEAD_YAW),
    up: THREE.MathUtils.clamp(up, -MAX_HEAD_PITCH, MAX_HEAD_PITCH),
  };
}

/**
 * 假的說話嘴型：兩個不同頻率的正弦疊加，模擬約每秒 4-6 個音節的開合。
 * seed 讓兩個角色的節奏不同步。回傳 0~1。
 */
export function mouthOpenness(elapsed: number, seed: number): number {
  const a = Math.abs(Math.sin(elapsed * 11 + seed));
  const b = 0.5 + 0.5 * Math.sin(elapsed * 3.7 + seed * 2);
  return THREE.MathUtils.clamp(0.15 + 0.75 * a * b, 0, 1);
}

function interp(i: THREE.Interpolant, t: number): number {
  return (i.evaluate(t) as unknown as number[])[0];
}

function approach(current: number, target: number, speed: number, delta: number): number {
  return current + (target - current) * Math.min(1, speed * delta);
}

export function createAvatarAnimator(vrm: VRM, seed = Math.random() * 10): AvatarAnimator {
  const h = vrm.humanoid;
  const bone = (name: Parameters<typeof h.getNormalizedBoneNode>[0]) => h.getNormalizedBoneNode(name);
  const head = bone('head');
  const neck = bone('neck');
  const chest = bone('chest') ?? bone('spine');
  const spine = bone('spine');
  const leftUpperArm = bone('leftUpperArm');
  const rightUpperArm = bone('rightUpperArm');
  const leftLowerArm = bone('leftLowerArm');
  const rightLowerArm = bone('rightLowerArm');
  const eye = bone('leftEye') ?? bone('rightEye') ?? bone('jaw');

  // ── 校正：VRM0 / VRM1 的座標慣例不同，實際量出角色朝向與頭部旋轉方向 ──────
  vrm.scene.updateMatrixWorld(true);
  const left = new THREE.Vector3(1, 0, 0);
  if (leftUpperArm && rightUpperArm) {
    const l = leftUpperArm.getWorldPosition(new THREE.Vector3());
    const r = rightUpperArm.getWorldPosition(new THREE.Vector3());
    left.subVectors(l, r).setY(0);
    if (left.lengthSq() > 1e-6) left.normalize(); else left.set(1, 0, 0);
  }
  const forward = new THREE.Vector3().crossVectors(left, UP).normalize();

  // yawSign：head.rotation.y 正值是否往角色左邊轉；pitchSign：head.rotation.x 正值是否往下看
  let yawSign = 1;
  let pitchSign = 1;
  if (head && eye) {
    const before = eye.getWorldPosition(new THREE.Vector3());
    head.rotation.set(0, 0.3, 0);
    head.updateMatrixWorld(true);
    const afterYaw = eye.getWorldPosition(new THREE.Vector3());
    yawSign = afterYaw.clone().sub(before).dot(left) >= 0 ? 1 : -1;
    head.rotation.set(0.3, 0, 0);
    head.updateMatrixWorld(true);
    const afterPitch = eye.getWorldPosition(new THREE.Vector3());
    pitchSign = afterPitch.y <= before.y ? 1 : -1;
    head.rotation.set(0, 0, 0);
    head.updateMatrixWorld(true);
  }

  const em = vrm.expressionManager;

  // ── 動作（VRMA） ─────────────────────────────────────────────────────────
  // 不用 AnimationMixer：它在數值與上一幀相同時不會寫入，會被每幀重設的待機姿勢蓋掉（停留段的骨頭因此不動）。
  // 改成每幀自己對 clip 的軌道取樣。
  /** 待機姿勢每幀都會設定的骨頭；其餘被動作碰過的骨頭（手指、手腕等）在動作外歸零 */
  const managed = new Set([head, neck, chest, spine, leftUpperArm, rightUpperArm, leftLowerArm, rightLowerArm].filter(Boolean));
  const touched = new Set<THREE.Object3D>();
  let gesture: {
    time: number;
    duration: number;
    bones: { bone: THREE.Object3D; interp: THREE.Interpolant }[];
    expressions: { target: { weight: number }; interp: THREE.Interpolant }[];
  } | null = null;
  const gestureQuat = new THREE.Quaternion();
  const lookQuat = new THREE.Quaternion();
  const lookEuler = new THREE.Euler();

  const stopGesture = () => {
    if (!gesture) return;
    for (const e of gesture.expressions) e.target.weight = 0;
    gesture = null;
  };
  let yaw = 0;
  let up = 0;
  let mouth = 0;
  let nextBlinkAt = 1 + Math.random() * 3;
  let blinkStart = -1;
  const headPos = new THREE.Vector3();
  const toTarget = new THREE.Vector3();

  return {
    update(delta, elapsed, { speaking, lookTarget }) {
      // ① 待機姿勢：手臂放下（與大螢幕編輯模式 placeholder 相同角度）、呼吸與重心擺動
      leftUpperArm?.rotation.set(0, 0, -ARM_DOWN);
      rightUpperArm?.rotation.set(0, 0, ARM_DOWN);
      if (chest) chest.rotation.set(Math.sin(elapsed * 1.6 + seed) * 0.02, 0, 0);
      if (spine && spine !== chest) spine.rotation.set(0, 0, Math.sin(elapsed * 0.5 + seed) * 0.015);
      leftLowerArm?.rotation.set(0, 0, -Math.sin(elapsed * 1.6 + seed) * 0.01);
      rightLowerArm?.rotation.set(0, 0, Math.sin(elapsed * 1.6 + seed) * 0.01);
      for (const b of touched) if (!managed.has(b)) b.quaternion.identity();

      // 看向目標，頭與脖子分攤轉角
      let targetYaw = 0;
      let targetUp = 0;
      if (lookTarget && head) {
        head.getWorldPosition(headPos);
        toTarget.subVectors(lookTarget, headPos);
        ({ yaw: targetYaw, up: targetUp } = lookAngles(forward, left, toTarget));
      }
      yaw = approach(yaw, targetYaw, LOOK_SPEED, delta);
      up = approach(up, targetUp, LOOK_SPEED, delta);
      // 說話時輕微點頭（播動作時由動作接手頭部）
      const nod = speaking && !gesture ? Math.sin(elapsed * 5 + seed) * 0.035 : 0;
      neck?.rotation.set(0, 0, 0);
      head?.rotation.set(nod * pitchSign, 0, Math.sin(elapsed * 0.7 + seed) * 0.02);

      // ② 動作：依淡入淡出權重，從待機姿勢 slerp 到動作姿勢
      if (gesture) {
        gesture.time = Math.min(gesture.time + delta, gesture.duration);
        const t = gesture.time;
        const w = gestureWeight(t, gesture.duration);
        for (const { bone: b, interp } of gesture.bones) {
          gestureQuat.fromArray(interp.evaluate(t) as unknown as number[]);
          b.quaternion.slerp(gestureQuat, w);
        }
        // 表情的淡入淡出已寫在動作檔的關鍵影格裡
        for (const e of gesture.expressions) e.target.weight = interp(e.interp, t);
        if (t >= gesture.duration) stopGesture();
      }

      // ③ 轉頭看人疊在最上層：頭與脖子分攤轉角
      const pitchRot = -up * pitchSign;
      if (neck) neck.quaternion.multiply(lookQuat.setFromEuler(lookEuler.set(pitchRot * 0.4, yaw * yawSign * 0.4, 0)));
      if (head) head.quaternion.multiply(lookQuat.setFromEuler(lookEuler.set(pitchRot * 0.6, yaw * yawSign * 0.6, 0)));

      if (!em) return;

      // 嘴型
      mouth = approach(mouth, speaking ? mouthOpenness(elapsed, seed) : 0, MOUTH_SPEED, delta);
      em.setValue('aa', mouth);
      em.setValue('oh', speaking ? mouth * 0.3 * (0.5 + 0.5 * Math.sin(elapsed * 2.3 + seed)) : 0);

      // 眨眼：0.15 秒閉上再張開
      if (blinkStart < 0 && elapsed >= nextBlinkAt) blinkStart = elapsed;
      if (blinkStart >= 0) {
        const t = (elapsed - blinkStart) / 0.15;
        em.setValue('blink', t < 1 ? Math.sin(t * Math.PI) : 0);
        if (t >= 1) {
          blinkStart = -1;
          nextBlinkAt = elapsed + 2 + Math.random() * 4;
        }
      }
    },
    playGesture(clip) {
      stopGesture();
      const bones: { bone: THREE.Object3D; interp: THREE.Interpolant }[] = [];
      const expressions: { target: { weight: number }; interp: THREE.Interpolant }[] = [];
      for (const track of clip.tracks) {
        const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
        const obj = vrm.scene.getObjectByName(nodeName);
        if (!obj) continue;
        if (propertyName === 'quaternion') {
          bones.push({ bone: obj, interp: track.createInterpolant() });
          touched.add(obj);
        } else if (propertyName === 'weight') {
          expressions.push({ target: obj as unknown as { weight: number }, interp: track.createInterpolant() });
        }
      }
      gesture = { time: 0, duration: clip.duration, bones, expressions };
    },
    headWorldPosition(out) {
      if (head) return head.getWorldPosition(out);
      return vrm.scene.getWorldPosition(out).add(new THREE.Vector3(0, 1.5, 0));
    },
  };
}
