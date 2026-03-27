/**
 * poseCodec.ts – Compact binary encoding for PoseFrame.
 *
 * Wire format
 * ───────────
 *   Bytes 0‥3  header (4 bytes, 4-byte aligned)
 *              byte 0  flags  (uint8)
 *                        bit 0  hasWorldLandmarks
 *                        bit 1  hasFaceLandmarks (468 × xyz Float32)
 *              bytes 1‥3  reserved / padding (zero)
 *   Bytes 4‥399   pose  landmarks  33 × 3 Float32  (x,y,z; visibility dropped)
 *   Bytes …‥795   world landmarks  33 × 3 Float32  (present when bit 0)
 *   Bytes …       face  landmarks 468 × 3 Float32  (present when bit 1)
 *
 * Size comparison vs JSON
 * ───────────────────────
 *   pose only          :  400 B  vs ~2.6 KB  → 6.5×
 *   pose + world       :  796 B  vs ~5.3 KB  → 6.6×
 *   pose + world + face: 6.4 KB  vs  ~37 KB  → 5.7×
 *
 * Backward compat: first byte 0x7B = '{' → treat as legacy JSON.
 */
import type { PoseFrame, PoseLandmark } from '../types/vrm';

const POSE_N = 33;
const FACE_N = 468;
const FLAG_WORLD = 1 << 0;
const FLAG_FACE  = 1 << 1;
/** Header is 4 bytes so Float32 body starts at a 4-byte-aligned offset */
const HEADER = 4;

// ─── Encoder ─────────────────────────────────────────────────────────────────

export function encodePoseFrame(frame: PoseFrame): Uint8Array {
  const hasWorld = (frame.worldLandmarks?.length ?? 0) >= POSE_N;
  const hasFace  = (frame.faceLandmarks?.length  ?? 0) >= FACE_N;

  let flags = 0;
  if (hasWorld) flags |= FLAG_WORLD;
  if (hasFace)  flags |= FLAG_FACE;

  const nFloats =
    POSE_N * 3 +
    (hasWorld ? POSE_N * 3  : 0) +
    (hasFace  ? FACE_N * 3  : 0);

  const buf = new ArrayBuffer(HEADER + nFloats * 4);
  new DataView(buf).setUint8(0, flags);
  // Float32Array body starts at byte HEADER (4-byte aligned)
  const f32 = new Float32Array(buf, HEADER);

  let off = 0;
  const write = (lms: PoseLandmark[]) => {
    for (const l of lms) { f32[off++] = l.x; f32[off++] = l.y; f32[off++] = l.z; }
  };

  write(frame.landmarks);
  if (hasWorld) write(frame.worldLandmarks!);
  if (hasFace)  write(frame.faceLandmarks!);

  return new Uint8Array(buf);
}

// ─── Decoder ─────────────────────────────────────────────────────────────────

function readLandmarks(f32: Float32Array, offset: number, n: number): PoseLandmark[] {
  const out: PoseLandmark[] = [];
  for (let i = 0; i < n; i++) {
    const b = offset + i * 3;
    out.push({ x: f32[b], y: f32[b + 1], z: f32[b + 2], visibility: 1 });
  }
  return out;
}

export function decodePoseFrame(data: Uint8Array): PoseFrame {
  // Legacy JSON fallback (first byte = '{')
  if (data[0] === 0x7b) {
    return JSON.parse(new TextDecoder().decode(data)) as PoseFrame;
  }

  const flags = data[0];
  // slice() creates a fresh Uint8Array with byteOffset=0, ensuring the
  // Float32Array view below is always 4-byte aligned regardless of the
  // incoming buffer's byteOffset (e.g. LiveKit received packets).
  const body = data.slice(HEADER);
  const f32  = new Float32Array(body.buffer);

  const hasWorld = !!(flags & FLAG_WORLD);
  const hasFace  = !!(flags & FLAG_FACE);

  let off = 0;
  const landmarks = readLandmarks(f32, off, POSE_N); off += POSE_N * 3;

  let worldLandmarks: PoseLandmark[] = landmarks; // fallback
  if (hasWorld) {
    worldLandmarks = readLandmarks(f32, off, POSE_N); off += POSE_N * 3;
  }

  let faceLandmarks: PoseLandmark[] | undefined;
  if (hasFace) {
    faceLandmarks = readLandmarks(f32, off, FACE_N);
  }

  return { type: 'pose', landmarks, worldLandmarks, faceLandmarks };
}
