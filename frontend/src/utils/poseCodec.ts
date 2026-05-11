/**
 * poseCodec.ts – Compact binary encoding for PoseFrame.
 *
 * Wire format
 * ───────────
 *   Bytes 0‥3  header (4 bytes, 4-byte aligned)
 *              byte 0  flags  (uint8)
 *                        bit 0  hasWorldLandmarks
 *                        bit 1  hasFaceLandmarks (478 × xyz Float32)
 *              bytes 1‥3  reserved / padding (zero)
 *   Bytes 4‥399   pose  landmarks  33 × 3 Float32  (x,y,z; visibility dropped)
 *   Bytes …‥795   world landmarks  33 × 3 Float32  (present when bit 0)
 *   Bytes …       face  landmarks 478 × 3 Float32  (present when bit 1)
 *
 * Size comparison vs JSON
 * ───────────────────────
 *   pose only          :  400 B  vs ~2.6 KB  → 6.5×
 *   pose + world       :  796 B  vs ~5.3 KB  → 6.6×
 *   pose + world + face: 6.5 KB  vs  ~37 KB  → 5.7×
 *
 * Backward compat: first byte 0x7B = '{' → treat as legacy JSON.
 */
import type { PoseFrame, PoseLandmark } from '../types/vrm';

const POSE_N = 33;
/** MediaPipe FaceLandmarker returns 478 points: 468 face mesh + 10 iris.
 *  Kalidokit's calcEyes() requires exactly 478 landmarks for eye-open detection;
 *  with fewer it returns { l: 1, r: 1 } (always open), breaking blink tracking. */
const FACE_N = 478;
/** Each hand has 21 landmarks */
const HAND_N = 21;
const FLAG_WORLD     = 1 << 0;
const FLAG_FACE      = 1 << 1;
const FLAG_LEFT_HAND = 1 << 2;  // person's left hand
const FLAG_RIGHT_HAND= 1 << 3;  // person's right hand
/** Header is 4 bytes so Float32 body starts at a 4-byte-aligned offset */
const HEADER = 4;

// ─── Encoder ─────────────────────────────────────────────────────────────────

export function encodePoseFrame(frame: PoseFrame): Uint8Array {
  const hasWorld     = (frame.worldLandmarks?.length      ?? 0) >= POSE_N;
  const hasFace      = (frame.faceLandmarks?.length       ?? 0) >= FACE_N;
  const hasLeftHand  = (frame.leftHandLandmarks?.length   ?? 0) >= HAND_N;
  const hasRightHand = (frame.rightHandLandmarks?.length  ?? 0) >= HAND_N;

  let flags = 0;
  if (hasWorld)     flags |= FLAG_WORLD;
  if (hasFace)      flags |= FLAG_FACE;
  if (hasLeftHand)  flags |= FLAG_LEFT_HAND;
  if (hasRightHand) flags |= FLAG_RIGHT_HAND;

  const nFloats =
    POSE_N * 3 +
    (hasWorld     ? POSE_N * 3 : 0) +
    (hasFace      ? FACE_N * 3 : 0) +
    (hasLeftHand  ? HAND_N * 3 : 0) +
    (hasRightHand ? HAND_N * 3 : 0);

  const buf = new ArrayBuffer(HEADER + nFloats * 4);
  new DataView(buf).setUint8(0, flags);
  // Float32Array body starts at byte HEADER (4-byte aligned)
  const f32 = new Float32Array(buf, HEADER);

  let off = 0;
  const write = (lms: PoseLandmark[]) => {
    for (const l of lms) { f32[off++] = l.x; f32[off++] = l.y; f32[off++] = l.z; }
  };

  write(frame.landmarks);
  if (hasWorld)     write(frame.worldLandmarks!);
  if (hasFace)      write(frame.faceLandmarks!);
  if (hasLeftHand)  write(frame.leftHandLandmarks!);
  if (hasRightHand) write(frame.rightHandLandmarks!);

  return new Uint8Array(buf);
}

// ─── Decoder ─────────────────────────────────────────────────────────────────

function fillLandmarks(buf: PoseLandmark[], f32: Float32Array, offset: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const b = offset + i * 3;
    buf[i].x = f32[b]; buf[i].y = f32[b + 1]; buf[i].z = f32[b + 2];
  }
}

function makeBuf(n: number): PoseLandmark[] {
  return Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
}

/** One pre-allocated decode slot (3 per identity keep React renders safe). */
interface DecodeSlot {
  frame: PoseFrame;
  poseBuf: PoseLandmark[];
  worldBuf: PoseLandmark[];
  faceBuf: PoseLandmark[];
  leftHandBuf: PoseLandmark[];
  rightHandBuf: PoseLandmark[];
}

function makeSlot(): DecodeSlot {
  const poseBuf      = makeBuf(POSE_N);
  const worldBuf     = makeBuf(POSE_N);
  const faceBuf      = makeBuf(FACE_N);
  const leftHandBuf  = makeBuf(HAND_N);
  const rightHandBuf = makeBuf(HAND_N);
  return {
    frame: { type: 'pose', landmarks: poseBuf, worldLandmarks: worldBuf },
    poseBuf, worldBuf, faceBuf, leftHandBuf, rightHandBuf,
  };
}

export interface PoseDecodePool {
  decode(data: Uint8Array): PoseFrame;
}

/**
 * Returns a per-identity pool that reuses 3 pre-allocated PoseFrame slots,
 * eliminating per-frame object allocation in the decoder hot path.
 * Use one pool per remote participant; safe to discard when they leave.
 */
export function createPoseDecodePool(): PoseDecodePool {
  const slots: DecodeSlot[] = [makeSlot(), makeSlot(), makeSlot()];
  let idx = 0;

  return {
    decode(data: Uint8Array): PoseFrame {
      // Legacy JSON fallback (first byte = '{')
      if (data[0] === 0x7b) {
        return JSON.parse(new TextDecoder().decode(data)) as PoseFrame;
      }

      const slot = slots[idx];
      idx = (idx + 1) % 3;

      const flags = data[0];
      const body = data.slice(HEADER);
      const f32  = new Float32Array(body.buffer);

      let off = 0;
      fillLandmarks(slot.poseBuf, f32, off, POSE_N); off += POSE_N * 3;
      slot.frame.landmarks = slot.poseBuf;

      if (flags & FLAG_WORLD) {
        fillLandmarks(slot.worldBuf, f32, off, POSE_N); off += POSE_N * 3;
        slot.frame.worldLandmarks = slot.worldBuf;
      } else {
        slot.frame.worldLandmarks = slot.poseBuf; // same-ref fallback
      }

      if (flags & FLAG_FACE) {
        fillLandmarks(slot.faceBuf, f32, off, FACE_N); off += FACE_N * 3;
        slot.frame.faceLandmarks = slot.faceBuf;
      } else {
        slot.frame.faceLandmarks = undefined;
      }

      if (flags & FLAG_LEFT_HAND) {
        fillLandmarks(slot.leftHandBuf, f32, off, HAND_N); off += HAND_N * 3;
        slot.frame.leftHandLandmarks = slot.leftHandBuf;
      } else {
        slot.frame.leftHandLandmarks = undefined;
      }

      if (flags & FLAG_RIGHT_HAND) {
        fillLandmarks(slot.rightHandBuf, f32, off, HAND_N);
        slot.frame.rightHandLandmarks = slot.rightHandBuf;
      } else {
        slot.frame.rightHandLandmarks = undefined;
      }

      return slot.frame;
    },
  };
}

/** Backward-compat single-shot decoder (allocates per call). */
export function decodePoseFrame(data: Uint8Array): PoseFrame {
  if (data[0] === 0x7b) {
    return JSON.parse(new TextDecoder().decode(data)) as PoseFrame;
  }
  const flags = data[0];
  const body = data.slice(HEADER);
  const f32  = new Float32Array(body.buffer);
  const read = (offset: number, n: number): PoseLandmark[] => {
    const out = makeBuf(n);
    fillLandmarks(out, f32, offset, n);
    return out;
  };
  let off = 0;
  const landmarks = read(off, POSE_N); off += POSE_N * 3;
  let worldLandmarks: PoseLandmark[] = landmarks;
  if (flags & FLAG_WORLD) { worldLandmarks = read(off, POSE_N); off += POSE_N * 3; }
  let faceLandmarks: PoseLandmark[] | undefined;
  if (flags & FLAG_FACE) { faceLandmarks = read(off, FACE_N); off += FACE_N * 3; }
  let leftHandLandmarks: PoseLandmark[] | undefined;
  if (flags & FLAG_LEFT_HAND) { leftHandLandmarks = read(off, HAND_N); off += HAND_N * 3; }
  let rightHandLandmarks: PoseLandmark[] | undefined;
  if (flags & FLAG_RIGHT_HAND) { rightHandLandmarks = read(off, HAND_N); }
  return { type: 'pose', landmarks, worldLandmarks, faceLandmarks, leftHandLandmarks, rightHandLandmarks };
}
