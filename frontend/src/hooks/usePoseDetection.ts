import { useEffect, useRef } from 'react';
import type { RefObject, MutableRefObject } from 'react';
import type { Room } from 'livekit-client';
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export interface PoseFrame {
  type: 'pose';
  landmarks: Array<{ x: number; y: number; z: number; visibility: number }>;
  worldLandmarks: Array<{ x: number; y: number; z: number; visibility: number }>;
}

const WASM_PATH = '/mediapipe-wasm';
const MODEL_PATH = '/mediapipe-models/pose_landmarker_heavy.task';
const encoder = new TextEncoder();

export function usePoseDetection(
  videoRef: RefObject<HTMLVideoElement | null>,
  roomRef: MutableRefObject<Room | null>,
  onLandmarksUpdate?: (landmarks: Array<{ x: number; y: number; z: number; visibility: number }>) => void
) {
  const poseRef = useRef<PoseLandmarker | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_PATH);

        let poseLandmarker: PoseLandmarker | null = null;
        const commonOptions = {
          runningMode: 'VIDEO' as const,
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        };

        // Try GPU first, fall back to CPU if unsupported
        try {
          poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: MODEL_PATH,
              delegate: 'GPU',
            },
            ...commonOptions,
          });
        } catch {
          console.warn('[PoseDetection] GPU delegate failed, falling back to CPU');
          poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: MODEL_PATH,
              delegate: 'CPU',
            },
            ...commonOptions,
          });
        }

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

                // Emit local landmarks for overlay if callback is provided
                if (onLandmarksUpdate) {
                  onLandmarksUpdate(frame.landmarks);
                }

                const data = encoder.encode(JSON.stringify(frame));
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
