/**
 * useBigScreenScene.ts
 *
 * Multi-avatar Three.js scene for the BigScreen projector view.
 *
 * Refactored to share:
 *  - loadVrm()         → vrmLoader.ts
 *  - applyPoseToVrm()  → vrmPoseApplier.ts
 *  - Scene presets     → config/scenes.ts
 *  - VRM sources       → config/vrmSources.ts
 *
 * Scene is re-initialised whenever sceneId changes, so the BigScreen can
 * switch preset on the fly (e.g. via a control panel message).
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
import type { PoseFrame, SceneConfig } from '../types/vrm';
import { SCENE_PRESETS, DEFAULT_SCENE_ID } from '../config/scenes';
import { VRM_SOURCES, DEFAULT_VRM_SOURCE_ID } from '../config/vrmSources';

// ─── Internal avatar slot ────────────────────────────────────────────────────

interface AvatarSlot {
  vrm: VRM;
  /** world-space X centre for this slot */
  baseX: number;
  poseState: PoseApplyState;
  initialHipsPos: THREE.Vector3;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve the X position for avatar at index `i` centred around origin */
function slotX(index: number, total: number, spacing: number): number {
  return (index - (total - 1) / 2) * spacing;
}

/** Apply lighting from a SceneConfig to a THREE.Scene */
function applyLights(scene: THREE.Scene, config: SceneConfig): void {
  for (const light of config.lights) {
    if (light.type === 'ambient') {
      scene.add(new THREE.AmbientLight(light.color ?? 0xffffff, light.intensity));
    } else if (light.type === 'directional') {
      const l = new THREE.DirectionalLight(light.color ?? 0xffffff, light.intensity);
      if (light.position) l.position.set(...light.position);
      scene.add(l);
    }
  }
}

/** Add a floor grid from a SceneConfig to a THREE.Scene */
function applyGrid(scene: THREE.Scene, config: SceneConfig): void {
  if (!config.grid) return;
  const { size, divisions, color } =
    config.grid === true
      ? { size: 20, divisions: 20, color: 0x2a2a4a }
      : { size: config.grid.size, divisions: config.grid.divisions, color: config.grid.color ?? 0x2a2a4a };
  const grid = new THREE.GridHelper(size, divisions, color, color);
  scene.add(grid);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UseBigScreenSceneOptions {
  /** Scene preset ID (default: 'classroom') */
  sceneId?: string;
  /** VRM source ID used for all avatars (default: 'default') */
  vrmSourceId?: string;
}

export function useBigScreenScene(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  options: UseBigScreenSceneOptions = {},
) {
  const { sceneId = DEFAULT_SCENE_ID, vrmSourceId = DEFAULT_VRM_SOURCE_ID } = options;

  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const clockRef = useRef(new THREE.Clock());
  const rafRef = useRef<number>(0);

  /** identity → avatar slot */
  const avatarsRef = useRef<Map<string, AvatarSlot>>(new Map());
  /** Ordered list of identities (determines x-position) */
  const orderRef = useRef<string[]>([]);
  /** In-flight VRM load promises – prevent duplicate loads */
  const loadingRef = useRef<Map<string, Promise<AvatarSlot>>>(new Map());

  // Keep a stable ref to the current preset so reposition/ensureAvatar
  // always see the latest spacing without re-creating callbacks.
  const presetRef = useRef<SceneConfig>(
    SCENE_PRESETS[sceneId] ?? SCENE_PRESETS[DEFAULT_SCENE_ID],
  );

  // ─── Scene initialisation ─────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const preset: SceneConfig =
      SCENE_PRESETS[sceneId] ?? SCENE_PRESETS[DEFAULT_SCENE_ID];
    presetRef.current = preset;


    const scene = new THREE.Scene();
    // Background is now handled via DOM layers (BigScreen.tsx)
    sceneRef.current = scene;

    const { fov, position, lookAt, near = 0.1, far = 50 } = preset.camera;
    const camera = new THREE.PerspectiveCamera(
      fov,
      canvas.width / canvas.height,
      near,
      far,
    );
    camera.position.set(...position);
    camera.lookAt(...lookAt);
    camera.updateMatrix()
    cameraRef.current = camera;



    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(canvas.width, canvas.height);
    renderer.setPixelRatio(window.devicePixelRatio);
    rendererRef.current = renderer;

    applyLights(scene, preset);
    applyGrid(scene, preset);

    // Render loop
    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);
      const delta = clockRef.current.getDelta();
      for (const slot of avatarsRef.current.values()) {
        slot.vrm.update(delta);
      }
      if (cameraRef.current) {
        renderer.render(scene, cameraRef.current);
      }
    };
    rafRef.current = requestAnimationFrame(animate);

    // Responsive resize
    const ro = new ResizeObserver(() => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      renderer.setSize(w, h, false);
      if (cameraRef.current) {
        cameraRef.current.aspect = w / h;
        cameraRef.current.updateProjectionMatrix();
      }
    });
    ro.observe(canvas);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafRef.current);
      for (const slot of avatarsRef.current.values()) {
        scene.remove(slot.vrm.scene);
      }
      avatarsRef.current.clear();
      loadingRef.current.clear();
      orderRef.current = [];
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef, sceneId]);

  // ─── Avatar layout ────────────────────────────────────────────────────────

  const reposition = useCallback(() => {
    const order = orderRef.current;
    const total = order.length;
    const spacing = presetRef.current.avatarSpacing ?? 1.6;

    order.forEach((id, i) => {
      const slot = avatarsRef.current.get(id);
      if (!slot) return;
      const x = slotX(i, total, spacing);
      slot.baseX = x;
      slot.vrm.scene.position.x = x;
    });

    if (cameraRef.current) {
      const spread = total > 1 ? spacing * (total - 1) : 0;
      // cameraRef.current.position.set(0, 1.2, Math.max(3, spread / 2 + 3.5));
      // cameraRef.current.lookAt(0, 1, 0);
    }
  }, []);

  // ─── Avatar lifecycle ─────────────────────────────────────────────────────

  const ensureAvatar = useCallback(
    (identity: string): Promise<AvatarSlot> => {
      const existing = avatarsRef.current.get(identity);
      if (existing) return Promise.resolve(existing);

      const inFlight = loadingRef.current.get(identity);
      if (inFlight) return inFlight;

      const scene = sceneRef.current;
      if (!scene) return Promise.reject(new Error('[BigScreenScene] Scene not ready'));

      const vrmSource = VRM_SOURCES[vrmSourceId] ?? VRM_SOURCES[DEFAULT_VRM_SOURCE_ID];
      const spawn = presetRef.current.avatarDefaults;

      const loadPromise = loadVrm({ url: vrmSource.url, scene, spawn })
        .then(({ vrm, initialHipsPos }) => {
          if (!orderRef.current.includes(identity)) {
            // Host avatar goes first (leftmost)
            if (identity.startsWith('host-')) {
              orderRef.current.unshift(identity);
            } else {
              orderRef.current.push(identity);
            }
          }

          const slot: AvatarSlot = {
            vrm,
            baseX: 0,
            poseState: createPoseApplyState(),
            initialHipsPos,
          };
          avatarsRef.current.set(identity, slot);
          loadingRef.current.delete(identity);
          reposition();
          return slot;
        })
        .catch((err) => {
          loadingRef.current.delete(identity);
          throw err;
        });

      loadingRef.current.set(identity, loadPromise);
      return loadPromise;
    },
    [reposition, vrmSourceId],
  );

  // ─── Pose application ─────────────────────────────────────────────────────

  const applyPose = useCallback(
    async (identity: string, rawData: unknown) => {
      try {
        const slot = await ensureAvatar(identity);
        const frame = rawData as PoseFrame;
        if (!frame?.landmarks || frame.landmarks.length < 33) return;

        const delta = clockRef.current.getDelta();
        applyPoseToVrm(
          slot.vrm,
          slot.poseState,
          frame.landmarks,
          frame.worldLandmarks ?? [],
          delta,
        );
      } catch (err) {
        console.warn(`[BigScreenScene] applyPose error for ${identity}:`, err);
      }
    },
    [ensureAvatar],
  );

  // ─── Avatar removal ───────────────────────────────────────────────────────

  const removeAvatar = useCallback(
    (identity: string) => {
      const slot = avatarsRef.current.get(identity);
      if (!slot) return;
      sceneRef.current?.remove(slot.vrm.scene);
      avatarsRef.current.delete(identity);
      orderRef.current = orderRef.current.filter((id) => id !== identity);
      reposition();
    },
    [reposition],
  );

  return { applyPose, removeAvatar };
}
