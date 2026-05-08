import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { PoseLandmarker, FaceLandmarker, HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { PoseLandmark, PoseFrame, FaceBlendshapes } from '../types/vrm';

// Re-export PoseFrame as a convenience
export type { PoseFrame };

const WASM_PATH = '/mediapipe-wasm';
const POSE_MODEL_PATH = '/mediapipe-models/pose_landmarker_heavy.task';
const FACE_MODEL_PATH = '/mediapipe-models/face_landmarker.task';
const HAND_MODEL_PATH = '/mediapipe-models/hand_landmarker.task';
import { encodePoseFrame } from '../utils/poseCodec';

/** Minimum interval between detections (~30 fps) */
const DETECT_INTERVAL_MS = 33;

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
  /** Enable HandLandmarker for hand gesture detection */
  handEnabled?: boolean,
) {
  const poseRef = useRef<PoseLandmarker | null>(null);
  const faceRef = useRef<FaceLandmarker | null>(null);
  const handRef = useRef<HandLandmarker | null>(null);
  const rafRef = useRef<number>(0);
  // Keep stable refs so the rAF loop closure never goes stale
  const onPublishRef = useRef(onPublish);
  onPublishRef.current = onPublish;
  const onLandmarksUpdateRef = useRef(onLandmarksUpdate);
  onLandmarksUpdateRef.current = onLandmarksUpdate;
  const faceEnabledRef = useRef(faceEnabled ?? false);
  faceEnabledRef.current = faceEnabled ?? false;
  const handEnabledRef = useRef(handEnabled ?? false);
  handEnabledRef.current = handEnabled ?? false;

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

        // ── Init HandLandmarker ──
        let handLandmarker: HandLandmarker | null = null;
        try {
          handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: HAND_MODEL_PATH, delegate: 'GPU' },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
        } catch {
          console.warn('[HandDetection] GPU delegate failed, falling back to CPU');
          try {
            handLandmarker = await HandLandmarker.createFromOptions(vision, {
              baseOptions: { modelAssetPath: HAND_MODEL_PATH, delegate: 'CPU' },
              runningMode: 'VIDEO',
              numHands: 2,
              minHandDetectionConfidence: 0.5,
              minTrackingConfidence: 0.5,
            });
          } catch (err) {
            console.error('[HandDetection] Failed to initialize HandLandmarker:', err);
          }
        }

        if (cancelled) { handLandmarker?.close(); faceLandmarker?.close(); poseLandmarker.close(); return; }
        handRef.current = handLandmarker;

        // ── Pre-allocated landmark buffers (avoid per-frame object creation) ──
        const worldLandmarksBuf: PoseLandmark[] =
          Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
        const faceLandmarksBuf: PoseLandmark[] =
          Array.from({ length: 478 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
        const leftHandBuf: PoseLandmark[] =
          Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
        const rightHandBuf: PoseLandmark[] =
          Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
        const blendshapesBuf: FaceBlendshapes = {};

        let lastDetectTime = 0;
        let detectionFrame = 0;

        const loop = () => {
          if (cancelled) return;

          const now = performance.now();

          // ── Throttle: skip detection if under interval ──
          if (now - lastDetectTime >= DETECT_INTERVAL_MS) {
            lastDetectTime = now;
            const tick = detectionFrame++;

            const video = videoRef.current;
            const pose = poseRef.current;

            if (video && video.readyState >= 2 && pose) {
              try {
                const result = pose.detectForVideo(video, now);

                if (result.landmarks && result.landmarks.length > 0) {
                  let worldLandmarks: PoseLandmark[];
                  if (result.worldLandmarks && result.worldLandmarks.length > 0) {
                    const wl = result.worldLandmarks[0];
                    for (let i = 0; i < wl.length; i++) {
                      worldLandmarksBuf[i].x = wl[i].x;
                      worldLandmarksBuf[i].y = wl[i].y;
                      worldLandmarksBuf[i].z = wl[i].z;
                      worldLandmarksBuf[i].visibility = wl[i].visibility ?? 0;
                    }
                    worldLandmarks = worldLandmarksBuf;
                  } else {
                    worldLandmarks = [];
                  }

                  const frame: PoseFrame = {
                    type: 'pose',
                    landmarks: result.landmarks[0].map((l) => ({
                      x: l.x, y: l.y, z: l.z,
                      visibility: l.visibility ?? 0,
                    })),
                    worldLandmarks,
                  };

                  // ── Face blendshapes (when enabled) ──
                  if (faceEnabledRef.current && faceRef.current && tick % 2 === 0) {
                    try {
                      const faceResult = faceRef.current.detectForVideo(video, now);
                      if (
                        faceResult.faceLandmarks &&
                        faceResult.faceLandmarks.length > 0
                      ) {
                        const fl = faceResult.faceLandmarks[0];
                        for (let i = 0; i < fl.length; i++) {
                          faceLandmarksBuf[i].x = fl[i].x;
                          faceLandmarksBuf[i].y = fl[i].y;
                          faceLandmarksBuf[i].z = fl[i].z;
                          faceLandmarksBuf[i].visibility = fl[i].visibility ?? 1;
                        }
                        frame.faceLandmarks = faceLandmarksBuf;
                      }
                      if (
                        faceResult.faceBlendshapes &&
                        faceResult.faceBlendshapes.length > 0
                      ) {
                        for (const cat of faceResult.faceBlendshapes[0].categories) {
                          blendshapesBuf[cat.categoryName] = cat.score;
                        }
                        frame.faceBlendshapes = blendshapesBuf;
                      }
                    } catch {
                      // ignore per-frame face errors
                    }
                  }

                  // ── Hand landmarks (when enabled) ──
                  if (handEnabledRef.current && handRef.current && tick % 2 === 1) {
                    try {
                      const handResult = handRef.current.detectForVideo(video, now);
                      if (handResult.landmarks && handResult.landmarks.length > 0) {
                        for (let hi = 0; hi < handResult.landmarks.length; hi++) {
                          // handResult.handedness[hi][0].categoryName is 'Left' or 'Right'
                          // (MediaPipe returns the hand as seen from the camera, mirror of person)
                          const label = handResult.handedness?.[hi]?.[0]?.categoryName ?? ''
                          // MediaPipe 'Left' = camera left = person's Right hand, and vice versa
                          // We store as person's perspective to match solveHand() expectations
                          if (label === 'Left' || label === 'Right') {
                            const handBuf = label === 'Left' ? rightHandBuf : leftHandBuf;
                            const hl = handResult.landmarks[hi];
                            for (let i = 0; i < hl.length; i++) {
                              handBuf[i].x = hl[i].x;
                              handBuf[i].y = hl[i].y;
                              handBuf[i].z = hl[i].z;
                              handBuf[i].visibility = 1;
                            }
                            if (label === 'Left') {
                              frame.rightHandLandmarks = handBuf;  // camera Left = person Right
                            } else {
                              frame.leftHandLandmarks = handBuf;   // camera Right = person Left
                            }
                          }
                        }
                      }
                    } catch {
                      // ignore per-frame hand errors
                    }
                  }

                  // Always emit landmarks for overlay
                  onLandmarksUpdateRef.current?.(frame.landmarks);
                  // Only publish if callback provided
                  onPublishRef.current?.(encodePoseFrame(frame));
                }
              } catch {
                // ignore per-frame errors
              }
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
      handRef.current?.close();
    };
  }, [videoRef]); // onPublish, onLandmarksUpdate, faceEnabled, handEnabled intentionally excluded — updated via refs
}
