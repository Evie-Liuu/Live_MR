/**
 * vrmPoseApplier.ts
 *
 * Shared VRM bone-drive logic used by both:
 *  - useVrmAvatar  (single-avatar tile, transparent background)
 *  - useBigScreenScene (multi-avatar big screen)
 *
 * Extracts the apply-pose routine so it doesn't live in two places.
 */
import * as THREE from 'three';
import { solveWithKalidokit, type BoneRotation } from './kalidokitSolver';
import { Face, Hand } from 'kalidokit';
import type { VRM } from '@pixiv/three-vrm';
import type { PoseFrame } from '../types/vrm';

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
  /** Whether to apply hand movements using kalidokit Hand.solve */
  handEnabled?: boolean;
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
  reuseLastSolve: false,
};

// Reusable Quaternion – avoids per-frame allocations
const _targetQuat = new THREE.Quaternion();

export interface PoseApplyState {
  prevRotations: Record<string, BoneRotation>;
  /** Cached solver output – reused for 60 fps lerp between 30 fps pose frames */
  cachedBoneRotations: Record<string, BoneRotation> | null;
  cachedHipsPos: { x: number; y: number; z: number } | null;
}

export function createPoseApplyState(): PoseApplyState {
  return { prevRotations: {}, cachedBoneRotations: null, cachedHipsPos: null };
}

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

  const { lerpSpeed, maxLerpT, solverSmoothing, mirror, faceEnabled, handEnabled, reuseLastSolve } = {
    ...DEFAULT_OPTS,
    ...opts,
  };

  // ── Solver phase (skipped when reuseLastSolve + cache is warm) ────────────
  if (!reuseLastSolve || !state.cachedBoneRotations) {
    if (!frame.landmarks || frame.landmarks.length < 33) return;
    const worldLms = frame.worldLandmarks?.length >= 33 ? frame.worldLandmarks : frame.landmarks;
    const { boneRotations, hipsPosition } = solveWithKalidokit(
      worldLms,
      frame.landmarks,
      state.prevRotations,
      solverSmoothing,
      mirror,
    );
    state.prevRotations = boneRotations;
    state.cachedBoneRotations = boneRotations;
    state.cachedHipsPos = hipsPosition ?? null;
  }

  const boneRotations = state.cachedBoneRotations!;
  const hipsPosition = state.cachedHipsPos;

  const humanoid = vrm.humanoid;
  if (!humanoid) return;

  const t = Math.min(1 - Math.exp(-lerpSpeed * delta), maxLerpT);

  for (const [boneName, rot] of Object.entries(boneRotations)) {
    const bone = humanoid.getNormalizedBoneNode(boneName as never);
    if (!bone) continue;

    // 鏡像已在 solver 的歐拉角空間完成（轉四元數之前），
    // 此處直接套用，不再於四元數空間做近似反轉。
    _targetQuat.set(rot.x, rot.y, rot.z, rot.w);
    bone.quaternion.slerp(_targetQuat, t);

    // Apply Hips translation
    if (boneName === 'hips' && hipsPosition) {
      const mirrorX = mirror ? -1 : 1;
      bone.position.x = THREE.MathUtils.lerp(bone.position.x, mirrorX * hipsPosition.x, t) * 0.1;  // 1
      bone.position.y = THREE.MathUtils.lerp(bone.position.y, hipsPosition.y, t);
      bone.position.z = THREE.MathUtils.lerp(bone.position.z, -hipsPosition.z, t) * 0.1;  // 1
    }
  }

  // Apply Hands if enabled
  if (!reuseLastSolve && handEnabled) {
    if (frame.leftHandLandmarks && frame.leftHandLandmarks.length >= 21) {
      const leftHandRig = Hand.solve(frame.leftHandLandmarks as any, 'Left');
      if (leftHandRig) applyHandRig(humanoid, leftHandRig, 'Left', mirror, t);
    }
    if (frame.rightHandLandmarks && frame.rightHandLandmarks.length >= 21) {
      const rightHandRig = Hand.solve(frame.rightHandLandmarks as any, 'Right');
      if (rightHandRig) applyHandRig(humanoid, rightHandRig, 'Right', mirror, t);
    }
  }

  // Apply Face if enabled, new data available, and landmarks exist
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
        _targetQuat.setFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'XYZ'));
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

/**
 * Applies Hand.solve results to the VRM finger bones.
 */
function applyHandRig(
  humanoid: any, // VRMHumanoid
  handRig: any,
  side: 'Left' | 'Right',
  mirror: boolean,
  t: number
) {
  const vrmSide = mirror ? (side === 'Left' ? 'Right' : 'Left') : side;
  const prefix = vrmSide === 'Left' ? 'left' : 'right';

  // Map Kalidokit names to VRM node names (excluding wrist to avoid overriding pose arm solver)
  const bones = [
    { k: 'ThumbProximal', v: 'ThumbMetacarpal' },
    { k: 'ThumbIntermediate', v: 'ThumbProximal' },
    { k: 'ThumbDistal', v: 'ThumbDistal' },
    { k: 'IndexProximal', v: 'IndexProximal' },
    { k: 'IndexIntermediate', v: 'IndexIntermediate' },
    { k: 'IndexDistal', v: 'IndexDistal' },
    { k: 'MiddleProximal', v: 'MiddleProximal' },
    { k: 'MiddleIntermediate', v: 'MiddleIntermediate' },
    { k: 'MiddleDistal', v: 'MiddleDistal' },
    { k: 'RingProximal', v: 'RingProximal' },
    { k: 'RingIntermediate', v: 'RingIntermediate' },
    { k: 'RingDistal', v: 'RingDistal' },
    { k: 'LittleProximal', v: 'LittleProximal' },
    { k: 'LittleIntermediate', v: 'LittleIntermediate' },
    { k: 'LittleDistal', v: 'LittleDistal' },
  ];

  for (const { k, v } of bones) {
    const key = `${side}${k}`;
    const rot = handRig[key];
    if (!rot) continue;

    const vrmName = `${prefix}${v}`;
    const bone = humanoid.getNormalizedBoneNode(vrmName as any);
    if (!bone) continue;

    // For visual mirroring, swap Y and Z rotation signs
    const rotX = rot.x;
    const rotY = mirror ? -rot.y : rot.y;
    const rotZ = mirror ? -rot.z : rot.z;

    _targetQuat.setFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'XYZ'));
    bone.quaternion.slerp(_targetQuat, t);
  }
}
