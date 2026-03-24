import { useEffect, useRef } from 'react';
import type { RefObject, MutableRefObject } from 'react';
import type { Room } from 'livekit-client';
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export interface PoseFrame {
  type: 'pose';
  landmarks: Array<{ x: number; y: number; z: number; visibility: number }>;
  worldLandmarks: Array<{ x: number; y: number; z: number; visibility: number }>;
}

const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';
const MODEL_BASE = 'https://storage.googleapis.com/mediapipe-models';

export function usePoseDetection(
  videoRef: RefObject<HTMLVideoElement | null>,
  roomRef: MutableRefObject<Room | null>,
) {
  const poseRef = useRef<PoseLandmarker | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_CDN);
        const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `${MODEL_BASE}/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task`,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        if (cancelled) {
          poseLandmarker.close();
          return;
        }

        poseRef.current = poseLandmarker;

        const loop = () => {
          if (cancelled) return;

          const video = videoRef.current;
          const pose = poseRef.current;

          if (video && video.readyState >= 2 && pose) {
            try {
              const now = performance.now();
              const result = pose.detectForVideo(video, now);
              const room = roomRef.current;

              if (room && room.state === 'connected' && result.landmarks && result.landmarks.length > 0) {
                const frame: PoseFrame = {
                  type: 'pose',
                  landmarks: result.landmarks[0].map((l) => ({
                    x: l.x,
                    y: l.y,
                    z: l.z,
                    visibility: l.visibility ?? 0,
                  })),
                  worldLandmarks: result.worldLandmarks && result.worldLandmarks.length > 0
                    ? result.worldLandmarks[0].map((l) => ({
                      x: l.x,
                      y: l.y,
                      z: l.z,
                      visibility: l.visibility ?? 0,
                    }))
                    : [],
                };

                const data = new TextEncoder().encode(JSON.stringify(frame));
                room.localParticipant.publishData(data, {
                  reliable: false,
                });
              }
            } catch (err) {
              // ignore frame send errors
            }
          }

          if (!cancelled) {
            rafRef.current = requestAnimationFrame(loop);
          }
        };

        rafRef.current = requestAnimationFrame(loop);
      } catch (err) {
        console.error('Failed to initialize MediaPipe PoseLandmarker:', err);
      }
    };

    init();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      if (poseRef.current) {
        poseRef.current.close();
      }
    };
  }, [videoRef, roomRef]);
}
