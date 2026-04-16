// frontend/src/utils/gestureDetector.ts
import type { PoseLandmark } from '../types/vrm';

/**
 * Returns true if the hand is in a fist: at least 3 of 4 fingers curled.
 * Expects 21-point MediaPipe HandLandmarker landmarks (image space, y↓).
 * Fingertip curled = tip.y > pip.y (tip below middle knuckle in image).
 */
export function detectFist(landmarks: PoseLandmark[]): boolean {
  if (landmarks.length < 21) return false;
  const fingers = [
    { tip: 8,  pip: 6  }, // index
    { tip: 12, pip: 10 }, // middle
    { tip: 16, pip: 14 }, // ring
    { tip: 20, pip: 18 }, // pinky
  ];
  const curled = fingers.filter(f => landmarks[f.tip].y > landmarks[f.pip].y).length;
  return curled >= 3;
}

/**
 * Returns true if the hand is open: at least 3 of 4 fingers extended.
 * Finger extended = tip.y < pip.y.
 */
export function detectOpenHand(landmarks: PoseLandmark[]): boolean {
  if (landmarks.length < 21) return false;
  const fingers = [
    { tip: 8,  pip: 6  },
    { tip: 12, pip: 10 },
    { tip: 16, pip: 14 },
    { tip: 20, pip: 18 },
  ];
  const extended = fingers.filter(f => landmarks[f.tip].y < landmarks[f.pip].y).length;
  return extended >= 3;
}

/**
 * Returns true if the hand wrist is above the hip (image-space, y↓).
 * Uses 33-point PoseLandmarker landmarks.
 *   right: wrist=pose[16], hip=pose[24]
 *   left:  wrist=pose[15], hip=pose[23]
 */
export function isHandRaised(
  poseLandmarks: PoseLandmark[],
  hand: 'left' | 'right',
): boolean {
  if (poseLandmarks.length < 25) return false;
  const wristIdx = hand === 'right' ? 16 : 15;
  const hipIdx   = hand === 'right' ? 24 : 23;
  return poseLandmarks[wristIdx].y < poseLandmarks[hipIdx].y;
}

/**
 * Returns true if the wrist UV is within `threshold` distance of the prop UV.
 * Both coordinates are normalised [0,1] screen/image space.
 */
export function isHandNearProp(
  wristUV: { x: number; y: number },
  propUV:  { x: number; y: number },
  threshold = 0.15,
): boolean {
  const dx = wristUV.x - propUV.x;
  const dy = wristUV.y - propUV.y;
  return Math.sqrt(dx * dx + dy * dy) <= threshold;
}
