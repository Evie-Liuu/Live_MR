/**
 * scriptedAvatar.ts
 *
 * 劇本模擬器用的程式動畫（不需要動作檔）：
 *   - 待機：手臂放下、胸口呼吸起伏、身體微幅擺動；setIdle 設定循環動作檔後改由動作檔驅動
 *   - 自動眨眼（隨機間隔）
 *   - 轉頭看向目標（說話者看聽者、聽者看說話者）
 *   - 說話：嘴巴開合（假的音節節奏，瀏覽器 TTS 拿不到音訊無法真正對嘴）＋輕微點頭
 *   - 動作（VRMA）：playGesture 播放一次性動作，淡入淡出與待機姿勢混合，轉頭疊加在最上層
 *   - 指向物件：playGesture 帶 aimAt 時轉向物件：小角度只轉上半身（脊椎＋胸口分攤），
 *     物件在側面或背後時整個人原地轉過去；手伸出去後再依實際手的方向微調到手對準物件，指完轉回原本方向
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
  /**
   * 播放一次性動作（由 createVRMAnimationClip 建立）；會中斷正在播的動作。
   * aimAt：動作期間上半身轉向這個世界座標、視線看著它（例如指向某件衣服）
   */
  playGesture(clip: THREE.AnimationClip, aimAt?: THREE.Vector3 | null): void;
  /** 用循環動作檔取代程式待機姿勢（由 createVRMAnimationClip 建立） */
  setIdle(clip: THREE.AnimationClip): void;
  /** 目前頭部的世界座標（給其他角色當 lookTarget） */
  headWorldPosition(out: THREE.Vector3): THREE.Vector3;
}

const DEG = Math.PI / 180;
const ARM_DOWN = 70 * DEG;
const MAX_HEAD_YAW = 55 * DEG;
const MAX_HEAD_PITCH = 20 * DEG;
/** 指向物件時上半身最多扭多少，超過的部分整個人原地轉（不然腰會扭得不自然） */
export const MAX_TORSO_YAW = 35 * DEG;
/** 總轉角上限：物件在正後方時不要因為微調在左右轉之間來回跳 */
const MAX_TURN_YAW = 170 * DEG;
/** 轉身的追隨速度（越大越快） */
const TURN_SPEED = 5;
/** 轉身到這個誤差以內才量手的方向來修正（還在轉的時候量會修過頭） */
const TURN_SETTLED = 8 * DEG;
/** 脊椎分到的轉角比例，其餘給胸口 */
const SPINE_YAW_SHARE = 0.4;
/** 依伸出的手修正轉角的速度 */
const AIM_CORRECT_SPEED = 6;
/** 動作權重到這裡以上（手已伸出去）才量手的方向來修正 */
const AIM_MEASURE_WEIGHT = 0.9;
/** 肩膀到手的水平距離小於這個（公尺）視為手沒伸出去，不拿來修正 */
const ARM_REACH_MIN = 0.1;
/** 頭部轉向的追隨速度（越大越快） */
const LOOK_SPEED = 4;
const MOUTH_SPEED = 18;
/** 動作開始 / 結束時與待機姿勢混合的秒數 */
const GESTURE_FADE_IN = 0.25;
const GESTURE_FADE_OUT = 0.45;
/** 待機動作檔頭尾姿勢不一定相同，循環時用這段秒數交叉淡化 */
const IDLE_LOOP_FADE = 0.8;

/**
 * 循環播放的取樣位置：實際播放 [fade, duration) 這段，尾端 fade 秒逐漸混向開頭的 [0, fade)，
 * 混到底時正好等於下一輪的起點，因此頭尾姿勢不同也不會跳動。
 */
export function idleLoopSample(time: number, duration: number): { time: number; wrapTime: number; wrapWeight: number } {
  if (duration <= 0) return { time: 0, wrapTime: 0, wrapWeight: 0 };
  const fade = Math.min(IDLE_LOOP_FADE, duration / 2);
  const span = duration - fade;
  const t = fade + THREE.MathUtils.euclideanModulo(time, span);
  const u = THREE.MathUtils.clamp((t - span) / fade, 0, 1);
  return { time: t, wrapTime: Math.max(0, t - span), wrapWeight: u * u * (3 - 2 * u) };
}

/** 動作的混合權重：開頭淡入、結尾淡出（0~1） */
export function gestureWeight(time: number, duration: number): number {
  const smooth = (u: number) => u * u * (3 - 2 * u);
  const fadeIn = smooth(THREE.MathUtils.clamp(time / GESTURE_FADE_IN, 0, 1));
  const fadeOut = smooth(THREE.MathUtils.clamp((duration - time) / GESTURE_FADE_OUT, 0, 1));
  return Math.min(fadeIn, fadeOut);
}
const UP = new THREE.Vector3(0, 1, 0);

/** 角度換到 (-π, π] */
export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** 方向的水平角：0 = 角色正前方，正值 = 往角色左邊 */
export function horizontalYaw(forward: THREE.Vector3, left: THREE.Vector3, dir: THREE.Vector3): number {
  return Math.atan2(dir.dot(left), dir.dot(forward));
}

/** 總轉角拆成上半身扭轉與整個人原地轉：小角度只扭上半身，超過上限的部分整個人轉 */
export function splitTurn(turn: number): { torso: number; root: number } {
  const torso = THREE.MathUtils.clamp(turn, -MAX_TORSO_YAW, MAX_TORSO_YAW);
  return { torso, root: turn - torso };
}

/**
 * 目標方向相對於角色的水平角與仰角。
 * forward / left 為角色的水平朝向（世界座標、單位向量）；yaw 正值 = 往角色左邊轉，up 正值 = 往上看。
 * bodyYaw：上半身已經轉過去的角度，頭只要轉剩下的部分。
 */
export function lookAngles(
  forward: THREE.Vector3, left: THREE.Vector3, toTarget: THREE.Vector3, bodyYaw = 0,
): { yaw: number; up: number } {
  const f = toTarget.dot(forward);
  const l = toTarget.dot(left);
  const yaw = wrapAngle(Math.atan2(l, f) - bodyYaw);
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

/** KeyframeTrack 執行時有 createInterpolant（依插值模式設定），但 @types/three 沒有宣告 */
export function createInterpolant(track: THREE.KeyframeTrack): THREE.Interpolant {
  return (track as THREE.KeyframeTrack & { createInterpolant(): THREE.Interpolant }).createInterpolant();
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
  const arms = [
    { shoulder: leftUpperArm, hand: bone('leftHand') ?? leftLowerArm },
    { shoulder: rightUpperArm, hand: bone('rightHand') ?? rightLowerArm },
  ].filter((a): a is { shoulder: THREE.Object3D; hand: THREE.Object3D } => !!a.shoulder && !!a.hand);
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

  // bodyYawSign：上半身（脊椎／胸口）rotation.y 正值是否往角色左邊轉。實際量，不假設與頭相同：
  // 往左轉時右肩會往前移，用右肩（沒有就左肩、方向相反）判斷
  let bodyYawSign = yawSign;
  const twistBone = chest ?? spine;
  const probe = rightUpperArm ?? leftUpperArm;
  if (twistBone && probe) {
    const before = probe.getWorldPosition(new THREE.Vector3());
    twistBone.rotation.set(0, 0.3, 0);
    twistBone.updateMatrixWorld(true);
    const moved = probe.getWorldPosition(new THREE.Vector3()).sub(before).dot(forward);
    const towardLeft = probe === rightUpperArm ? moved > 0 : moved < 0;
    bodyYawSign = towardLeft ? 1 : -1;
    twistBone.rotation.set(0, 0, 0);
    twistBone.updateMatrixWorld(true);
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
    /** 要指向的世界座標 */
    aim: THREE.Vector3 | null;
    /** 要轉到的總角度（相對原本朝向，正值往左）；null = 還沒算 */
    aimYaw: number | null;
  } | null = null;
  let idle: {
    duration: number;
    rotations: { bone: THREE.Object3D; interp: THREE.Interpolant }[];
    positions: { bone: THREE.Object3D; interp: THREE.Interpolant }[];
  } | null = null;
  const idleQuat = new THREE.Quaternion();
  const idlePos = new THREE.Vector3();
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
  /** 目前的總轉角（平滑追隨）；動作結束後回到 0 */
  let turn = 0;
  /** 原本的朝向，整個人轉身時以它為基準 */
  const baseQuat = vrm.scene.quaternion.clone();
  const turnQuat = new THREE.Quaternion();
  const shoulderPos = new THREE.Vector3();
  const handPos = new THREE.Vector3();
  const armDir = new THREE.Vector3();

  /** 量目前伸出去的那隻手，把上半身轉角往「手對準物件」修正 */
  const correctAim = (g: NonNullable<typeof gesture>, aim: THREE.Vector3, delta: number) => {
    let best: { reach: number; armYaw: number; targetYaw: number } | null = null;
    for (const { shoulder, hand } of arms) {
      shoulder.getWorldPosition(shoulderPos);
      hand.getWorldPosition(handPos);
      armDir.subVectors(handPos, shoulderPos).setY(0);
      const reach = armDir.length();
      if (reach < ARM_REACH_MIN || (best && reach <= best.reach)) continue;
      toTarget.subVectors(aim, shoulderPos);
      best = { reach, armYaw: horizontalYaw(forward, left, armDir), targetYaw: horizontalYaw(forward, left, toTarget) };
    }
    if (!best || g.aimYaw === null) return;
    const err = wrapAngle(best.targetYaw - best.armYaw);
    const step = Math.min(1, AIM_CORRECT_SPEED * delta);
    g.aimYaw = THREE.MathUtils.clamp(g.aimYaw + err * step, -MAX_TURN_YAW, MAX_TURN_YAW);
  };

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

      // 指向物件：轉向物件，動作收尾時轉回來
      const aim = gesture?.aim ?? null;
      let turnTarget = 0;
      if (gesture && aim) {
        if (gesture.aimYaw === null) {
          vrm.scene.getWorldPosition(headPos);
          toTarget.subVectors(aim, headPos);
          gesture.aimYaw = THREE.MathUtils.clamp(horizontalYaw(forward, left, toTarget), -MAX_TURN_YAW, MAX_TURN_YAW);
        }
        if (gesture.time < gesture.duration - GESTURE_FADE_OUT) turnTarget = gesture.aimYaw;
      }
      turn = approach(turn, turnTarget, TURN_SPEED, delta);
      if (Math.abs(turn) < 1e-4 && turnTarget === 0) turn = 0;
      const { torso: torsoYaw, root: rootYaw } = splitTurn(turn);
      // 整個人原地轉（世界 Y 軸正值＝往角色左邊）
      vrm.scene.quaternion.copy(baseQuat).premultiply(turnQuat.setFromAxisAngle(UP, rootYaw));
      /** 頭要扣掉身體已經轉的角度 */
      const bodyYaw = turn;

      // 看向目標（指向時看著物件），頭與脖子分攤上半身沒轉到的部分
      let targetYaw = 0;
      let targetUp = 0;
      const look = aim ?? lookTarget;
      if (look && head) {
        head.getWorldPosition(headPos);
        toTarget.subVectors(look, headPos);
        ({ yaw: targetYaw, up: targetUp } = lookAngles(forward, left, toTarget, bodyYaw));
      }
      yaw = approach(yaw, targetYaw, LOOK_SPEED, delta);
      up = approach(up, targetUp, LOOK_SPEED, delta);
      // 說話時輕微點頭（播動作時由動作接手頭部）
      const nod = speaking && !gesture ? Math.sin(elapsed * 5 + seed) * 0.035 : 0;
      neck?.rotation.set(0, 0, 0);
      head?.rotation.set(nod * pitchSign, 0, Math.sin(elapsed * 0.7 + seed) * 0.02);

      // 待機動作檔蓋過上面的程式姿勢；動作檔沒有的骨頭維持程式姿勢。seed 讓角色不會同步擺動
      if (idle) {
        const s = idleLoopSample(elapsed + seed, idle.duration);
        for (const { bone: b, interp } of idle.rotations) {
          b.quaternion.fromArray(interp.evaluate(s.time) as unknown as number[]);
          if (s.wrapWeight > 0) b.quaternion.slerp(idleQuat.fromArray(interp.evaluate(s.wrapTime) as unknown as number[]), s.wrapWeight);
        }
        // 髖部位移要一起套用，否則腿部旋轉會讓腳離地或穿進地板
        for (const { bone: b, interp } of idle.positions) {
          b.position.fromArray(interp.evaluate(s.time) as unknown as number[]);
          if (s.wrapWeight > 0) b.position.lerp(idlePos.fromArray(interp.evaluate(s.wrapTime) as unknown as number[]), s.wrapWeight);
        }
        if (nod && head) head.quaternion.multiply(lookQuat.setFromEuler(lookEuler.set(nod * pitchSign, 0, 0)));
      }

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

      // 上半身扭轉疊在動作之上（待機姿勢每幀重設，不會累加）
      if (torsoYaw !== 0) {
        if (spine && chest && spine !== chest) {
          spine.quaternion.multiply(lookQuat.setFromEuler(lookEuler.set(0, torsoYaw * bodyYawSign * SPINE_YAW_SHARE, 0)));
          chest.quaternion.multiply(lookQuat.setFromEuler(lookEuler.set(0, torsoYaw * bodyYawSign * (1 - SPINE_YAW_SHARE), 0)));
        } else {
          (chest ?? spine)?.quaternion.multiply(lookQuat.setFromEuler(lookEuler.set(0, torsoYaw * bodyYawSign, 0)));
        }
      }

      // ③ 轉頭看人疊在最上層：頭與脖子分攤轉角
      const pitchRot = -up * pitchSign;
      if (neck) neck.quaternion.multiply(lookQuat.setFromEuler(lookEuler.set(pitchRot * 0.4, yaw * yawSign * 0.4, 0)));
      if (head) head.quaternion.multiply(lookQuat.setFromEuler(lookEuler.set(pitchRot * 0.6, yaw * yawSign * 0.6, 0)));

      // 手伸出去後量實際方向，下一幀修正轉角，讓手（不只是身體）對準物件
      if (
        gesture?.aim && gesture.aimYaw !== null
        && gestureWeight(gesture.time, gesture.duration) >= AIM_MEASURE_WEIGHT
        && Math.abs(turn - gesture.aimYaw) < TURN_SETTLED
      ) {
        correctAim(gesture, gesture.aim, delta);
      }

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
    playGesture(clip, aimAt) {
      stopGesture();
      const bones: { bone: THREE.Object3D; interp: THREE.Interpolant }[] = [];
      const expressions: { target: { weight: number }; interp: THREE.Interpolant }[] = [];
      for (const track of clip.tracks) {
        const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
        const obj = vrm.scene.getObjectByName(nodeName);
        if (!obj) continue;
        if (propertyName === 'quaternion') {
          bones.push({ bone: obj, interp: createInterpolant(track) });
          touched.add(obj);
        } else if (propertyName === 'weight') {
          expressions.push({ target: obj as unknown as { weight: number }, interp: createInterpolant(track) });
        }
      }
      gesture = { time: 0, duration: clip.duration, bones, expressions, aim: aimAt ? aimAt.clone() : null, aimYaw: null };
    },
    setIdle(clip) {
      const rotations: { bone: THREE.Object3D; interp: THREE.Interpolant }[] = [];
      const positions: { bone: THREE.Object3D; interp: THREE.Interpolant }[] = [];
      for (const track of clip.tracks) {
        const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
        const obj = vrm.scene.getObjectByName(nodeName);
        if (!obj) continue;
        if (propertyName === 'quaternion') rotations.push({ bone: obj, interp: createInterpolant(track) });
        else if (propertyName === 'position') positions.push({ bone: obj, interp: createInterpolant(track) });
      }
      idle = { duration: clip.duration, rotations, positions };
    },
    headWorldPosition(out) {
      if (head) return head.getWorldPosition(out);
      return vrm.scene.getWorldPosition(out).add(new THREE.Vector3(0, 1.5, 0));
    },
  };
}
