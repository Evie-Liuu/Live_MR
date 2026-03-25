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
import type { VRM } from '@pixiv/three-vrm';
import type { PoseLandmark } from '../types/vrm';

export interface ApplyPoseOptions {
  /** Lerp speed: higher value = snappier bone updates */
  lerpSpeed?: number;
  /** Upper clamp so a large delta spike doesn't teleport the bones */
  maxLerpT?: number;
  /** Smoothing factor fed to kalidokit solver (0=snap, 0.9=very smooth) */
  solverSmoothing?: number;
  /** If true, apply visual mirror (left↔right flip) */
  mirror?: boolean;
}

const DEFAULT_OPTS: Required<ApplyPoseOptions> = {
  lerpSpeed: 14,
  maxLerpT: 0.9,
  solverSmoothing: 0.5,
  mirror: true,
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
 * @param landmarks  33 normalized landmarks from MediaPipe
 * @param worldLandmarks  33 world-space landmarks from MediaPipe
 * @param delta      Seconds since last frame (from THREE.Timer)
 * @param opts       Tuning options
 */
export function applyPoseToVrm(
  vrm: VRM,
  state: PoseApplyState,
  landmarks: PoseLandmark[],
  worldLandmarks: PoseLandmark[],
  delta: number,
  opts: ApplyPoseOptions = {},
): void {
  if (landmarks.length < 33) return;

  const { lerpSpeed, maxLerpT, solverSmoothing, mirror } = {
    ...DEFAULT_OPTS,
    ...opts,
  };

  const worldLms = worldLandmarks.length >= 33 ? worldLandmarks : landmarks;

  const { boneRotations, hipsPosition } = solveWithKalidokit(
    worldLms,
    landmarks,
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
}
