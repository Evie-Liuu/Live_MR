import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { PoseLandmarker, FaceLandmarker, HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { PoseLandmark, PoseFrame, FaceBlendshapes } from '../types/vrm';

// Re-export PoseFrame as a convenience
export type { PoseFrame };

const WASM_PATH = '/mediapipe-wasm';
/**
 * 身體模型：預設 full（9 MB，iPad 上載入與推論都比 heavy 快）；
 * 網址加 `?poseModel=heavy` 可切回 heavy（30 MB）比較精準度。
 */
const POSE_MODEL = typeof location !== 'undefined' && new URLSearchParams(location.search).get('poseModel') === 'heavy'
  ? 'heavy' : 'full';
const POSE_MODEL_PATH = `/mediapipe-models/pose_landmarker_${POSE_MODEL}.task`;
const FACE_MODEL_PATH = '/mediapipe-models/face_landmarker.task';
const HAND_MODEL_PATH = '/mediapipe-models/hand_landmarker.task';
import { encodePoseFrame } from '../utils/poseCodec';
import { LandmarkSmoother } from '../utils/oneEuroFilter';
import { handSides } from '../utils/handSides';

/** Minimum interval between detections (~30 fps) */
const DETECT_INTERVAL_MS = 33;

/**
 * One-Euro tuning for the raw MediaPipe pose landmarks. Lower `minCutoff` =
 * heavier smoothing when you hold still (kills jitter); `beta` lifts the cutoff
 * as you move so fast gestures don't lag. If it feels sluggish, raise both;
 * if it still shimmers when still, lower `minCutoff`.
 */
const POSE_SMOOTH = { minCutoff: 0.3, beta: 20, dCutoff: 1.0 } as const;

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
  /** Drop face/hand to 7.5 FPS (tick÷4) instead of 15 FPS (tick÷2) */
  lowPowerMode?: boolean,
  /**
   * false = 暫停偵測與發布（例如學生未被指定角色）。模型在第一次啟用時才下載，
   * 之後暫停也保留，再次啟用可立即恢復。預設 true。
   */
  active = true,
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
  const lowPowerModeRef = useRef(lowPowerMode ?? false);
  lowPowerModeRef.current = lowPowerMode ?? false;
  const activeRef = useRef(active);
  activeRef.current = active;
  // 第一次啟用後才初始化模型（未上台的裝置不必下載約 40 MB 的模型）
  const [armed, setArmed] = useState(active);
  if (active && !armed) setArmed(true);

  useEffect(() => {
    if (!armed) return;
    let cancelled = false;

    const init = async () => {
      // 計時：模型就緒、第一次偵測到人（console 篩選 [PoseDetection] 可看）
      const t0 = performance.now();
      let firstLandmarksLogged = false;
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
        console.info(`[PoseDetection] ${POSE_MODEL} model ready in ${Math.round(performance.now() - t0)} ms`);

        // ── Face / Hand：不擋姿態偵測，背景同時載入（約 11 MB），載好才開始用 ──
        // 原本三個模型依序載完才開始偵測，學生要等全部下載完才看得到骨架。
        const createFace = async (): Promise<FaceLandmarker | null> => {
          const opts = (delegate: 'GPU' | 'CPU') => ({
            baseOptions: { modelAssetPath: FACE_MODEL_PATH, delegate },
            ...commonOptions,
            numFaces: 1,
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: false,
          });
          try {
            return await FaceLandmarker.createFromOptions(vision, opts('GPU'));
          } catch {
            console.warn('[FaceDetection] GPU delegate failed, falling back to CPU');
            try {
              return await FaceLandmarker.createFromOptions(vision, opts('CPU'));
            } catch (err) {
              console.error('[FaceDetection] Failed to initialize FaceLandmarker:', err);
              return null;
            }
          }
        };
        const createHand = async (): Promise<HandLandmarker | null> => {
          const opts = (delegate: 'GPU' | 'CPU') => ({
            baseOptions: { modelAssetPath: HAND_MODEL_PATH, delegate },
            runningMode: 'VIDEO' as const,
            numHands: 2,
            minHandDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
          try {
            return await HandLandmarker.createFromOptions(vision, opts('GPU'));
          } catch {
            console.warn('[HandDetection] GPU delegate failed, falling back to CPU');
            try {
              return await HandLandmarker.createFromOptions(vision, opts('CPU'));
            } catch (err) {
              console.error('[HandDetection] Failed to initialize HandLandmarker:', err);
              return null;
            }
          }
        };
        void createFace().then(f => { if (cancelled) f?.close(); else faceRef.current = f; });
        void createHand().then(h => { if (cancelled) h?.close(); else handRef.current = h; });

        // ── Pre-allocated landmark buffers (avoid per-frame object creation) ──
        const landmarksBuf: PoseLandmark[] =
          Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
        const worldLandmarksBuf: PoseLandmark[] =
          Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));

        // One-Euro smoothing on the raw landmarks — removes per-frame jitter at
        // the source (before Kalidokit), which downstream bone-rotation smoothing
        // can't fully reach. Separate instances for screen-space vs world-space.
        const poseLmSmoother = new LandmarkSmoother(33, POSE_SMOOTH.minCutoff, POSE_SMOOTH.beta, POSE_SMOOTH.dCutoff);
        const poseWorldSmoother = new LandmarkSmoother(33, POSE_SMOOTH.minCutoff, POSE_SMOOTH.beta, POSE_SMOOTH.dCutoff);
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

          // ── Throttle: skip detection if under interval；暫停時完全不偵測 ──
          if (activeRef.current && now - lastDetectTime >= DETECT_INTERVAL_MS) {
            lastDetectTime = now;
            const tick = detectionFrame++;

            const video = videoRef.current;
            const pose = poseRef.current;

            if (video && video.readyState >= 2 && pose) {
              try {
                const result = pose.detectForVideo(video, now);

                if (result.landmarks && result.landmarks.length > 0) {
                  if (!firstLandmarksLogged) {
                    firstLandmarksLogged = true;
                    console.info(`[PoseDetection] first landmarks after ${Math.round(performance.now() - t0)} ms`);
                  }
                  let worldLandmarks: PoseLandmark[];
                  if (result.worldLandmarks && result.worldLandmarks.length > 0) {
                    const wl = result.worldLandmarks[0];
                    for (let i = 0; i < wl.length; i++) {
                      worldLandmarksBuf[i].x = wl[i].x;
                      worldLandmarksBuf[i].y = wl[i].y;
                      worldLandmarksBuf[i].z = wl[i].z;
                      worldLandmarksBuf[i].visibility = wl[i].visibility ?? 0;
                    }
                    poseWorldSmoother.apply(worldLandmarksBuf, now);
                    worldLandmarks = worldLandmarksBuf;
                  } else {
                    worldLandmarks = [];
                  }

                  // Copy raw → buffer, smooth in place, then branch:
                  //  - overlay subscriber (StudentSession): clone into a fresh
                  //    array so React's reference-equality re-render check fires.
                  //  - no subscriber (HostSession): reuse the buffer directly.
                  const pl = result.landmarks[0];
                  for (let i = 0; i < pl.length; i++) {
                    landmarksBuf[i].x = pl[i].x;
                    landmarksBuf[i].y = pl[i].y;
                    landmarksBuf[i].z = pl[i].z;
                    landmarksBuf[i].visibility = pl[i].visibility ?? 0;
                  }
                  poseLmSmoother.apply(landmarksBuf, now);

                  const landmarks: PoseLandmark[] = onLandmarksUpdateRef.current
                    ? landmarksBuf.map((l) => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility }))
                    : landmarksBuf;

                  const frame: PoseFrame = {
                    type: 'pose',
                    landmarks,
                    worldLandmarks,
                  };

                  // ── Face blendshapes (when enabled) ──
                  const faceInterval = lowPowerModeRef.current ? 4 : 2;
                  if (faceEnabledRef.current && faceRef.current && tick % faceInterval === 0) {
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
                  if (handEnabledRef.current && handRef.current && tick % faceInterval === faceInterval / 2) {
                    try {
                      const handResult = handRef.current.detectForVideo(video, now);
                      if (handResult.landmarks && handResult.landmarks.length > 0) {
                        const sides = handSides(
                          handResult.landmarks,
                          handResult.handedness?.map(h => h?.[0]?.categoryName ?? '') ?? [],
                          landmarks,
                        );
                        for (let hi = 0; hi < handResult.landmarks.length; hi++) {
                          const side = sides[hi];
                          if (!side) continue;
                          // 以本人的左右存（person's perspective），solveHand() 與道具抓取都依此
                          const handBuf = side === 'right' ? rightHandBuf : leftHandBuf;
                          const hl = handResult.landmarks[hi];
                          for (let i = 0; i < hl.length; i++) {
                            handBuf[i].x = hl[i].x;
                            handBuf[i].y = hl[i].y;
                            handBuf[i].z = hl[i].z;
                            handBuf[i].visibility = 1;
                          }
                          if (side === 'right') frame.rightHandLandmarks = handBuf;
                          else frame.leftHandLandmarks = handBuf;
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
      poseRef.current = null;
      faceRef.current = null;
      handRef.current = null;
    };
  }, [videoRef, armed]); // onPublish, onLandmarksUpdate, faceEnabled, handEnabled, active intentionally excluded — updated via refs
}
