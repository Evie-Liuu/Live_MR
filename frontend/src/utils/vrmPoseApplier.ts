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
import { Face } from 'kalidokit';
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
}

const DEFAULT_OPTS: Required<ApplyPoseOptions> = {
  lerpSpeed: 14,
  maxLerpT: 0.9,
  solverSmoothing: 0.5,
  mirror: true,
  faceEnabled: true,
};

// Reusable Quaternion – avoids per-frame allocations
const _targetQuat = new THREE.Quaternion();

export interface PoseApplyState {
  prevRotations: Record<string, BoneRotation>;
}

export function createPoseApplyState(): PoseApplyState {
  return { prevRotations: {} };
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

  const { lerpSpeed, maxLerpT, solverSmoothing, mirror, faceEnabled } = {
    ...DEFAULT_OPTS,
    ...opts,
  };

  const worldLms = frame.worldLandmarks?.length >= 33 ? frame.worldLandmarks : frame.landmarks;

  const { boneRotations, hipsPosition } = solveWithKalidokit(
    worldLms,
    frame.landmarks,
    state.prevRotations,
    solverSmoothing,
  );

  state.prevRotations = boneRotations;

  const humanoid = vrm.humanoid;
  if (!humanoid) return;

  const t = Math.min(1 - Math.exp(-lerpSpeed * delta), maxLerpT);

  for (const [boneName, rot] of Object.entries(boneRotations)) {
    const bone = humanoid.getNormalizedBoneNode(boneName as never);
    if (!bone) continue;

    // Mirror horizontal axes (Y-Yaw and Z-Roll) for visual mirroring (左右同向)
    if (mirror) {
      _targetQuat.set(rot.x, -rot.y, rot.z, rot.w);
    } else {
      _targetQuat.set(rot.x, rot.y, rot.z, rot.w);
    }
    bone.quaternion.slerp(_targetQuat, t);

    // Apply Hips translation
    if (boneName === 'hips' && hipsPosition) {
      const mirrorX = mirror ? -1 : 1;
      bone.position.x = THREE.MathUtils.lerp(bone.position.x, mirrorX * hipsPosition.x, t);
      bone.position.y = THREE.MathUtils.lerp(bone.position.y, hipsPosition.y, t);
      bone.position.z = THREE.MathUtils.lerp(bone.position.z, -hipsPosition.z, t);
    }
  }

  // Apply Face if enabled and landmarks exist
  if (faceEnabled && frame.faceLandmarks && frame.faceLandmarks.length >= 468) {
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
        const rotY = mirror ? -faceRig.head.y : faceRig.head.y;
        const rotZ = mirror ? -faceRig.head.z : faceRig.head.z;
        _targetQuat.setFromEuler(new THREE.Euler(faceRig.head.x, rotY, rotZ, 'XYZ'));
        head.quaternion.slerp(_targetQuat, t);
      }

      // Expressions
      const em = vrm.expressionManager;
      if (em) {
        const eyeL = mirror ? faceRig.eye.r : faceRig.eye.l;
        const eyeR = mirror ? faceRig.eye.l : faceRig.eye.r;

        // VRM blink: 0=open, 1=closed. Kalidokit eye: 0=closed, 1=open
        em.setValue('blinkLeft', THREE.MathUtils.lerp(em.getValue('blinkLeft') ?? 0, 1 - eyeL, t));
        em.setValue('blinkRight', THREE.MathUtils.lerp(em.getValue('blinkRight') ?? 0, 1 - eyeR, t));

        em.setValue('aa', THREE.MathUtils.lerp(em.getValue('aa') ?? 0, faceRig.mouth.shape.A, t));
        em.setValue('ee', THREE.MathUtils.lerp(em.getValue('ee') ?? 0, faceRig.mouth.shape.E, t));
        em.setValue('ih', THREE.MathUtils.lerp(em.getValue('ih') ?? 0, faceRig.mouth.shape.I, t));
        em.setValue('oh', THREE.MathUtils.lerp(em.getValue('oh') ?? 0, faceRig.mouth.shape.O, t));
        em.setValue('ou', THREE.MathUtils.lerp(em.getValue('ou') ?? 0, faceRig.mouth.shape.U, t));
      }
    }
  }
}
