/**
 * vrmPoseApplier.ts
 *
 * Shared VRM bone-drive logic used by both:
 *  - useVrmAvatar  (single-avatar tile, transparent background)
 *  - useBigScreenScene (multi-avatar big screen)
 *
 * Extracts the apply-pose routine so it doesn't live in two places.
 *
 * Hand solving: uses a built-in gesture-based solver (Open / Fist) instead of
 * Kalidokit Hand.solve, to eliminate per-finger jitter.
 *
 * Mirror note: Live_MR uses visual mirroring (camera-flip), so Left/Right
 * are already swapped at the VRM bone level.
 *   MediaPipe "Left" hand (person left) → VRM 'rightHand' etc.
 *   MediaPipe "Right" hand (person right) → VRM 'leftHand' etc.
 */
import * as THREE from 'three';
import { solveWithKalidokit, type BoneRotation } from './kalidokitSolver';
import { Face } from 'kalidokit';
import type { VRM } from '@pixiv/three-vrm';
import type { PoseFrame } from '../types/vrm';

// ─── Hand Landmark type ────────────────────────────────────────────────────────

export interface HandLandmark {
  x: number
  y: number
  z: number
}

// ─── VRM bone maps ────────────────────────────────────────────────────────────
// Mirror: MediaPipe Left → VRM Right prefix, MediaPipe Right → VRM Left prefix

/** MediaPipe "Left" hand → VRM right-side bones (mirror convention) */
const LEFT_HAND_BONE_MAP: Record<string, string> = {
  // Wrist
  Wrist: 'rightHand',
  // Thumb
  ThumbProximal: 'rightThumbMetacarpal',
  ThumbIntermediate: 'rightThumbProximal',
  ThumbDistal: 'rightThumbDistal',
  // Index
  IndexProximal: 'rightIndexProximal',
  IndexIntermediate: 'rightIndexIntermediate',
  IndexDistal: 'rightIndexDistal',
  // Middle
  MiddleProximal: 'rightMiddleProximal',
  MiddleIntermediate: 'rightMiddleIntermediate',
  MiddleDistal: 'rightMiddleDistal',
  // Ring
  RingProximal: 'rightRingProximal',
  RingIntermediate: 'rightRingIntermediate',
  RingDistal: 'rightRingDistal',
  // Little
  LittleProximal: 'rightLittleProximal',
  LittleIntermediate: 'rightLittleIntermediate',
  LittleDistal: 'rightLittleDistal',
}

/** MediaPipe "Right" hand → VRM left-side bones (mirror convention) */
const RIGHT_HAND_BONE_MAP: Record<string, string> = {
  Wrist: 'leftHand',
  ThumbProximal: 'leftThumbMetacarpal',
  ThumbIntermediate: 'leftThumbProximal',
  ThumbDistal: 'leftThumbDistal',
  IndexProximal: 'leftIndexProximal',
  IndexIntermediate: 'leftIndexIntermediate',
  IndexDistal: 'leftIndexDistal',
  MiddleProximal: 'leftMiddleProximal',
  MiddleIntermediate: 'leftMiddleIntermediate',
  MiddleDistal: 'leftMiddleDistal',
  RingProximal: 'leftRingProximal',
  RingIntermediate: 'leftRingIntermediate',
  RingDistal: 'leftRingDistal',
  LittleProximal: 'leftLittleProximal',
  LittleIntermediate: 'leftLittleIntermediate',
  LittleDistal: 'leftLittleDistal',
}

// ─── Gesture constants (fixed Euler angles for each bone role) ─────────────────

/** Open hand: all fingers straight → zero rotation */
const EULER_OPEN = { x: 0, y: 0, z: 0 }

/**
 * Fist curl values.
 * Kalidokit / VRM convention: Z-axis flexes fingers.
 * Left VRM hand curls with negative Z, Right with positive Z.
 */
const FIST_FINGER_L = { x: 0, y: 0, z: -0.9 }  // VRM left fingers
const FIST_FINGER_R = { x: 0, y: 0, z: 0.9 }  // VRM right fingers

const FIST_THUMB_L = { x: 0.6, y: 0.2, z: -0.3 }  // VRM left thumb
const FIST_THUMB_R = { x: 0.6, y: -0.2, z: 0.3 }  // VRM right thumb

// ─── Lower body bone list ────────────────────────────────────────────────────
// Bones whose rotation is suppressed when lowerBodyEnabled = false.
// Hips position (translation) is still applied so the avatar stays grounded.
const LOWER_BODY_BONES = new Set([
  'hips',
  'leftUpperLeg',
  'rightUpperLeg',
  'leftLowerLeg',
  'rightLowerLeg',
  'leftFoot',
  'rightFoot',
  'leftToes',
  'rightToes',
]);

// ─── Reusable THREE objects – avoids per-frame allocations ────────────────────

const _targetQuat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _prev = new THREE.Quaternion();
const _target = new THREE.Quaternion();

// Temp BoneRotation written by eulerToBoneRot; caller must consume before next call.
const _boneRotTemp: BoneRotation = { x: 0, y: 0, z: 0, w: 0 };

// ─── Hand solver helpers ──────────────────────────────────────────────────────

function eulerToBoneRot(e: { x: number; y: number; z: number }): BoneRotation {
  _euler.set(e.x, e.y, e.z, 'XYZ');
  _quat.setFromEuler(_euler);
  _boneRotTemp.x = _quat.x;
  _boneRotTemp.y = _quat.y;
  _boneRotTemp.z = _quat.z;
  _boneRotTemp.w = _quat.w;
  return _boneRotTemp; // caller must consume immediately — do not store reference
}

function slerpBoneInto(
  cur: BoneRotation,
  prev: BoneRotation,
  smoothing: number,
  out: BoneRotation,
): void {
  // Read prev atomically before writing out (prev === out is safe)
  _prev.set(prev.x, prev.y, prev.z, prev.w);
  _target.set(cur.x, cur.y, cur.z, cur.w);
  _prev.slerp(_target, 1 - smoothing);
  out.x = _prev.x;
  out.y = _prev.y;
  out.z = _prev.z;
  out.w = _prev.w;
}

/**
 * Detect whether the hand is Open or Fist using landmark distances.
 * Compares each fingertip distance from wrist vs its MCP joint distance.
 * If fingertip is closer to wrist than ~1.2× MCP distance → curled.
 */
function detectGesture(landmarks: HandLandmark[]): HandGesture {
  const wrist = landmarks[0]
  if (!wrist) return 'Open'

  // Index=8/5, Middle=12/9, Ring=16/13, Little=20/17
  const fingers = [
    { tip: 8, mcp: 5 },
    { tip: 12, mcp: 9 },
    { tip: 16, mcp: 13 },
    { tip: 20, mcp: 17 },
  ]

  let curledCount = 0
  for (const f of fingers) {
    const tip = landmarks[f.tip]
    const mcp = landmarks[f.mcp]
    if (!tip || !mcp) continue
    const dTip = Math.hypot(tip.x - wrist.x, tip.y - wrist.y, tip.z - wrist.z)
    const dMcp = Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y, mcp.z - wrist.z)
    if (dTip < dMcp * 1.2) curledCount++
  }

  return curledCount >= 4 ? 'Fist' : 'Open'
}

// ─── Public hand solver types & function ──────────────────────────────────────

export type HandGesture = 'Open' | 'Fist'

/**
 * Solve one hand's VRM finger-bone rotations from 21 MediaPipe landmarks.
 * Writes results directly into `outBones` (in-place update, no heap allocation).
 *
 * @param landmarks  21 normalized hand landmarks from HandLandmarker
 * @param side       MediaPipe handedness ("Left" | "Right") – person's perspective
 * @param outBones   Pre-allocated bone map (also serves as prev-frame source for slerp)
 * @param smoothing  0 = snap to target, 0.9 = very slow follow
 * @returns gesture detected, or null if landmarks invalid
 */
export function solveHand(
  landmarks: HandLandmark[],
  side: 'Left' | 'Right',
  outBones: Record<string, BoneRotation>,
  smoothing: number,
): HandGesture | null {
  if (landmarks.length < 21) return null;

  const gesture = detectGesture(landmarks);
  const boneMap = side === 'Left' ? LEFT_HAND_BONE_MAP : RIGHT_HAND_BONE_MAP;
  const vrmSide = side === 'Left' ? 'Right' : 'Left';
  const isVrmLeft = vrmSide === 'Left';

  for (const [role, vrmName] of Object.entries(boneMap)) {
    let euler: { x: number; y: number; z: number };

    if (role === 'Wrist') {
      euler = EULER_OPEN;
    } else if (gesture === 'Open') {
      euler = EULER_OPEN;
    } else {
      if (role.startsWith('Thumb')) {
        euler = isVrmLeft ? FIST_THUMB_L : FIST_THUMB_R;
      } else {
        euler = isVrmLeft ? FIST_FINGER_L : FIST_FINGER_R;
      }
    }

    const cur = eulerToBoneRot(euler); // writes into _boneRotTemp
    const bone = outBones[vrmName];
    if (bone) {
      slerpBoneInto(cur, bone, smoothing, bone); // prev === out: safe (atomic read first)
    } else {
      // Safety fallback: should not happen when PoseApplyState is created via createPoseApplyState
      outBones[vrmName] = { x: cur.x, y: cur.y, z: cur.z, w: cur.w };
    }
  }

  return gesture;
}

// ─── ApplyPose options ─────────────────────────────────────────────────────────

export interface ApplyPoseOptions {
  /** Lerp speed: higher value = snappier bone updates */
  lerpSpeed?: number;
  /** Upper clamp so a large delta spike doesn't teleport the bones */
  maxLerpT?: number;
  /** Smoothing factor fed to kalidokit solver (0=snap, 0.9=very smooth) */
  solverSmoothing?: number;
  /** If true, apply visual mirror (left↔right flip) */
  mirror?: boolean;
  /** Whether to apply face movements using kalidokit Face.solve */
  faceEnabled?: boolean;
  /** Whether to apply hand movements using the built-in gesture solver */
  handEnabled?: boolean;
  /**
   * Whether to apply lower-body bone rotations (hips, legs, feet).
   * Defaults to false – lower body is locked so only the upper body animates.
   * Hips position (translation) is still applied regardless of this flag.
   */
  lowerBodyEnabled?: boolean;
  /**
   * Skip the kalidokit solver and reuse the last cached bone targets.
   * Use this for mid-frame re-lerps (60 fps render between 30 fps pose frames)
   * to avoid redundant heavy computation while keeping animation smooth.
   */
  reuseLastSolve?: boolean;
}

const DEFAULT_OPTS: Required<ApplyPoseOptions> = {
  lerpSpeed: 14,
  maxLerpT: 0.9,
  solverSmoothing: 0.5,
  mirror: true,
  faceEnabled: true,
  handEnabled: true,
  lowerBodyEnabled: false,
  reuseLastSolve: false,
};

// ─── State ────────────────────────────────────────────────────────────────────

export interface PoseApplyState {
  prevRotations: Record<string, BoneRotation>;
  /** Cached solver output – reused for 60 fps lerp between 30 fps pose frames */
  cachedBoneRotations: Record<string, BoneRotation> | null;
  cachedHipsPos: { x: number; y: number; z: number } | null;
  /** Pre-allocated hand bone maps; updated in-place each frame (replaces prevLeft/RightHandBones) */
  leftHandBones: Record<string, BoneRotation>;
  rightHandBones: Record<string, BoneRotation>;
}

export function createPoseApplyState(): PoseApplyState {
  const leftHandBones: Record<string, BoneRotation> = {};
  for (const boneName of Object.values(LEFT_HAND_BONE_MAP)) {
    leftHandBones[boneName] = { x: 0, y: 0, z: 0, w: 1 };
  }
  const rightHandBones: Record<string, BoneRotation> = {};
  for (const boneName of Object.values(RIGHT_HAND_BONE_MAP)) {
    rightHandBones[boneName] = { x: 0, y: 0, z: 0, w: 1 };
  }
  return {
    prevRotations: {},
    cachedBoneRotations: null,
    cachedHipsPos: null,
    leftHandBones,
    rightHandBones,
  };
}

// ─── Main apply function ──────────────────────────────────────────────────────

/**
 * Apply a single pose frame to a VRM humanoid.
 *
 * @param vrm        The loaded VRM instance
 * @param state      Mutable state (prev rotations) – update in place
 * @param frame      PoseFrame encompassing pose and optional face landmarks
 * @param delta      Seconds since last frame (from THREE.Timer)
 * @param opts       Tuning options
 */
export function applyPoseToVrm(
  vrm: VRM,
  state: PoseApplyState,
  frame: PoseFrame,
  delta: number,
  opts: ApplyPoseOptions = {},
): void {
  if (!frame.landmarks || frame.landmarks.length < 33) return;

  const { lerpSpeed, maxLerpT, solverSmoothing, mirror, faceEnabled, handEnabled, lowerBodyEnabled, reuseLastSolve } = {
    ...DEFAULT_OPTS,
    ...opts,
  };

  // ── Solver phase (skipped when reuseLastSolve + cache is warm) ────────────
  if (!reuseLastSolve || !state.cachedBoneRotations) {
    const worldLms = frame.worldLandmarks?.length >= 33 ? frame.worldLandmarks : frame.landmarks;
    const { boneRotations, hipsPosition, solved } = solveWithKalidokit(
      worldLms,
      frame.landmarks,
      state.prevRotations,
      solverSmoothing,
      mirror,
    );
    // Only update cache when kalidokit produced a valid result.
    // If poseRig was undefined (e.g. first frame before detector warms up),
    // keep the existing cache so bones hold the last good pose instead of
    // snapping back to T-pose.
    if (solved) {
      state.prevRotations = boneRotations;
      state.cachedBoneRotations = boneRotations;
      state.cachedHipsPos = hipsPosition ?? null;
    } else if (!state.cachedBoneRotations) {
      // No prior cache and solver failed — nothing to apply yet
      return;
    }
  }

  const boneRotations = state.cachedBoneRotations!;
  const hipsPosition = state.cachedHipsPos;

  const humanoid = vrm.humanoid;
  if (!humanoid) return;

  const t = Math.min(1 - Math.exp(-lerpSpeed * delta), maxLerpT);

  for (const [boneName, rot] of Object.entries(boneRotations)) {
    const bone = humanoid.getNormalizedBoneNode(boneName as never);
    if (!bone) continue;

    const isLowerBody = LOWER_BODY_BONES.has(boneName);

    // 鏡像已在 solver 的歐拉角空間完成（轉四元數之前），
    // 此處直接套用，不再於四元數空間做近似反轉。
    // Skip rotation for lower-body bones when lowerBodyEnabled is false.
    if (!isLowerBody || lowerBodyEnabled) {
      _targetQuat.set(rot.x, rot.y, rot.z, rot.w);
      bone.quaternion.slerp(_targetQuat, t);
    }

    // Always apply Hips translation so the avatar stays grounded,
    // regardless of lowerBodyEnabled.
    if (boneName === 'hips' && hipsPosition) {
      const mirrorX = mirror ? -1 : 1;
      bone.position.x = THREE.MathUtils.lerp(bone.position.x, mirrorX * hipsPosition.x * 0.1, t);
      bone.position.y = THREE.MathUtils.lerp(bone.position.y, hipsPosition.y, t);
      bone.position.z = THREE.MathUtils.lerp(bone.position.z, -hipsPosition.z * 0.1, t);
    }
  }

  // ── Apply Hands (gesture-based solver) ────────────────────────────────────
  if (!reuseLastSolve && handEnabled) {
    if (frame.leftHandLandmarks && frame.leftHandLandmarks.length >= 21) {
      const gesture = solveHand(
        frame.leftHandLandmarks as HandLandmark[],
        'Left',
        state.leftHandBones,
        solverSmoothing,
      );
      if (gesture !== null) {
        applyHandBones(humanoid, state.leftHandBones, t);
      }
    }
    if (frame.rightHandLandmarks && frame.rightHandLandmarks.length >= 21) {
      const gesture = solveHand(
        frame.rightHandLandmarks as HandLandmark[],
        'Right',
        state.rightHandBones,
        solverSmoothing,
      );
      if (gesture !== null) {
        applyHandBones(humanoid, state.rightHandBones, t);
      }
    }
  }

  // ── Apply Face ────────────────────────────────────────────────────────────
  // (skip when reuseLastSolve – bones already lerp toward last cached targets)
  if (!reuseLastSolve && faceEnabled && frame.faceLandmarks && frame.faceLandmarks.length >= 478) {
    const faceRig = Face.solve(frame.faceLandmarks as any, {
      runtime: 'mediapipe',
      video: undefined,
      imageSize: { width: 640, height: 480 },
      smoothBlink: true,
      blinkSettings: [0.25, 0.75],
    });

    if (faceRig) {
      // Head Rotation
      const head = humanoid.getNormalizedBoneNode('head');
      if (head) {
        // For visual mirroring, swap Y and Z rotation signs
        const rotX = mirror ? -faceRig.head.x : faceRig.head.x;
        const rotY = mirror ? -faceRig.head.y : faceRig.head.y;
        const rotZ = mirror ? -faceRig.head.z : faceRig.head.z;
        _euler.set(rotX, rotY, rotZ, 'XYZ');
        _targetQuat.setFromEuler(_euler);
        head.quaternion.slerp(_targetQuat, t);
      }

      // Expressions
      const em = vrm.expressionManager;
      if (em) {
        const eyeL = mirror ? faceRig.eye.r : faceRig.eye.l;
        const eyeR = mirror ? faceRig.eye.l : faceRig.eye.r;

        // VRM blink: 0=open, 1=closed. Kalidokit eye: 0=closed, 1=open
        // Prefer split blink only when at least one side has actual morph binds.
        // Some models (e.g. Women_Clerk.vrm) declare blinkLeft/blinkRight as empty
        // shells and bind the actual morph data to the unified 'blink' expression.
        const exprBlinkL = em.getExpression('blinkLeft');
        const exprBlinkR = em.getExpression('blinkRight');
        const hasSplitBinds = (exprBlinkL?.binds.length ?? 0) > 0 || (exprBlinkR?.binds.length ?? 0) > 0;
        if (hasSplitBinds) {
          em.setValue('blinkLeft', THREE.MathUtils.lerp(em.getValue('blinkLeft') ?? 0, 1 - eyeL, t));
          em.setValue('blinkRight', THREE.MathUtils.lerp(em.getValue('blinkRight') ?? 0, 1 - eyeR, t));
        } else {
          // Fall back to unified blink
          const blinkVal = 1 - (eyeL + eyeR) / 2;
          em.setValue('blink', THREE.MathUtils.lerp(em.getValue('blink') ?? 0, blinkVal, t));
        }

        em.setValue('aa', THREE.MathUtils.lerp(em.getValue('aa') ?? 0, faceRig.mouth.shape.A, t));
        em.setValue('ee', THREE.MathUtils.lerp(em.getValue('ee') ?? 0, faceRig.mouth.shape.E, t));
        em.setValue('ih', THREE.MathUtils.lerp(em.getValue('ih') ?? 0, faceRig.mouth.shape.I, t));
        em.setValue('oh', THREE.MathUtils.lerp(em.getValue('oh') ?? 0, faceRig.mouth.shape.O, t));
        em.setValue('ou', THREE.MathUtils.lerp(em.getValue('ou') ?? 0, faceRig.mouth.shape.U, t));
      }
    }
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Apply pre-solved hand bone quaternions directly to the VRM humanoid.
 * The bone map + mirror convention are already baked into the keys by solveHand().
 */
function applyHandBones(
  humanoid: any, // VRMHumanoid
  bones: Record<string, BoneRotation>,
  t: number,
): void {
  for (const [vrmName, rot] of Object.entries(bones)) {
    const bone = humanoid.getNormalizedBoneNode(vrmName as any);
    if (!bone) continue;
    _targetQuat.set(rot.x, rot.y, rot.z, rot.w);
    bone.quaternion.slerp(_targetQuat, t);
  }
}
