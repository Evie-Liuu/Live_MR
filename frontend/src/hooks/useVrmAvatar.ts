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

/** Apply per-SceneConfig lights to a THREE.Scene */
function applyLights(scene: THREE.Scene, config: SceneConfig): void {
  for (const light of config.lights) {
    if (light.type === 'ambient') {
      const l = new THREE.AmbientLight(light.color ?? 0xffffff, light.intensity);
      scene.add(l);
    } else if (light.type === 'directional') {
      const l = new THREE.DirectionalLight(light.color ?? 0xffffff, light.intensity);
      if (light.position) l.position.set(...light.position);
      scene.add(l);
    }
  }
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
  const clockRef = useRef(new THREE.Clock());
  const rafRef = useRef<number>(0);
  const poseStateRef = useRef<PoseApplyState>(createPoseApplyState());

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
    const camera = new THREE.PerspectiveCamera(fov, canvas.width / canvas.height, near, far);
    camera.position.set(...position);
    camera.lookAt(...lookAt);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas,
      // alpha: preset.backgroundType === 'none', // transparent when no background set
      antialias: true,
    });
    renderer.setSize(canvas.width, canvas.height);
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
    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);
      const delta = clockRef.current.getDelta();
      if (vrmRef.current) {
        vrmRef.current.update(delta);
      }
      renderer.render(scene, camera);
    };
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafRef.current);
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
    const vrm = vrmRef.current;
    if (!vrm) return;

    const frame = rawData as PoseFrame;
    if (!frame?.landmarks || frame.landmarks.length < 33) return;

    const delta = clockRef.current.getDelta();
    applyPoseToVrm(vrm, poseStateRef.current, frame.landmarks, frame.worldLandmarks ?? [], delta);
  }, []);

  return { applyPose };
}
