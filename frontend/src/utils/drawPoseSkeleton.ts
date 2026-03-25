/**
 * drawPoseSkeleton.ts
 *
 * Shared imperative canvas drawing for pose debug overlays.
 * Used by StudentTile / LocalVideo for zero-re-render pose overlay updates.
 */
import { POSE_CONNECTIONS } from '../constants/pose';

export interface SkeletonLandmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

const COLORS = ['#00ff00', '#ff6600', '#00bfff', '#ff00ff', '#ffff00'];

/**
 * Draw pose skeleton(s) onto a canvas element.
 * Resizes canvas buffer if dimensions mismatch.
 */
export function drawPoseSkeleton(
  canvas: HTMLCanvasElement,
  landmarkSets: SkeletonLandmark[][],
  width: number,
  height: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  ctx.clearRect(0, 0, width, height);

  for (let personIdx = 0; personIdx < landmarkSets.length; personIdx++) {
    const personLms = landmarkSets[personIdx];
    const color = COLORS[personIdx % COLORS.length];

    // Draw connections
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    for (const [a, b] of POSE_CONNECTIONS) {
      const la = personLms[a];
      const lb = personLms[b];
      if (!la || !lb) continue;
      if ((la.visibility ?? 0) < 0.5 || (lb.visibility ?? 0) < 0.5) continue;
      ctx.beginPath();
      ctx.moveTo(la.x * width, la.y * height);
      ctx.lineTo(lb.x * width, lb.y * height);
      ctx.stroke();
    }

    // Draw joints
    ctx.fillStyle = color;
    for (const l of personLms) {
      if ((l.visibility ?? 0) < 0.5) continue;
      ctx.beginPath();
      ctx.arc(l.x * width, l.y * height, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
