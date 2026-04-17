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
import {
  loadStaticProps,
  loadTaskProps,
  disposeStaticProps,
  disposeTaskProps,
} from '../utils/propLoader';
import type { PoseFrame, SceneConfig, AvatarSpawnConfig } from '../types/vrm';
import { SCENE_PRESETS, DEFAULT_SCENE_ID } from '../config/scenes';
import { VRM_SOURCES, DEFAULT_VRM_SOURCE_ID } from '../config/vrmSources';
import {
  highlightProp,
  projectToUV,
  attachPropToHand,
  returnPropToDisplay,
} from '../utils/propInteraction';
import {
  detectFist,
  detectOpenHand,
  isHandRaised,
  isHandNearProp,
} from '../utils/gestureDetector';

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
  /** Object interaction state machine */
  interaction: {
    propState: 'displayed' | 'held' | 'returning';
    lockHand: 'left' | 'right' | null;
    /** Last task ID seen — detects task changes */
    lastTaskId: string | undefined;
    /**
     * Task ID of the prop currently being lerped back to displayPos after a
     * task switch (may differ from lastTaskId / currentTaskId).
     */
    returningTaskId: string | undefined;
    /** performance.now() when hand landmarks were last seen (grace period) */
    handLostAt: number;
    /** Consecutive fist-detected frames — must reach GRAB_CONFIRM_FRAMES before grab */
    grabConfirmCount: number;
    /** performance.now() deadline before which open-hand release is ignored */
    grabCooldownUntil: number;
  };
}

/** lerpSpeed baseline at 30 fps; scaled proportionally to actual data rate */
const BASE_LERP_SPEED = 14;
const BASE_INTERVAL_MS = 33;

/** Number of consecutive fist-detected frames required before triggering a grab */
const GRAB_CONFIRM_FRAMES = 3;
/** Milliseconds after a grab during which open-hand is ignored (prevents instant release) */
const GRAB_RELEASE_COOLDOWN_MS = 600;

/** Reusable Vector3 for prop returning target — avoids per-frame allocation */
const _displayPosVec = new THREE.Vector3();

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
  /** Slot assignments from HostSession: slotId → participant identity */
  slotAssignments?: Record<string, string>;
  /** Currently active task ID — tracked for Phase 2 interaction triggers */
  currentTaskId?: string;
}

export function useBigScreenScene(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  options: UseBigScreenSceneOptions = {},
) {
  const { sceneId = DEFAULT_SCENE_ID, vrmSourceId = DEFAULT_VRM_SOURCE_ID, slotAssignments, currentTaskId } = options;

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

  /** Accumulated elapsed time (seconds) — drives emissive pulse sin() */
  const elapsedRef = useRef(0);
  /** taskId → identity currently holding it. Prevents two slots grabbing the same prop. */
  const heldByIdentityRef = useRef<Map<string, string>>(new Map());

  /** Latest slot assignments (slotId → identity). Updated each render so callbacks are current. */
  const slotAssignmentsRef = useRef<Record<string, string>>(slotAssignments ?? {});
  slotAssignmentsRef.current = slotAssignments ?? {};

  /** Identities that are slot-pinned (should not use auto-spacing). */
  const slotPinnedRef = useRef<Set<string>>(new Set());
  /** Per-identity spawn overrides set when an identity is assigned to a slot. */
  const spawnOverridesRef = useRef<Map<string, AvatarSpawnConfig>>(new Map());

  const staticPropGroupsRef = useRef<THREE.Group[]>([]);
  const taskPropPoolRef = useRef<Map<string, THREE.Group>>(new Map());
  /** Tracks the active task ID for Phase 2 interaction use */
  const currentTaskIdRef = useRef<string | undefined>(undefined);
  currentTaskIdRef.current = currentTaskId;

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
    // applyGrid(scene, preset);

    // Pre-load scene props (per-asset errors are swallowed inside propLoader)
    let propsCancelled = false;
    if (preset.propSystem) {
      loadStaticProps(preset.propSystem.staticProps ?? [], scene)
        .then((groups) => {
          if (propsCancelled) { disposeStaticProps(groups, scene); return; }
          staticPropGroupsRef.current = groups;
        })
        .catch((err) => console.warn('[BigScreenScene] staticProps load error:', err));

      loadTaskProps(preset.propSystem.taskProps ?? {}, scene)
        .then((pool) => {
          if (propsCancelled) { disposeTaskProps(pool, scene); return; }
          taskPropPoolRef.current = pool;
        })
        .catch((err) => console.warn('[BigScreenScene] taskProps load error:', err));
    }

    // Render loop
    const animate = (timestamp: number) => {
      rafRef.current = requestAnimationFrame(animate);
      timerRef.current.update(timestamp);
      const delta = timerRef.current.getDelta();
      elapsedRef.current += delta;

      for (const [identity, slot] of avatarsRef.current.entries()) {
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
          slot.lastFrame = slot.pendingPose;
          slot.pendingPose = null;
        } else if (slot.lastFrame) {
          // No new data: continue lerping toward cached targets (skip re-solve)
          applyPoseToVrm(slot.vrm, slot.poseState, slot.lastFrame, delta, {
            lerpSpeed: adaptiveLerp,
            reuseLastSolve: true,
          });
        }

        slot.vrm.update(delta);

        // ── Prop interaction state machine ────────────────────────────────────
        {
          const taskId = currentTaskIdRef.current;
          const prop = taskId ? taskPropPoolRef.current.get(taskId) : undefined;
          const ia = slot.interaction;

          // ── Task change detection ──────────────────────────────────────────
          if (ia.lastTaskId !== taskId) {
            const oldTaskId = ia.lastTaskId;
            if (oldTaskId) {
              const oldProp = taskPropPoolRef.current.get(oldTaskId);
              if (oldProp) {
                // Stop highlighting; always return to displayPos smoothly
                highlightProp(oldProp, false);
                console.log("ia.propState", ia.propState);

                if (ia.propState === 'held' || ia.propState === 'returning') {
                  // Let the returning handler lerp the old prop back using returningTaskId
                  ia.returningTaskId = oldTaskId;
                  ia.propState = 'returning';
                } else {
                  // 正常放手
                  ia.returningTaskId = undefined;
                }
              } else {
                ia.returningTaskId = undefined;
              }
              if (heldByIdentityRef.current.get(oldTaskId) === identity) {
                heldByIdentityRef.current.delete(oldTaskId);
              }
            } else {
              ia.returningTaskId = undefined;
            }
            // Reset grab state for the new task
            ia.lockHand = null;
            ia.handLostAt = 0;
            ia.grabConfirmCount = 0;
            ia.grabCooldownUntil = 0;
            ia.lastTaskId = taskId;
          }

          // ── Cross-task returning: runs BEFORE the prop-guard so the old prop
          //    always lerps home even when the new task has no prop yet. ────────
          if (ia.propState === 'returning' && ia.returningTaskId) {
            const returningProp = taskPropPoolRef.current.get(ia.returningTaskId);
            const dpCfg = presetRef.current.propSystem?.taskProps?.[ia.returningTaskId]?.displayPos;
            if (returningProp && dpCfg) {
              _displayPosVec.set(...dpCfg);
              const arrived = returnPropToDisplay(returningProp, _displayPosVec, delta);
              if (arrived) {
                ia.propState = 'displayed';
                ia.returningTaskId = undefined;
              }
            } else {
              // No prop or displayPos config — snap complete
              ia.propState = 'displayed';
              ia.returningTaskId = undefined;
            }
            continue; // old prop is animating back; skip current-task logic
          }

          if (!taskId || !prop) continue; // no prop for this task — skip

          // ── Hand landmarks from last known frame ───────────────────────────
          const frame = slot.lastFrame;
          const rightHand = frame?.rightHandLandmarks;
          const leftHand = frame?.leftHandLandmarks;
          const pose = frame?.landmarks;

          // ── displayed: highlight + grab detection ─────────────────────────

          if (ia.propState === 'displayed') {
            // Only highlight when no other slot is currently holding this prop;
            // otherwise a later slot would re-enable the glow on an already-held prop.
            if (!heldByIdentityRef.current.has(taskId)) {
              highlightProp(prop, true, elapsedRef.current);
            }

            let grabbedThisFrame = false;
            let fistDetectedThisFrame = false;
            if (cameraRef.current) {
              const propUV = projectToUV(prop.position, cameraRef.current);

              for (const hand of ['right', 'left'] as const) {
                const hLandmarks = hand === 'right' ? rightHand : leftHand;
                if (!hLandmarks || hLandmarks.length < 21) continue;
                if (!pose || pose.length < 25) continue;
                // Prevent a second slot from grabbing a prop already held
                if (heldByIdentityRef.current.has(taskId)) continue;

                const wristUV = { x: hLandmarks[0].x, y: hLandmarks[0].y };
                const fist = detectFist(hLandmarks);
                const raised = isHandRaised(pose, hand);
                const near = isHandNearProp(wristUV, propUV);

                if (fist && (raised || near)) {
                  fistDetectedThisFrame = true;
                  ia.grabConfirmCount++;
                  if (ia.grabConfirmCount >= GRAB_CONFIRM_FRAMES) {
                    ia.propState = 'held';
                    ia.lockHand = hand;
                    ia.handLostAt = 0;
                    ia.grabConfirmCount = 0;
                    ia.grabCooldownUntil = performance.now() + GRAB_RELEASE_COOLDOWN_MS;
                    heldByIdentityRef.current.set(taskId, identity);
                    highlightProp(prop, false);
                    grabbedThisFrame = true;
                  }
                  break; // counting toward one hand at a time
                }
              }
            }
            // Only reset counter when no fist gesture was present this frame;
            // keep accumulating while the fist is held but count < threshold.
            if (!fistDetectedThisFrame && !grabbedThisFrame) {
              ia.grabConfirmCount = 0;
            }

            // ── held: follow hand bone, detect release ─────────────────────────
          } else if (ia.propState === 'held' && ia.lockHand) {
            attachPropToHand(prop, slot.vrm, ia.lockHand, true);

            const hLandmarks = ia.lockHand === 'right' ? rightHand : leftHand;
            const now = performance.now();
            const inCooldown = now < ia.grabCooldownUntil;

            if (!hLandmarks || hLandmarks.length < 21) {
              // Grace period: 500 ms before forcing a release on landmark loss
              if (!inCooldown) {
                if (ia.handLostAt === 0) ia.handLostAt = now;
                if (now - ia.handLostAt > 500) {
                  heldByIdentityRef.current.delete(taskId);
                  ia.propState = 'returning';
                  ia.lockHand = null;
                  ia.grabCooldownUntil = 0;
                }
              }
            } else {
              ia.handLostAt = 0;
              if (!inCooldown && detectOpenHand(hLandmarks)) {
                heldByIdentityRef.current.delete(taskId);
                ia.propState = 'returning';
                ia.lockHand = null;
                ia.grabCooldownUntil = 0;
              }
            }

            // ── returning (same task): lerp back to displayPos ────────────────
          } else if (ia.propState === 'returning') {
            const dpCfg = presetRef.current.propSystem?.taskProps?.[taskId]?.displayPos;
            if (dpCfg) {
              _displayPosVec.set(...dpCfg);
              const arrived = returnPropToDisplay(prop, _displayPosVec, delta);
              if (arrived) {
                ia.propState = 'displayed';
              }
            } else {
              ia.propState = 'displayed';
            }
          }
        }
        // ── End prop interaction ───────────────────────────────────────────────
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
      propsCancelled = true;
      ro.disconnect();
      cancelAnimationFrame(rafRef.current);
      for (const slot of avatarsRef.current.values()) {
        scene.remove(slot.vrm.scene);
      }
      avatarsRef.current.clear();
      loadingRef.current.clear();
      loadGenRef.current.clear();
      orderRef.current = [];
      slotPinnedRef.current.clear();
      spawnOverridesRef.current.clear();
      disposeStaticProps(staticPropGroupsRef.current, scene);
      staticPropGroupsRef.current = [];
      disposeTaskProps(taskPropPoolRef.current, scene);
      heldByIdentityRef.current.clear();
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
      if (slotPinnedRef.current.has(id)) return; // slot-pinned: position is managed by slot
      const slot = avatarsRef.current.get(id);
      if (!slot) return;
      const x = slotX(i, total, spacing);
      slot.baseX = x;
      slot.vrm.scene.position.x = x;
    });

  }, []);

  // ─── Avatar lifecycle ─────────────────────────────────────────────────────

  const ensureAvatar = useCallback(
    (identity: string, vrmUrlOverride?: string, spawnOverride?: AvatarSpawnConfig): Promise<AvatarSlot> => {
      // If a spawn override is provided, pin the identity and store the override
      if (spawnOverride) {
        slotPinnedRef.current.add(identity);
        spawnOverridesRef.current.set(identity, spawnOverride);
      }

      const existing = avatarsRef.current.get(identity);
      if (existing) {
        // Reposition to new slot location if spawn override provided
        if (spawnOverride?.position) {
          existing.vrm.scene.position.set(...spawnOverride.position);
          existing.baseX = spawnOverride.position[0];
        }
        if (spawnOverride?.rotation) {
          existing.vrm.scene.rotation.set(...spawnOverride.rotation);
        }
        return Promise.resolve(existing);
      }

      const inFlight = loadingRef.current.get(identity);
      if (inFlight) return inFlight;

      const scene = sceneRef.current;
      if (!scene) return Promise.reject(new Error('[BigScreenScene] Scene not ready'));

      // Priority: explicit override → per-identity stored override → global fallback
      const resolvedUrl =
        vrmUrlOverride ??
        vrmUrlOverridesRef.current.get(identity) ??
        // (VRM_SOURCES[vrmSourceId] ?? VRM_SOURCES[DEFAULT_VRM_SOURCE_ID]).url;
        VRM_SOURCES[vrmSourceId].url ?? null;
      // Spawn priority: explicit override → stored slot override → scene avatarDefaults
      const spawn =
        spawnOverride ??
        spawnOverridesRef.current.get(identity) ??
        presetRef.current.avatarDefaults;

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

          const isSlotPinned = slotPinnedRef.current.has(identity);
          if (!isSlotPinned) {
            if (!orderRef.current.includes(identity)) {
              // Host avatar goes first (leftmost)
              if (identity.startsWith('host-')) {
                orderRef.current.unshift(identity);
              } else {
                orderRef.current.push(identity);
              }
            }
          }

          const slot: AvatarSlot = {
            vrm,
            baseX: spawn?.position?.[0] ?? 0,
            poseState: createPoseApplyState(),
            initialHipsPos,
            pendingPose: null,
            lastFrame: null,
            lastPoseAt: 0,
            avgPoseIntervalMs: BASE_INTERVAL_MS,
            interaction: {
              propState: 'displayed',
              lockHand: null,
              lastTaskId: undefined,
              returningTaskId: undefined,
              handLostAt: 0,
              grabConfirmCount: 0,
              grabCooldownUntil: 0,
            },
          };
          avatarsRef.current.set(identity, slot);
          loadingRef.current.delete(identity);
          if (!isSlotPinned) reposition();
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
        const preset = presetRef.current;

        // In slotted scenes, only load avatars for assigned participants
        let slotSpawn: AvatarSpawnConfig | undefined;
        if (preset.slots && preset.slots.length > 0) {
          const slotId = Object.entries(slotAssignmentsRef.current)
            .find(([, id]) => id === identity)?.[0];
          if (!slotId) return; // unassigned: not shown on BigScreen
          const sceneSlot = preset.slots.find(s => s.id === slotId);
          if (sceneSlot) {
            slotSpawn = {
              position: sceneSlot.position,
              rotation: sceneSlot.rotation,
              scale: preset.avatarDefaults?.scale,
            };
          }
        }

        const slot = await ensureAvatar(identity, undefined, slotSpawn);
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
      slotPinnedRef.current.delete(identity);
      spawnOverridesRef.current.delete(identity);
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

  return { applyPose, removeAvatar, swapAvatar, setVrmOverride, ensureAvatar };
}
