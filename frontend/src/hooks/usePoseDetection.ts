import { useEffect, useRef } from 'react';
import type { RefObject, MutableRefObject } from 'react';
import type { Room } from 'livekit-client';

// MediaPipe Pose types (loaded at runtime via CDN)
interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

interface PoseResults {
  poseLandmarks?: PoseLandmark[];
  poseWorldLandmarks?: PoseLandmark[];
}

interface PoseInstance {
  setOptions(options: Record<string, unknown>): void;
  onResults(callback: (results: PoseResults) => void): void;
  initialize(): Promise<void>;
  send(input: { image: HTMLVideoElement }): Promise<void>;
  close(): void;
}

interface PoseConstructor {
  new (config: { locateFile: (file: string) => string }): PoseInstance;
}

declare global {
  interface Window {
    Pose?: PoseConstructor;
  }
}

export interface PoseFrame {
  type: 'pose';
  landmarks: Array<{ x: number; y: number; z: number; visibility: number }>;
  worldLandmarks: Array<{ x: number; y: number; z: number; visibility: number }>;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

export function usePoseDetection(
  videoRef: RefObject<HTMLVideoElement | null>,
  roomRef: MutableRefObject<Room | null>,
) {
  const poseRef = useRef<PoseInstance | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      // Load MediaPipe Pose from CDN
      await loadScript(
        'https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js',
      );

      const PoseClass = window.Pose;
      if (!PoseClass) {
        console.warn('MediaPipe Pose not available');
        return;
      }

      const pose = new PoseClass({
        locateFile: (file: string) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
      });

      pose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      pose.onResults((results: PoseResults) => {
        if (cancelled) return;
        const room = roomRef.current;
        if (!room || !results.poseLandmarks) return;

        const frame: PoseFrame = {
          type: 'pose',
          landmarks: results.poseLandmarks.map((l) => ({
            x: l.x,
            y: l.y,
            z: l.z,
            visibility: l.visibility ?? 0,
          })),
          worldLandmarks: (results.poseWorldLandmarks ?? []).map((l) => ({
            x: l.x,
            y: l.y,
            z: l.z,
            visibility: l.visibility ?? 0,
          })),
        };

        const data = new TextEncoder().encode(JSON.stringify(frame));
        room.localParticipant.publishData(data, {
          reliable: false,
        });
      });

      await pose.initialize();
      if (cancelled) return;
      poseRef.current = pose;

      const loop = async () => {
        if (cancelled) return;
        const video = videoRef.current;
        if (video && video.readyState >= 2 && poseRef.current) {
          try {
            await poseRef.current.send({ image: video });
          } catch {
            // ignore frame send errors
          }
        }
        if (!cancelled) {
          rafRef.current = requestAnimationFrame(loop);
        }
      };

      rafRef.current = requestAnimationFrame(loop);
    };

    init();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      poseRef.current?.close();
    };
  }, [videoRef, roomRef]);
}
