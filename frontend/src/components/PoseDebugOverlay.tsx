import { useEffect, useRef } from 'react';
import { POSE_CONNECTIONS } from '../constants/pose';

interface NormalizedLandmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

interface PoseDebugOverlayProps {
  landmarks: NormalizedLandmark[][];
  width: number;
  height: number;
}

const COLORS = ['#00ff00', '#ff6600', '#00bfff', '#ff00ff', '#ffff00'];

export default function PoseDebugOverlay({
  landmarks,
  width,
  height,
}: PoseDebugOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    landmarks.forEach((personLms, personIdx) => {
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
    });
  }, [landmarks, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        objectFit: 'cover' // Align with video if needed
      }}
      className="absolute top-0 left-0 pointer-events-none"
    />
  );
}
