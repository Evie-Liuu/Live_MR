import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { PoseLandmark, PoseFrame } from '../types/vrm';

// Re-export PoseFrame as a convenience
export type { PoseFrame };

const WASM_PATH = '/mediapipe-wasm';
const MODEL_PATH = '/mediapipe-models/pose_landmarker_heavy.task';
const encoder = new TextEncoder();

export function usePoseDetection(
  videoRef: RefObject<HTMLVideoElement | null>,
  /**
   * Called with encoded PoseFrame bytes each detected frame.
   * Pass `null` to skip publishing (pose-only mode without network).
   */
  onPublish: ((data: Uint8Array) => void) | null,
  onLandmarksUpdate?: (landmarks: PoseLandmark[]) => void,
) {
  const poseRef = useRef<PoseLandmarker | null>(null);
  const rafRef = useRef<number>(0);
  // Keep stable refs so the rAF loop closure never goes stale
  const onPublishRef = useRef(onPublish);
  onPublishRef.current = onPublish;
  const onLandmarksUpdateRef = useRef(onLandmarksUpdate);
  onLandmarksUpdateRef.current = onLandmarksUpdate;

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
        const commonOptions = {
          runningMode: 'VIDEO' as const,
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        };

        let poseLandmarker: PoseLandmarker | null = null;
        try {
          poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
            ...commonOptions,
          });
        } catch {
          console.warn('[PoseDetection] GPU delegate failed, falling back to CPU');
          poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
            ...commonOptions,
          });
        }

        if (cancelled) { poseLandmarker.close(); return; }
        poseRef.current = poseLandmarker;

        const loop = () => {
          if (cancelled) return;
          const video = videoRef.current;
          const pose = poseRef.current;

          if (video && video.readyState >= 2 && pose) {
            try {
              const result = pose.detectForVideo(video, performance.now());

              if (result.landmarks && result.landmarks.length > 0) {
                const frame: PoseFrame = {
                  type: 'pose',
                  landmarks: result.landmarks[0].map((l) => ({
                    x: l.x, y: l.y, z: l.z,
                    visibility: l.visibility ?? 0,
                  })),
                  worldLandmarks:
                    result.worldLandmarks && result.worldLandmarks.length > 0
                      ? result.worldLandmarks[0].map((l) => ({
                          x: l.x, y: l.y, z: l.z,
                          visibility: l.visibility ?? 0,
                        }))
                      : [],
                };

                // Always emit landmarks for overlay (fix: was inside room-connected guard)
                onLandmarksUpdateRef.current?.(frame.landmarks);
                // Only publish if callback provided
                onPublishRef.current?.(encoder.encode(JSON.stringify(frame)));
              }
            } catch {
              // ignore per-frame errors
            }
          }

          if (!cancelled) rafRef.current = requestAnimationFrame(loop);
        };

        rafRef.current = requestAnimationFrame(loop);
      } catch (err) {
        console.error('[PoseDetection] Failed to initialize PoseLandmarker:', err);
      }
    };

    init();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      poseRef.current?.close();
    };
  }, [videoRef]); // onPublish and onLandmarksUpdate intentionally excluded — updated via refs
}
