/**
 * handSolver.ts
 *
 * Detects "Open" or "Fist" hand gestures from 21 MediaPipe HandLandmarker
 * points and outputs fixed VRM finger-bone quaternion rotations.
 *
 * Deliberately avoids per-finger Kalidokit detail to eliminate jitter.
 * Only gesture-level (Open / Fist) rotations are applied.
 *
 * Mirror note: Live_MR uses visual mirroring (camera-flip), so Left/Right
 * are already swapped at the VRM bone level (same convention as kalidokitSolver.ts).
 *   MediaPipe "Left" hand (person left) → VRM 'rightHand' etc.
 *   MediaPipe "Right" hand (person right) → VRM 'leftHand' etc.
 */

import * as THREE from 'three'
import type { BoneRotation } from './kalidokitSolver'

// ─── Landmark type (subset of PoseLandmark) ─────────────────────────────────

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
  ThumbProximal:     'rightThumbMetacarpal',
  ThumbIntermediate: 'rightThumbProximal',
  ThumbDistal:       'rightThumbDistal',
  // Index
  IndexProximal:     'rightIndexProximal',
  IndexIntermediate: 'rightIndexIntermediate',
  IndexDistal:       'rightIndexDistal',
  // Middle
  MiddleProximal:     'rightMiddleProximal',
  MiddleIntermediate: 'rightMiddleIntermediate',
  MiddleDistal:       'rightMiddleDistal',
  // Ring
  RingProximal:     'rightRingProximal',
  RingIntermediate: 'rightRingIntermediate',
  RingDistal:       'rightRingDistal',
  // Little
  LittleProximal:     'rightLittleProximal',
  LittleIntermediate: 'rightLittleIntermediate',
  LittleDistal:       'rightLittleDistal',
}

/** MediaPipe "Right" hand → VRM left-side bones (mirror convention) */
const RIGHT_HAND_BONE_MAP: Record<string, string> = {
  Wrist: 'leftHand',
  ThumbProximal:     'leftThumbMetacarpal',
  ThumbIntermediate: 'leftThumbProximal',
  ThumbDistal:       'leftThumbDistal',
  IndexProximal:     'leftIndexProximal',
  IndexIntermediate: 'leftIndexIntermediate',
  IndexDistal:       'leftIndexDistal',
  MiddleProximal:     'leftMiddleProximal',
  MiddleIntermediate: 'leftMiddleIntermediate',
  MiddleDistal:       'leftMiddleDistal',
  RingProximal:     'leftRingProximal',
  RingIntermediate: 'leftRingIntermediate',
  RingDistal:       'leftRingDistal',
  LittleProximal:     'leftLittleProximal',
  LittleIntermediate: 'leftLittleIntermediate',
  LittleDistal:       'leftLittleDistal',
}

// ─── Gesture constants (fixed Euler angles for each bone role) ────────────────

/** Open hand: all fingers straight → zero rotation */
const EULER_OPEN = { x: 0, y: 0, z: 0 }

/**
 * Fist curl values.
 * Kalidokit / VRM convention: Z-axis flexes fingers.
 * Left VRM hand curls with negative Z, Right with positive Z.
 */
const FIST_FINGER_L = { x: 0, y: 0, z: -0.9 }   // VRM left fingers
const FIST_FINGER_R = { x: 0, y: 0, z:  0.9 }   // VRM right fingers

const FIST_THUMB_L  = { x: 0.6, y:  0.2, z: -0.3 }  // VRM left thumb
const FIST_THUMB_R  = { x: 0.6, y: -0.2, z:  0.3 }  // VRM right thumb

// ─── Reusable THREE objects ──────────────────────────────────────────────────

const _euler  = new THREE.Euler()
const _quat   = new THREE.Quaternion()
const _prev   = new THREE.Quaternion()
const _target = new THREE.Quaternion()

function eulerToBoneRot(e: { x: number; y: number; z: number }): BoneRotation {
  _euler.set(e.x, e.y, e.z, 'XYZ')
  _quat.setFromEuler(_euler)
  return { x: _quat.x, y: _quat.y, z: _quat.z, w: _quat.w }
}

function slerpBone(
  cur: BoneRotation,
  prev: BoneRotation | undefined,
  smoothing: number,
): BoneRotation {
  if (!prev) return cur
  _prev.set(prev.x, prev.y, prev.z, prev.w)
  _target.set(cur.x, cur.y, cur.z, cur.w)
  _prev.slerp(_target, 1 - smoothing)
  return { x: _prev.x, y: _prev.y, z: _prev.z, w: _prev.w }
}

// ─── Gesture detection ────────────────────────────────────────────────────────

/**
 * Detect whether the hand is Open or Fist using landmark distances.
 * Compares each fingertip distance from wrist vs its MCP joint distance.
 * If fingertip is closer to wrist than ~1.2× MCP distance → curled.
 */
function detectGesture(landmarks: HandLandmark[]): 'Open' | 'Fist' {
  const wrist = landmarks[0]
  if (!wrist) return 'Open'

  // Index=8/5, Middle=12/9, Ring=16/13, Little=20/17
  const fingers = [
    { tip: 8,  mcp: 5  },
    { tip: 12, mcp: 9  },
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

// ─── Public interface ─────────────────────────────────────────────────────────

export type HandGesture = 'Open' | 'Fist'

export interface SolveHandResult {
  /** VRM bone name → quaternion rotation */
  bones: Record<string, BoneRotation>
  gesture: HandGesture
}

/**
 * Solve one hand's VRM finger-bone rotations from 21 MediaPipe landmarks.
 *
 * @param landmarks  21 normalized hand landmarks from HandLandmarker
 * @param side       MediaPipe handedness ("Left" | "Right") – person's perspective
 * @param prevBones  Previous frame's bone rotations for slerp smoothing
 * @param smoothing  0 = snap to target, 0.9 = very slow follow
 */
export function solveHand(
  landmarks: HandLandmark[],
  side: 'Left' | 'Right',
  prevBones: Record<string, BoneRotation>,
  smoothing: number,
): SolveHandResult | null {
  if (landmarks.length < 21) return null

  const gesture = detectGesture(landmarks)

  // Mirror: MediaPipe Left → VRM Right, MediaPipe Right → VRM Left
  const boneMap    = side === 'Left' ? LEFT_HAND_BONE_MAP  : RIGHT_HAND_BONE_MAP
  // VRM side is flipped due to mirror
  const vrmSide    = side === 'Left' ? 'Right' : 'Left'  // which VRM side we're writing
  const isVrmLeft  = vrmSide === 'Left'

  const result: Record<string, BoneRotation> = {}

  for (const [role, vrmName] of Object.entries(boneMap)) {
    let euler: { x: number; y: number; z: number }

    if (role === 'Wrist') {
      // Keep wrist at neutral; wrist orientation comes from the pose arm solver
      euler = EULER_OPEN
    } else if (gesture === 'Open') {
      euler = EULER_OPEN
    } else {
      // Fist
      if (role.startsWith('Thumb')) {
        euler = isVrmLeft ? FIST_THUMB_L : FIST_THUMB_R
      } else {
        euler = isVrmLeft ? FIST_FINGER_L : FIST_FINGER_R
      }
    }

    const cur = eulerToBoneRot(euler)
    result[vrmName] = slerpBone(cur, prevBones[vrmName], smoothing)
  }

  return { bones: result, gesture }
}
