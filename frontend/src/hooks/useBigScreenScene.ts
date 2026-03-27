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
import { applyLights, applyGrid } from '../utils/threeScene';
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
  /** Latest unprocessed pose frame – set by applyPose, consumed in RAF */
  pendingPose: import('../types/vrm').PoseFrame | null;
  /** Last successfully applied frame – used for continuous 60 fps lerp */
  lastFrame: import('../types/vrm').PoseFrame | null;
  /** Timestamp (ms) when pendingPose was last set */
  lastPoseAt: number;
  /** Exponential moving average of inter-pose intervals (ms), default 33 = 30 fps */
  avgPoseIntervalMs: number;
}

/** lerpSpeed baseline at 30 fps; scaled proportionally to actual data rate */
const BASE_LERP_SPEED   = 14;
const BASE_INTERVAL_MS  = 33;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve the X position for avatar at index `i` centred around origin */
function slotX(index: number, total: number, spacing: number): number {
  return (index - (total - 1) / 2) * spacing;
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
  const timerRef = useRef(new THREE.Timer());
  const rafRef = useRef<number>(0);

  /** identity → avatar slot */
  const avatarsRef = useRef<Map<string, AvatarSlot>>(new Map());
  /** Ordered list of identities (determines x-position) */
  const orderRef = useRef<string[]>([]);
  /** In-flight VRM load promises – prevent duplicate loads */
  const loadingRef = useRef<Map<string, Promise<AvatarSlot>>>(new Map());
  /** Per-identity VRM URL overrides (set when a participant selects their own model) */
  const vrmUrlOverridesRef = useRef<Map<string, string>>(new Map());
  /**
   * Per-identity load generation counter.
   * Incremented each time a NEW load is started for an identity.
   * When a load resolves it checks its captured generation against the current
   * value; if stale (swapAvatar fired a newer load) the resolved VRM is removed
   * from the scene immediately, preventing ghost T-pose models.
   */
  const loadGenRef = useRef<Map<string, number>>(new Map());

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
    camera.updateProjectionMatrix();
    cameraRef.current = camera;



    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
    renderer.setPixelRatio(window.devicePixelRatio);
    rendererRef.current = renderer;

    applyLights(scene, preset);
    applyGrid(scene, preset);

    // Render loop
    const animate = (timestamp: number) => {
      rafRef.current = requestAnimationFrame(animate);
      timerRef.current.update(timestamp);
      const delta = timerRef.current.getDelta();

      for (const slot of avatarsRef.current.values()) {
        // Adaptive lerp speed: proportional to actual pose data rate.
        // At 30 fps (33 ms) → 14; at 15 fps (66 ms) → 7; cap 60 fps at 20.
        const adaptiveLerp = Math.min(
          BASE_LERP_SPEED * (BASE_INTERVAL_MS / Math.max(slot.avgPoseIntervalMs, 16)),
          20,
        );

        if (slot.pendingPose) {
          // New data: run full kalidokit solve + bone lerp
          applyPoseToVrm(slot.vrm, slot.poseState, slot.pendingPose, delta, {
            lerpSpeed: adaptiveLerp,
          });
          slot.lastFrame   = slot.pendingPose;
          slot.pendingPose = null;
        } else if (slot.lastFrame) {
          // No new data: continue lerping toward cached targets (skip re-solve)
          applyPoseToVrm(slot.vrm, slot.poseState, slot.lastFrame, delta, {
            lerpSpeed: adaptiveLerp,
            reuseLastSolve: true,
          });
        }

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
      loadGenRef.current.clear();
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

  }, []);

  // ─── Avatar lifecycle ─────────────────────────────────────────────────────

  const ensureAvatar = useCallback(
    (identity: string, vrmUrlOverride?: string): Promise<AvatarSlot> => {
      const existing = avatarsRef.current.get(identity);
      if (existing) return Promise.resolve(existing);

      const inFlight = loadingRef.current.get(identity);
      if (inFlight) return inFlight;

      const scene = sceneRef.current;
      if (!scene) return Promise.reject(new Error('[BigScreenScene] Scene not ready'));

      // Priority: explicit override → per-identity stored override → global fallback
      const resolvedUrl =
        vrmUrlOverride ??
        vrmUrlOverridesRef.current.get(identity) ??
        (VRM_SOURCES[vrmSourceId] ?? VRM_SOURCES[DEFAULT_VRM_SOURCE_ID]).url;
      const spawn = presetRef.current.avatarDefaults;

      // Assign a generation so stale loads (superseded by swapAvatar) can
      // detect themselves and remove the already-added VRM from the scene.
      const gen = (loadGenRef.current.get(identity) ?? 0) + 1;
      loadGenRef.current.set(identity, gen);

      const loadPromise = loadVrm({ url: resolvedUrl, scene, spawn })
        .then(({ vrm, initialHipsPos }) => {
          // loadVrm already called scene.add(vrm.scene). If a newer load was
          // started for this identity, discard this one to avoid ghost models.
          if (loadGenRef.current.get(identity) !== gen) {
            scene.remove(vrm.scene);
            throw new Error(`[BigScreenScene] Stale load discarded for ${identity}`);
          }

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
            pendingPose: null,
            lastFrame: null,
            lastPoseAt: 0,
            avgPoseIntervalMs: BASE_INTERVAL_MS,
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

  /** Swap the VRM model for a specific identity. Removes old avatar and reloads with new URL. */
  const swapAvatar = useCallback(
    (identity: string, vrmUrl: string) => {
      // Avoid reloading if it is already exactly this URL override
      if (vrmUrlOverridesRef.current.get(identity) === vrmUrl) return;

      // Store the override so future ensureAvatar calls use it
      vrmUrlOverridesRef.current.set(identity, vrmUrl);

      // Cancel any in-flight load regardless of whether a slot is present
      loadingRef.current.delete(identity);

      // Remove the existing avatar from scene (keeps order slot)
      const slot = avatarsRef.current.get(identity);
      if (slot) {
        sceneRef.current?.remove(slot.vrm.scene);
        avatarsRef.current.delete(identity);
      }

      console.log(`[BigScreenScene] Swapping avatar for ${identity} to ${vrmUrl}`);
      // Re-load with new URL (ensureAvatar will pick up the override)
      ensureAvatar(identity, vrmUrl).catch((err) =>
        console.warn(`[BigScreenScene] swapAvatar failed for ${identity}:`, err),
      );
    },
    [ensureAvatar],
  );

  // ─── Pose application ─────────────────────────────────────────────────────

  /**
   * Queue a pose frame for the given identity.
   *
   * The actual bone math runs inside the RAF loop (render-driven), not here.
   * This means:
   *  • BroadcastChannel messages that arrive faster than the render rate are
   *    automatically coalesced – only the latest frame per identity is kept.
   *  • The kalidokit solver never runs outside requestAnimationFrame.
   *  • timerRef state is only mutated from one place (the RAF callback).
   */
  const applyPose = useCallback(
    async (identity: string, rawData: unknown) => {
      try {
        const slot = await ensureAvatar(identity);
        const frame = rawData as PoseFrame;
        if (!frame?.landmarks || frame.landmarks.length < 33) return;

        // Track inter-pose interval for adaptive lerp
        const now = performance.now();
        const interval = now - slot.lastPoseAt;
        if (slot.lastPoseAt > 0 && interval < 500) {
          // EMA: 10 % new sample – slow adaptation for stability
          slot.avgPoseIntervalMs = slot.avgPoseIntervalMs * 0.9 + interval * 0.1;
        }
        slot.lastPoseAt = now;

        // Queue for render loop (latest frame wins; previous pending is dropped)
        slot.pendingPose = frame;
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
      loadingRef.current.delete(identity);
      // Invalidate any in-flight load so it discards itself on resolve
      loadGenRef.current.delete(identity);
      orderRef.current = orderRef.current.filter((id) => id !== identity);
      vrmUrlOverridesRef.current.delete(identity);
      reposition();
    },
    [reposition],
  );

  /**
   * Pre-register a VRM URL for an identity WITHOUT triggering a load.
   * The override will be picked up the next time ensureAvatar is called
   * (i.e. when the first pose frame arrives for this identity).
   * Use this to avoid T-pose ghost models when setting up known participants
   * before their pose data has arrived.
   */
  const setVrmOverride = useCallback((identity: string, vrmUrl: string) => {
    vrmUrlOverridesRef.current.set(identity, vrmUrl);
  }, []);

  return { applyPose, removeAvatar, swapAvatar, setVrmOverride };
}
