import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { PoseLandmarker, FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { PoseLandmark, PoseFrame, FaceBlendshapes } from '../types/vrm';

// Re-export PoseFrame as a convenience
export type { PoseFrame };

const WASM_PATH = '/mediapipe-wasm';
const POSE_MODEL_PATH = '/mediapipe-models/pose_landmarker_heavy.task';
const FACE_MODEL_PATH = '/mediapipe-models/face_landmarker.task';
const encoder = new TextEncoder();

export function usePoseDetection(
  videoRef: RefObject<HTMLVideoElement | null>,
  /**
   * Called with encoded PoseFrame bytes each detected frame.
   * Pass `null` to skip publishing (pose-only mode without network).
   */
  onPublish: ((data: Uint8Array) => void) | null,
  onLandmarksUpdate?: (landmarks: PoseLandmark[]) => void,
  /** Enable FaceLandmarker for face blendshapes detection */
  faceEnabled?: boolean,
) {
  const poseRef = useRef<PoseLandmarker | null>(null);
  const faceRef = useRef<FaceLandmarker | null>(null);
  const rafRef = useRef<number>(0);
  // Keep stable refs so the rAF loop closure never goes stale
  const onPublishRef = useRef(onPublish);
  onPublishRef.current = onPublish;
  const onLandmarksUpdateRef = useRef(onLandmarksUpdate);
  onLandmarksUpdateRef.current = onLandmarksUpdate;
  const faceEnabledRef = useRef(faceEnabled ?? false);
  faceEnabledRef.current = faceEnabled ?? false;

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
        const commonOptions = {
          runningMode: 'VIDEO' as const,
        };

        // ── Init PoseLandmarker ──
        let poseLandmarker: PoseLandmarker | null = null;
        try {
          poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: POSE_MODEL_PATH, delegate: 'GPU' },
            ...commonOptions,
            numPoses: 1,
            minPoseDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
        } catch {
          console.warn('[PoseDetection] GPU delegate failed, falling back to CPU');
          poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: POSE_MODEL_PATH, delegate: 'CPU' },
            ...commonOptions,
            numPoses: 1,
            minPoseDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
        }

        if (cancelled) { poseLandmarker.close(); return; }
        poseRef.current = poseLandmarker;

        // ── Init FaceLandmarker ──
        let faceLandmarker: FaceLandmarker | null = null;
        try {
          faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: FACE_MODEL_PATH, delegate: 'GPU' },
            ...commonOptions,
            numFaces: 1,
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: false,
          });
        } catch {
          console.warn('[FaceDetection] GPU delegate failed, falling back to CPU');
          try {
            faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
              baseOptions: { modelAssetPath: FACE_MODEL_PATH, delegate: 'CPU' },
              ...commonOptions,
              numFaces: 1,
              outputFaceBlendshapes: true,
              outputFacialTransformationMatrixes: false,
            });
          } catch (err) {
            console.error('[FaceDetection] Failed to initialize FaceLandmarker:', err);
          }
        }

        if (cancelled) { faceLandmarker?.close(); poseLandmarker.close(); return; }
        faceRef.current = faceLandmarker;

        const loop = () => {
          if (cancelled) return;
          const video = videoRef.current;
          const pose = poseRef.current;

          if (video && video.readyState >= 2 && pose) {
            try {
              const now = performance.now();
              const result = pose.detectForVideo(video, now);

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

                // ── Face blendshapes (when enabled) ──
                if (faceEnabledRef.current && faceRef.current) {
                  try {
                    const faceResult = faceRef.current.detectForVideo(video, now);
                    if (
                      faceResult.faceBlendshapes &&
                      faceResult.faceBlendshapes.length > 0
                    ) {
                      const bs: FaceBlendshapes = {};
                      for (const cat of faceResult.faceBlendshapes[0].categories) {
                        bs[cat.categoryName] = cat.score;
                      }
                      frame.faceBlendshapes = bs;
                    }
                  } catch {
                    // ignore per-frame face errors
                  }
                }

                // Always emit landmarks for overlay
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
        console.error('[PoseDetection] Failed to initialize:', err);
      }
    };

    init();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      poseRef.current?.close();
      faceRef.current?.close();
    };
  }, [videoRef]); // onPublish, onLandmarksUpdate, faceEnabled intentionally excluded — updated via refs
}
