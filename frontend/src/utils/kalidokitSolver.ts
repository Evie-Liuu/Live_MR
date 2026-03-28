import { Pose } from 'kalidokit'
import * as THREE from 'three'

// ─── Types (Internal to solver) ───────────────────────────────────
export interface BoneRotation {
  x: number
  y: number
  z: number
  w: number
}

export interface Landmark {
  x: number
  y: number
  z: number
  visibility?: number
}

interface KalidokitPoseResult {
  RightUpperArm: { x: number; y: number; z: number }
  LeftUpperArm: { x: number; y: number; z: number }
  RightLowerArm: { x: number; y: number; z: number }
  LeftLowerArm: { x: number; y: number; z: number }
  RightUpperLeg: { x: number; y: number; z: number }
  LeftUpperLeg: { x: number; y: number; z: number }
  RightLowerLeg: { x: number; y: number; z: number }
  LeftLowerLeg: { x: number; y: number; z: number }
  RightHand: { x: number; y: number; z: number }
  LeftHand: { x: number; y: number; z: number }
  Spine: { x: number; y: number; z: number }
  Hips: {
    worldPosition: { x: number; y: number; z: number }
    position: { x: number; y: number; z: number }
    rotation: { x: number; y: number; z: number }
  }
}

// ─── Kalidokit bone name → VRM HumanBoneName mapping (Mirror mode) ──
const KALIDOKIT_TO_VRM: Record<string, string> = {
  // Swapped L/R for visual mirroring (左右同向)
  RightUpperArm: 'leftUpperArm',
  LeftUpperArm: 'rightUpperArm',
  RightLowerArm: 'leftLowerArm',
  LeftLowerArm: 'rightLowerArm',
  RightUpperLeg: 'leftUpperLeg',
  LeftUpperLeg: 'rightUpperLeg',
  RightLowerLeg: 'leftLowerLeg',
  LeftLowerLeg: 'rightLowerLeg',
  RightHand: 'leftHand',
  LeftHand: 'rightHand',
  Spine: 'spine',
}

// ─── Reusable THREE objects (avoid GC pressure) ─────────────────────
const _euler = new THREE.Euler()
const _quat = new THREE.Quaternion()
const _quatPrev = new THREE.Quaternion()
const _quatTarget = new THREE.Quaternion()

// Minimum angular change (in radians) to accept a new rotation.
// Changes below this threshold are treated as noise and discarded.
const DEAD_ZONE_RAD = 0.02 // Adjusted from 0.1 to be a bit more responsive but still stable

/**
 * Convert Euler angles (radians, XYZ order) to a BoneRotation quaternion.
 */
function eulerToQuaternion(
  euler: { x: number; y: number; z: number },
): BoneRotation {
  _euler.set(euler.x, euler.y, euler.z, 'XYZ')
  _quat.setFromEuler(_euler)
  return { x: _quat.x, y: _quat.y, z: _quat.z, w: _quat.w }
}

/**
 * Slerp between the previous and current rotation for smoothing.
 */
function slerpRotation(
  current: BoneRotation,
  prev: BoneRotation | undefined,
  smoothingFactor: number,
): BoneRotation {
  if (!prev) return current
  _quatPrev.set(prev.x, prev.y, prev.z, prev.w)
  _quatTarget.set(current.x, current.y, current.z, current.w)

  // Dead-zone: skip update if angular change is negligible
  const angle = _quatPrev.angleTo(_quatTarget)
  if (angle < DEAD_ZONE_RAD) {
    return prev
  }

  // Slerp from previous → target.
  // smoothingFactor: 0 = snap, 0.9 = slow follow
  _quatPrev.slerp(_quatTarget, 1 - smoothingFactor)
  return { x: _quatPrev.x, y: _quatPrev.y, z: _quatPrev.z, w: _quatPrev.w }
}

/**
 * Solve pose using Kalidokit and return VRM bone rotations.
 *
 * @param worldLandmarks 33 world-space landmarks
 * @param normalizedLandmarks 33 normalized landmarks
 * @param prevRotations Previous frame's rotations for smoothing
 * @param smoothing Smoothing factor (0 = no smoothing, 0.9 = very smooth)
 * @param mirror 鏡像模式：在歐拉角空間反轉 Y（偏航）和 Z（翻滾），
 *               必須在轉四元數之前完成，否則軸間會交叉耦合導致側傾
 */
export function solveWithKalidokit(
  worldLandmarks: Landmark[],
  normalizedLandmarks: Landmark[],
  prevRotations: Record<string, BoneRotation>,
  smoothing: number,
  mirror = false,
): {
  boneRotations: Record<string, BoneRotation>
  hipsPosition?: { x: number; y: number; z: number }
} {
  if (worldLandmarks.length < 33 || normalizedLandmarks.length < 33) {
    return { boneRotations: prevRotations }
  }

  const poseRig = Pose.solve(
    worldLandmarks as Array<{ x: number; y: number; z: number; visibility?: number }>,
    normalizedLandmarks as Array<{ x: number; y: number; z: number; visibility?: number }>,
    {
      runtime: 'mediapipe',
      enableLegs: true,
    },
  ) as KalidokitPoseResult | undefined

  if (!poseRig) return { boneRotations: prevRotations }

  const rotations: Record<string, BoneRotation> = {}

  // Kalidokit computes Spine as a world-space rotation (from shoulder landmarks),
  // but VRM Spine is a child of Hips. Subtract Hips rotation so we apply only
  // the *relative* upper-body twist, avoiding double-rotation that causes
  // over-yaw and asymmetric side-tilt when turning.
  if (poseRig.Hips && poseRig.Spine) {
    poseRig.Spine.y -= poseRig.Hips.rotation.y
    poseRig.Spine.z -= poseRig.Hips.rotation.z
  }

  // Convert each Kalidokit bone's Euler rotation → quaternion → smoothed
  for (const [kalidoName, vrmName] of Object.entries(KALIDOKIT_TO_VRM)) {
    const eulerRot = poseRig[kalidoName as keyof KalidokitPoseResult]
    if (!eulerRot || typeof eulerRot !== 'object' || !('x' in eulerRot)) continue

    const euler = eulerRot as { x: number; y: number; z: number }
    // 鏡像：在歐拉角空間反轉 Y/Z，避免四元數空間的軸交叉耦合
    const mirrored = mirror ? { x: euler.x, y: -euler.y, z: -euler.z } : euler
    const currentQuat = eulerToQuaternion(mirrored)
    rotations[vrmName] = slerpRotation(currentQuat, prevRotations[vrmName], smoothing)
  }

  // Handle Hips
  let hipsPosition: { x: number; y: number; z: number } | undefined = undefined
  if (poseRig.Hips) {
    const hipsEuler = poseRig.Hips.rotation
    const mirroredHips = mirror
      ? { x: hipsEuler.x, y: -hipsEuler.y, z: -hipsEuler.z }
      : hipsEuler
    const hipsQuat = eulerToQuaternion(mirroredHips)
    rotations.hips = slerpRotation(hipsQuat, prevRotations.hips, smoothing)

    hipsPosition = {
      x: poseRig.Hips.position.x,
      y: poseRig.Hips.position.y,
      z: poseRig.Hips.position.z,
    }
  }

  return { boneRotations: rotations, hipsPosition }
}
