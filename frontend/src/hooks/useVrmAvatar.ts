/**
 * useVrmAvatar.ts
 *
 * Single-avatar VRM hook used in teacher / student self-view tiles.
 *
 * Refactored to share:
 *  - loadVrm()         → vrmLoader.ts
 *  - applyPoseToVrm()  → vrmPoseApplier.ts
 *
 * Scene config (camera, lighting) is read from the 'studio' preset by default
 * so the component appearance stays consistent with the scene system.
 */
import { useEffect, useRef, useCallback } from 'react';
import type { RefObject } from 'react';
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { loadVrm } from '../utils/vrmLoader';
import {
  applyPoseToVrm,
  createPoseApplyState,
  type PoseApplyState,
} from '../utils/vrmPoseApplier';
import { applyLights } from '../utils/threeScene';
import type { PoseFrame } from '../types/vrm';
import { SCENE_PRESETS, DEFAULT_SCENE_ID } from '../config/scenes';
import { VRM_SOURCES, DEFAULT_VRM_SOURCE_ID } from '../config/vrmSources';
import type { SceneConfig } from '../types/vrm';

interface UseVrmAvatarOptions {
  /** ID of the scene preset to use (default: 'studio') */
  sceneId?: string;
  /** ID of the VRM source to load (default: 'default') */
  vrmSourceId?: string;
}

export function useVrmAvatar(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  options: UseVrmAvatarOptions = {},
) {
  const { sceneId = 'studio', vrmSourceId = DEFAULT_VRM_SOURCE_ID } = options;

  const vrmRef = useRef<VRM | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const timerRef = useRef(new THREE.Timer());
  const rafRef = useRef<number>(0);
  const poseStateRef = useRef<PoseApplyState>(createPoseApplyState());
  /** Latest unprocessed pose frame – set by applyPose, consumed in RAF */
  const pendingPoseRef = useRef<PoseFrame | null>(null);
  /** Last applied frame – used for continuous 60 fps lerp between 30 fps data */
  const lastFrameRef = useRef<PoseFrame | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Resolve scene preset (fall back to DEFAULT_SCENE_ID then hard defaults)
    const preset: SceneConfig =
      SCENE_PRESETS[sceneId] ?? SCENE_PRESETS[DEFAULT_SCENE_ID] ?? SCENE_PRESETS.studio;

    // Scene
    const scene = new THREE.Scene();
    // if (preset.backgroundType === 'color') {
    //   scene.background = new THREE.Color(preset.backgroundValue);
    // }
    sceneRef.current = scene;

    // Camera
    const { fov, position, lookAt, near = 0.1, far = 20 } = preset.camera;
    const camera = new THREE.PerspectiveCamera(
      fov,
      (canvas.clientWidth || canvas.width) / (canvas.clientHeight || canvas.height),
      near,
      far,
    );
    camera.position.set(...position);
    camera.lookAt(...lookAt);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas,
      // alpha: preset.backgroundType === 'none', // transparent when no background set
      antialias: true,
    });
    renderer.setSize(
      canvas.clientWidth || canvas.width,
      canvas.clientHeight || canvas.height,
      false,
    );
    renderer.setPixelRatio(window.devicePixelRatio);
    rendererRef.current = renderer;

    // Lights
    applyLights(scene, preset);

    // VRM source
    const vrmSource = VRM_SOURCES[vrmSourceId] ?? VRM_SOURCES[DEFAULT_VRM_SOURCE_ID];
    const spawn = preset.avatarDefaults;

    loadVrm({ url: vrmSource.url, scene, spawn })
      .then(({ vrm }) => {
        vrmRef.current = vrm;
      })
      .catch((err) => {
        console.warn('[useVrmAvatar] Failed to load VRM:', err);
      });

    // Render loop
    const animate = (timestamp: number) => {
      rafRef.current = requestAnimationFrame(animate);
      timerRef.current.update(timestamp);
      const delta = timerRef.current.getDelta();
      if (vrmRef.current) {
        if (pendingPoseRef.current) {
          applyPoseToVrm(vrmRef.current, poseStateRef.current, pendingPoseRef.current, delta);
          lastFrameRef.current = pendingPoseRef.current;
          pendingPoseRef.current = null;
        } else if (lastFrameRef.current) {
          applyPoseToVrm(vrmRef.current, poseStateRef.current, lastFrameRef.current, delta, {
            reuseLastSolve: true,
          });
        }
        vrmRef.current.update(delta);
      }
      renderer.render(scene, camera);
    };
    rafRef.current = requestAnimationFrame(animate);

    // Responsive resize
    const ro = new ResizeObserver(() => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w > 0 && h > 0) {
        renderer.setSize(w, h, false);
        if (cameraRef.current) {
          cameraRef.current.aspect = w / h;
          cameraRef.current.updateProjectionMatrix();
        }
      }
    });
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      renderer.dispose();
      if (vrmRef.current) {
        scene.remove(vrmRef.current.scene);
        vrmRef.current = null;
      }
    };
    // Re-init when scene or model changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef, sceneId, vrmSourceId]);

  const applyPose = useCallback((rawData: unknown) => {
    const frame = rawData as PoseFrame;
    if (!frame?.landmarks || frame.landmarks.length < 33) return;
    // Queue for the RAF loop; latest frame wins
    pendingPoseRef.current = frame;
  }, []);

  return { applyPose };
}
