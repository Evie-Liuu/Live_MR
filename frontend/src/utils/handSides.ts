/**
 * 偵測到的手是本人的哪一隻（person's perspective）。
 *
 * MediaPipe 的 handedness 標籤假設輸入畫面已鏡像翻轉，未翻轉的鏡頭畫面左右容易對反，
 * 所以優先用幾何判斷：手腕（手部第 0 點）離身體骨架的哪個手腕近（姿態 15＝左、16＝右）。
 * 兩隻手搶同一邊時，比較誰「更偏左」來分配。沒有姿態骨架時才退回標籤
 * （標籤 'Left' 視為本人右手）。
 */

export type HandSide = 'left' | 'right';

interface Point { x: number; y: number }

const POSE_LEFT_WRIST = 15;
const POSE_RIGHT_WRIST = 16;

function dist2(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function handSides(
  hands: readonly (readonly Point[])[],
  labels: readonly string[],
  pose: readonly Point[] | undefined,
): (HandSide | null)[] {
  const fromLabel = (i: number): HandSide | null =>
    labels[i] === 'Left' ? 'right' : labels[i] === 'Right' ? 'left' : null;

  if (!pose || pose.length <= POSE_RIGHT_WRIST) return hands.map((_, i) => fromLabel(i));

  // 偏左程度：越小越像左手
  const leftness = hands.map(h =>
    h.length > 0 ? dist2(h[0], pose[POSE_LEFT_WRIST]) - dist2(h[0], pose[POSE_RIGHT_WRIST]) : NaN,
  );
  const sides = leftness.map((v, i): HandSide | null => (Number.isNaN(v) ? fromLabel(i) : v < 0 ? 'left' : 'right'));

  if (hands.length === 2 && sides[0] && sides[0] === sides[1] && !Number.isNaN(leftness[0]) && !Number.isNaN(leftness[1])) {
    const firstIsLeft = leftness[0] <= leftness[1];
    sides[0] = firstIsLeft ? 'left' : 'right';
    sides[1] = firstIsLeft ? 'right' : 'left';
  }
  return sides;
}
