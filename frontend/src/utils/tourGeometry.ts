/**
 * 教學提示的位置計算：框線只畫在目標看得到的部分，目標被捲出可見範圍時改提示捲動方向。
 */
import type { TourPlacement } from './roleTour.ts';

export interface Box { top: number; left: number; width: number; height: number }
interface Edges { top: number; left: number; right: number; bottom: number }

const GAP = 14;
const MARGIN = 12;
/** 看得到的部分小於這個高度或寬度，就當作看不到（只露出一條邊沒有意義） */
const MIN_VISIBLE = 12;

export type TargetView =
  | { kind: 'visible'; box: Box }
  /** 被捲出去了；anchor 是捲動容器靠近目標那一側的邊，提示框貼著它 */
  | { kind: 'hidden'; direction: 'above' | 'below'; anchor: Box }
  | { kind: 'none' };

/**
 * 目標在畫面上實際看得到的範圍：目標框與所有裁切它的祖先（捲動容器）、視窗取交集。
 * clips 由近到遠或任意順序皆可。
 */
export function visibleTarget(rect: Box | null, clips: Edges[]): TargetView {
  if (!rect || rect.width <= 0 || rect.height <= 0) return { kind: 'none' };
  const bound = clips.reduce<Edges>((acc, c) => ({
    top: Math.max(acc.top, c.top), left: Math.max(acc.left, c.left),
    right: Math.min(acc.right, c.right), bottom: Math.min(acc.bottom, c.bottom),
  }), { top: -Infinity, left: -Infinity, right: Infinity, bottom: Infinity });

  const top = Math.max(rect.top, bound.top);
  const bottom = Math.min(rect.top + rect.height, bound.bottom);
  const left = Math.max(rect.left, bound.left);
  const right = Math.min(rect.left + rect.width, bound.right);
  if (bottom - top >= MIN_VISIBLE && right - left >= MIN_VISIBLE) {
    return { kind: 'visible', box: { top, left, width: right - left, height: bottom - top } };
  }

  const direction = rect.top + rect.height / 2 < (bound.top + bound.bottom) / 2 ? 'above' : 'below';
  const edgeY = direction === 'above' ? bound.top : bound.bottom;
  const aLeft = Math.min(Math.max(rect.left, bound.left), bound.right);
  const aRight = Math.max(Math.min(rect.left + rect.width, bound.right), aLeft);
  return { kind: 'hidden', direction, anchor: { top: edgeY, left: aLeft, width: aRight - aLeft, height: 0 } };
}

/** 提示框放在目標旁邊；放不下就換邊，最後夾在視窗內 */
export function placeBubble(
  target: Box | null,
  bubble: { width: number; height: number },
  prefer: TourPlacement,
  viewport: { width: number; height: number },
  anchorTop: number,
): { top: number; left: number } {
  const { width: vw, height: vh } = viewport;
  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));
  if (!target) return { top: anchorTop + GAP, left: clamp(vw / 2 - bubble.width / 2, MARGIN, vw - bubble.width - MARGIN) };

  const fits = {
    right: target.left + target.width + GAP + bubble.width <= vw - MARGIN,
    left: target.left - GAP - bubble.width >= MARGIN,
    below: target.top + target.height + GAP + bubble.height <= vh - MARGIN,
  };
  const order: TourPlacement[] = [prefer, ...(['right', 'left', 'below'] as const).filter(p => p !== prefer)];
  const side = order.find(p => fits[p]) ?? 'below';
  const midY = target.top + target.height / 2 - bubble.height / 2;
  if (side === 'right') return { top: clamp(midY, MARGIN, vh - bubble.height - MARGIN), left: target.left + target.width + GAP };
  if (side === 'left') return { top: clamp(midY, MARGIN, vh - bubble.height - MARGIN), left: target.left - GAP - bubble.width };
  return {
    top: clamp(target.top + target.height + GAP, MARGIN, vh - bubble.height - MARGIN),
    left: clamp(target.left + target.width / 2 - bubble.width / 2, MARGIN, vw - bubble.width - MARGIN),
  };
}
