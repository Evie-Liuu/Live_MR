/**
 * 教師端自己的鏡頭畫面：依姿勢追蹤結果判斷「現在追蹤得好不好」，用一句話提示老師調整位置。
 * 左右以本人為準（MediaPipe 的 left = 本人的左邊），畫面是照鏡子的方向，所以左手也在畫面左邊。
 */
import type { PoseLandmark } from '../types/vrm.ts';

export type SelfViewLevel = 'ok' | 'partial' | 'lost';

export interface SelfViewStatus {
  level: SelfViewLevel;
  text: string;
}

/** 超過這麼久沒收到新的姿勢就當作沒偵測到人（偵測不到人時不會送新的一幀） */
export const POSE_STALE_MS = 1200;
const VISIBLE = 0.5;

// MediaPipe Pose 關鍵點編號
const NOSE = 0;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_WRIST = 15;
const RIGHT_WRIST = 16;

export function selfViewStatus(landmarks: PoseLandmark[] | undefined, stale: boolean): SelfViewStatus {
  if (!landmarks || landmarks.length === 0 || stale) {
    return { level: 'lost', text: '沒偵測到人，請站到鏡頭前' };
  }
  const seen = (i: number) => (landmarks[i]?.visibility ?? 0) >= VISIBLE;
  if (!seen(NOSE)) return { level: 'partial', text: '看不到臉，請讓頭部入鏡' };
  if (!seen(LEFT_SHOULDER) || !seen(RIGHT_SHOULDER)) return { level: 'partial', text: '請往後退，讓肩膀入鏡' };
  const left = seen(LEFT_WRIST);
  const right = seen(RIGHT_WRIST);
  if (!left && !right) return { level: 'partial', text: '看不到雙手，手勢不會同步' };
  if (!left) return { level: 'partial', text: '看不到左手' };
  if (!right) return { level: 'partial', text: '看不到右手' };
  return { level: 'ok', text: '追蹤良好' };
}

/**
 * object-fit: cover 的影像實際顯示範圍（相對於容器）；骨架要畫在這個範圍才會對齊影像。
 * 影像尺寸未知時回傳整個容器。
 */
export function coverRect(boxW: number, boxH: number, videoW: number, videoH: number) {
  if (!boxW || !boxH || !videoW || !videoH) return { left: 0, top: 0, width: boxW, height: boxH };
  const scale = Math.max(boxW / videoW, boxH / videoH);
  const width = videoW * scale;
  const height = videoH * scale;
  return { left: (boxW - width) / 2, top: (boxH - height) / 2, width, height };
}
