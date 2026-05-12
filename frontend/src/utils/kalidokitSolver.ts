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

const DEG = Math.PI / 180

/**
 * Anatomically-plausible per-axis rotation limits (radians), keyed by VRM bone name.
 * Clamps solver output *before* quaternion conversion so a glitched MediaPipe
 * frame can't twist the avatar into impossible poses (e.g. a full 360° head /
 * waist spin). Axes: x = pitch, y = yaw, z = roll. Deliberately generous —
 * only catches clearly-broken frames, not normal motion. Tune freely.
 */
export const BONE_ROTATION_LIMITS: Record<string, { x: number; y: number; z: number }> = {
  head: { x: 50 * DEG, y: 65 * DEG, z: 38 * DEG },
  spine: { x: 40 * DEG, y: 45 * DEG, z: 30 * DEG },
  hips: { x: 30 * DEG, y: 60 * DEG, z: 25 * DEG },
}

/**
 * Max joint angular speed (rad/s) accepted between two solves. A jump faster
 * than this is treated as a tracking glitch and dropped — the bone holds its
 * last good pose for that frame. Time-normalised by the inter-solve dt, so the
 * behaviour is identical whether pose data arrives at 30 fps or 8 fps on a slow
 * device. Set far above any natural human motion.
 */
const MAX_ANGULAR_SPEED_RAD_PER_S = 1800 * DEG

/** Clamp a scalar angle to ±limit. */
export function clampAngle(v: number, limit: number): number {
  return v < -limit ? -limit : v > limit ? limit : v
}

/** In-place clamp of an {x,y,z} Euler triple against a per-axis limit. */
export function clampEulerInPlace(
  e: { x: number; y: number; z: number },
  limit: { x: number; y: number; z: number },
): void {
  e.x = clampAngle(e.x, limit.x)
  e.y = clampAngle(e.y, limit.y)
  e.z = clampAngle(e.z, limit.z)
}

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
  maxStepRad: number,
): BoneRotation {
  if (!prev) return current
  _quatPrev.set(prev.x, prev.y, prev.z, prev.w)
  _quatTarget.set(current.x, current.y, current.z, current.w)

  const angle = _quatPrev.angleTo(_quatTarget)
  // Dead-zone: skip update if angular change is negligible (noise)
  if (angle < DEAD_ZONE_RAD) return prev
  // Velocity gate: a jump too large to be real motion at this frame rate is a
  // tracking glitch — drop it and hold the last good pose.
  if (angle > maxStepRad) return prev

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
 * @param dt    Seconds elapsed since the previous solve. Drives the angular-
 *              velocity gate so glitch rejection is frame-rate independent.
 */
export function solveWithKalidokit(
  worldLandmarks: Landmark[],
  normalizedLandmarks: Landmark[],
  prevRotations: Record<string, BoneRotation>,
  smoothing: number,
  mirror = false,
  dt = 1 / 30,
): {
  boneRotations: Record<string, BoneRotation>
  hipsPosition?: { x: number; y: number; z: number }
  solved: boolean
} {
  if (worldLandmarks.length < 33 || normalizedLandmarks.length < 33) {
    return { boneRotations: prevRotations, solved: false }
  }

  const poseRig = Pose.solve(
    worldLandmarks as Array<{ x: number; y: number; z: number; visibility?: number }>,
    normalizedLandmarks as Array<{ x: number; y: number; z: number; visibility?: number }>,
    {
      runtime: 'mediapipe',
      enableLegs: false,
    },
  ) as KalidokitPoseResult | undefined

  if (!poseRig) return { boneRotations: prevRotations, solved: false }

  // Max per-bone angular step allowed for this solve, derived from the real
  // inter-solve interval (clamped so a stalled tab / huge gap can't disable
  // the gate forever, and a 60 fps re-solve can't make it uselessly tiny).
  const maxStepRad = MAX_ANGULAR_SPEED_RAD_PER_S * Math.min(Math.max(dt, 1 / 120), 0.25)

  // Clamp the whole-body (hips) yaw/pitch/roll first so the relative-spine
  // subtraction below works against a sane reference.
  if (poseRig.Hips) clampEulerInPlace(poseRig.Hips.rotation, BONE_ROTATION_LIMITS.hips)

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

    // Per-bone anatomical clamp (currently: spine). Arms/hands intentionally
    // unclamped — they have a wide natural range.
    const limit = BONE_ROTATION_LIMITS[vrmName]
    if (limit) clampEulerInPlace(euler, limit)

    let zRot = mirror ? -euler.z : euler.z;

    // 修正手臂上下文動作顛倒問題 (Arm up/down inverted fix)
    const isArm = vrmName.toLowerCase().includes('arm') || vrmName.toLowerCase().includes('hand');
    if (mirror && isArm) {
      zRot = euler.z;
    }

    // 鏡像：在歐拉角空間反轉 Y/Z，避免四元數空間的軸交叉耦合
    const mirrored = mirror
      ? { x: euler.x, y: -euler.y, z: zRot }
      : { x: euler.x, y: euler.y, z: euler.z }
    const currentQuat = eulerToQuaternion(mirrored)
    rotations[vrmName] = slerpRotation(currentQuat, prevRotations[vrmName], smoothing, maxStepRad)
  }

  // Handle Hips
  let hipsPosition: { x: number; y: number; z: number } | undefined = undefined
  if (poseRig.Hips) {
    const hipsEuler = poseRig.Hips.rotation
    const mirroredHips = mirror
      ? { x: hipsEuler.x, y: -hipsEuler.y, z: -hipsEuler.z * 0.1 }  // -hipsEuler.z
      : hipsEuler
    const hipsQuat = eulerToQuaternion(mirroredHips)
    rotations.hips = slerpRotation(hipsQuat, prevRotations.hips, smoothing, maxStepRad / 2)

    hipsPosition = {
      x: poseRig.Hips.position.x,
      y: poseRig.Hips.position.y,
      z: poseRig.Hips.position.z,
    }
  }

  return { boneRotations: rotations, hipsPosition, solved: true }
}
