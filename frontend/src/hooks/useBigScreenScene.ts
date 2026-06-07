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
import { useEffect, useRef, useCallback, useState } from 'react';
import type { RefObject } from 'react';
import * as THREE from 'three';
import { VRMUtils, type VRM } from '@pixiv/three-vrm';
import { loadVrm } from '../utils/vrmLoader';
import {
  applyPoseToVrm,
  createPoseApplyState,
  type PoseApplyState,
} from '../utils/vrmPoseApplier';
import { applyLights } from '../utils/threeScene';
import {
  loadStaticProps,
  loadTaskProps,
  disposeStaticProps,
  disposeTaskProps,
} from '../utils/propLoader';
import { loadOccluderGlb, disposeOccluder } from '../utils/occluderLoader';
import { OCCLUDER_LIBRARY_BY_ID } from '../config/sceneOccluders';
import type { SceneOccluderInstance } from '../types/sceneOccluder';
import type { PoseFrame, SceneConfig, AvatarSpawnConfig, GroupMemberRef } from '../types/vrm';
import {
  applyGroupTransform,
  computePivot,
  IDENTITY_TRANSFORM,
  type Vec3,
} from '../utils/groupTransform';
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
import type { StatsSnapshot } from '../components/StatsPanel';

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
    /** performance.now() when the first fist frame was detected (0 = not tracking) */
    grabFistFirstAt: number;
    /** performance.now() deadline before which open-hand release is ignored */
    grabCooldownUntil: number;
  };
  /** Pre-allocated output for projectToUV — avoids per-frame {x,y} allocation */
  _propUV: { x: number; y: number };
}

/** lerpSpeed baseline at 30 fps; scaled proportionally to actual data rate */
const BASE_LERP_SPEED = 14;
const BASE_INTERVAL_MS = 33;

/** Milliseconds the fist must be held continuously before triggering a grab.
 *  Time-based so behaviour is identical at any render/pose FPS. */
const GRAB_CONFIRM_MS = 100;
/** Milliseconds after a grab during which open-hand is ignored (prevents instant release) */
const GRAB_RELEASE_COOLDOWN_MS = 600;

/** Reusable Vector3 for prop returning target — avoids per-frame allocation */
const _displayPosVec = new THREE.Vector3();

/** Reusable vectors for per-frame head projection — avoids allocation. */
const _headWorld = new THREE.Vector3();
const _headUV = { x: 0, y: 0 };

/** 編輯模式 placeholder avatar identity 命名空間前綴。 */
const PLACEHOLDER_PREFIX = '__placeholder__:';

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
  /** Called once per frame with renderer stats. Only passed when stats panel is visible. */
  onStats?: (s: StatsSnapshot) => void;
  /**
   * Called after the scene's initial static + task props have finished loading
   * (or immediately if the preset declares no propSystem). Fires on every
   * (re)initialisation of the scene — i.e. on mount and on every sceneId change.
   * Used by the BigScreen boot-loading overlay to track progress.
   */
  onScenePropsReady?: () => void;
  /** Cap the THREE.js render loop. 0 = unlimited (default). Read every frame via ref. */
  renderFpsLimit?: number;
  /** Whether BigScreen is actively recording. Hook lowers pixel ratio to 1 during recording. */
  isRecording?: boolean;
  /**
   * Ref to a post-render callback.  When `.current` is non-null the hook calls it after
   * every `renderer.render()`, driving the composite canvas from inside this loop instead
   * of a competing second requestAnimationFrame.
   */
  onPostRenderRef?: { current: ((timestamp: number) => void) | null };
  /** 群組變換：groupId → {pos, rot}（rot 為 radian）。改變時自動 re-apply。 */
  groupTransforms?: Record<string, { pos: [number, number, number]; rot: [number, number, number] }>;
  /** 目前正在說話的 identity 清單（驅動頭上標記投影）。 */
  speakingIdentities?: string[];
  /**
   * 每幀（節流）回呼說話中 avatar 的頭部 UV 座標（0..1，左上為原點）。
   * 無人說話時回呼空物件一次以清除標記。
   */
  onSpeakerAnchors?: (anchors: Record<string, { x: number; y: number }>) => void;
  /**
   * 當前場景的遮罩物件實例清單。改變時依 instanceId 做 diff:
   * 新增 → 載入 GLB;移除 → dispose;保留 → 同步 transform。
   * scene unmount 時全部 dispose。
   */
  occluderInstances?: SceneOccluderInstance[];
  /**
   * 編輯模式專用:列表中每個 slot 用 defaultVrmId spawn 一個 idle avatar。
   * Identity 自動以 `__placeholder__:<slotId>` 命名,避免與真實 participant 衝突。
   * 退出編輯模式(此 prop 變空)時批次 remove。
   */
  editorPlaceholderSlots?: import('../types/vrm').SceneSlot[];
  /** 編輯模式 — 為 true 時建立 TransformControls 並接事件;false 釋放。 */
  editorGizmoEnabled?: boolean;
  /** 編輯模式 — gizmo 拖拽結束時呼叫(`dragging-changed === false`),帶被 attach 物件最終 transform。 */
  onGizmoDragEnd?: (target: import('three').Object3D) => void;
  /** 編輯模式 — 拖拽開始時呼叫(用來把 target 標記為 editorPinned)。 */
  onGizmoDragStart?: (target: import('three').Object3D) => void;
  /** Hook 暴露 occluder instanceId → root 的查找 callback;Overlay 用它 setTarget。 */
  onOccluderRoots?: (map: ReadonlyMap<string, import('three').Object3D>) => void;
  /** Hook 暴露 gizmo handle(讓 Overlay 直接 setTarget / setMode)。 */
  onGizmoHandle?: (handle: import('../utils/editorGizmo').GizmoHandle | null) => void;
}

export function useBigScreenScene(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  options: UseBigScreenSceneOptions = {},
) {
  const { sceneId = DEFAULT_SCENE_ID, vrmSourceId = DEFAULT_VRM_SOURCE_ID, slotAssignments, currentTaskId, onStats, onScenePropsReady, renderFpsLimit, isRecording, onPostRenderRef, groupTransforms, speakingIdentities, onSpeakerAnchors, occluderInstances, editorPlaceholderSlots, editorGizmoEnabled, onGizmoDragEnd, onGizmoDragStart, onOccluderRoots, onGizmoHandle } = options;

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

  const staticPropPoolRef = useRef<Map<string, THREE.Group>>(new Map());
  const taskPropPoolRef = useRef<Map<string, THREE.Group>>(new Map());

  /**
   * 已掛載的遮罩物件:instanceId → THREE.Group。
   * 每次 occluderInstances prop 變動時做 diff sync;scene unmount 時整批 dispose。
   */
  const occluderPoolRef = useRef<Map<string, THREE.Group>>(new Map());
  /** 記錄每個 instanceId 目前用的 libraryId,以判斷是否需要重新載入(libraryId 改變)。 */
  const occluderLibIdsRef = useRef<Map<string, string>>(new Map());
  /** in-flight 載入旗標,避免同一 instanceId 重複觸發載入。 */
  const occluderLoadingRef = useRef<Set<string>>(new Set());

  const groupTransformsRef = useRef<Record<string, { pos: [number, number, number]; rot: [number, number, number] }>>({});
  useEffect(() => { groupTransformsRef.current = groupTransforms ?? {}; }, [groupTransforms]);

  const placeholderIdentitiesRef = useRef<Set<string>>(new Set());

  // Scene init readiness signal — set true after sceneRef.current = scene,
  // cleared on scene teardown. Used by effects that depend on the scene existing
  // (e.g. placeholder spawn) so they re-fire once the scene is up.
  const [sceneReady, setSceneReady] = useState(false);

  // ─── Occluder diff sync ────────────────────────────────────────────────────
  // 依 instanceId 比對:
  //  - 新增 instanceId → 載入 GLB 並設定 transform
  //  - 既有 instanceId 但 libraryId 改變 → dispose 舊的,重新載入(MVP 罕見;
  //    drawer 不提供「換成另一個 library 物件」流程,但保險為之)
  //  - 既有 instanceId 且 libraryId 同 → 只更新 transform
  //  - 移除的 instanceId → dispose
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const next = occluderInstances ?? [];
    const nextIds = new Set(next.map((i) => i.instanceId));

    // 移除不再存在的 instance
    for (const [id, group] of occluderPoolRef.current.entries()) {
      if (!nextIds.has(id)) {
        disposeOccluder(group, scene);
        occluderPoolRef.current.delete(id);
        occluderLibIdsRef.current.delete(id);
      }
    }
    onOccluderRoots?.(occluderPoolRef.current);

    // 新增 / 更新
    for (const inst of next) {
      const existing = occluderPoolRef.current.get(inst.instanceId);
      const sameLib = occluderLibIdsRef.current.get(inst.instanceId) === inst.libraryId;

      if (existing && sameLib) {
        if (existing.userData.editorPinned) continue;
        existing.position.set(...inst.position);
        existing.rotation.set(...inst.rotation);
        existing.scale.setScalar(inst.scale);
        continue;
      }

      // library 變了 — 先 dispose 舊的
      if (existing && !sameLib) {
        disposeOccluder(existing, scene);
        occluderPoolRef.current.delete(inst.instanceId);
        occluderLibIdsRef.current.delete(inst.instanceId);
        onOccluderRoots?.(occluderPoolRef.current);
      }

      // 跳過進行中載入,避免同 instance 連續變更導致重複載入
      if (occluderLoadingRef.current.has(inst.instanceId)) continue;

      const libItem = OCCLUDER_LIBRARY_BY_ID[inst.libraryId];
      if (!libItem) {
        // library 已被開發者移除 — 視同失效,drawer 端會顯示 (已失效)
        continue;
      }

      occluderLoadingRef.current.add(inst.instanceId);
      const sceneAtLoad = scene; // capture,避免在切場景後寫進舊 scene
      loadOccluderGlb(libItem.glbUrl, sceneAtLoad)
        .then((group) => {
          occluderLoadingRef.current.delete(inst.instanceId);
          if (!group) return;
          // 載入完成時可能已切場景或 instance 已被刪除,需驗證
          if (sceneRef.current !== sceneAtLoad) {
            disposeOccluder(group, sceneAtLoad);
            return;
          }
          // instance 還在嗎?
          const stillExpected = (occluderInstancesRef.current ?? []).some(
            (i) => i.instanceId === inst.instanceId && i.libraryId === inst.libraryId,
          );
          if (!stillExpected) {
            disposeOccluder(group, sceneAtLoad);
            return;
          }
          group.position.set(...inst.position);
          group.rotation.set(...inst.rotation);
          group.scale.setScalar(inst.scale);
          occluderPoolRef.current.set(inst.instanceId, group);
          occluderLibIdsRef.current.set(inst.instanceId, inst.libraryId);
          onOccluderRoots?.(occluderPoolRef.current);
        })
        .catch((err) => {
          occluderLoadingRef.current.delete(inst.instanceId);
          console.warn('[BigScreenScene] occluder load error:', err);
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occluderInstances, sceneReady]);

  /** 給 in-flight 載入完成回呼判斷 instance 是否仍被要求渲染。 */
  const occluderInstancesRef = useRef<SceneOccluderInstance[]>(occluderInstances ?? []);
  useEffect(() => { occluderInstancesRef.current = occluderInstances ?? []; }, [occluderInstances]);

  // ─── Editor placeholder slot avatars ─────────────────────────────────────
  // 等 sceneReady 為 true 才動作 — 否則 ensureAvatar 會 reject。
  useEffect(() => {
    if (!sceneReady) return;
    const slots = editorPlaceholderSlots ?? [];
    const wantIds = new Set(slots.map(s => `${PLACEHOLDER_PREFIX}${s.id}`));

    // Remove placeholders no longer expected
    for (const id of placeholderIdentitiesRef.current) {
      if (!wantIds.has(id)) {
        removeAvatar(id);
        placeholderIdentitiesRef.current.delete(id);
      }
    }

    // Spawn missing placeholders
    for (const slot of slots) {
      const id = `${PLACEHOLDER_PREFIX}${slot.id}`;
      if (placeholderIdentitiesRef.current.has(id)) continue;
      const vrmId = slot.defaultVrmId ?? DEFAULT_VRM_SOURCE_ID;
      const vrmUrl = (VRM_SOURCES[vrmId] ?? VRM_SOURCES[DEFAULT_VRM_SOURCE_ID]).url;
      const spawnOverride = {
        position: slot.position,
        rotation: slot.rotation,
        scale: presetRef.current.avatarDefaults?.scale,
      };
      // 防禦:race 情況下若 scene 被 dispose,ensureAvatar 會 reject — 不要冒泡。
      ensureAvatar(id, vrmUrl, spawnOverride)
        .then((avatarSlot) => {
          // 沒有 pose driver → 預設停在 T-pose(十字)。在 spawn 完手動把
          // 上臂放下,讓 placeholder 看起來像 idle 站姿。
          const h = avatarSlot.vrm.humanoid;
          if (!h) return;
          const l = h.getNormalizedBoneNode('leftUpperArm');
          const r = h.getNormalizedBoneNode('rightUpperArm');
          if (l) l.rotation.set(0, 0, -(70 * Math.PI) / 180);
          if (r) r.rotation.set(0, 0, (70 * Math.PI) / 180);
        })
        .catch((err) => {
          console.warn('[BigScreenScene] placeholder spawn failed:', err);
          placeholderIdentitiesRef.current.delete(id);
        });
      placeholderIdentitiesRef.current.add(id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorPlaceholderSlots, sceneReady]);

  // ─── TransformControls gizmo lifecycle(編輯模式)──────────────────────
  useEffect(() => {
    const enabled = !!editorGizmoEnabled;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    if (!enabled || !scene || !camera || !renderer) {
      onGizmoHandle?.(null);
      return;
    }
    // 動態 import 避開 SSR / 同步循環
    let handle: import('../utils/editorGizmo').GizmoHandle | null = null;
    let cancelled = false;
    let onDragChange: ((e: { value: boolean }) => void) | null = null;
    void import('../utils/editorGizmo').then(({ attachGizmo }) => {
      if (cancelled) return;
      handle = attachGizmo(scene, camera, renderer.domElement, 'translate');
      onDragChange = (e: { value: boolean }) => {
        const target = (handle!.controls as unknown as { object?: import('three').Object3D }).object;
        if (!target) return;
        if (e.value) onGizmoDragStart?.(target);
        else onGizmoDragEnd?.(target);
      };
      handle.controls.addEventListener('dragging-changed', onDragChange as unknown as () => void);
      onGizmoHandle?.(handle);
    });
    return () => {
      cancelled = true;
      if (handle) {
        if (onDragChange) {
          try { handle.controls.removeEventListener('dragging-changed', onDragChange as unknown as () => void); } catch { /* ignore */ }
        }
        handle.dispose();
      }
      onGizmoHandle?.(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorGizmoEnabled, sceneReady]);

  /** 套用群組變換後的 taskProp displayPos：taskId → final pos。 */
  const effectiveDisplayPosRef = useRef<Map<string, Vec3>>(new Map());
  /** Tracks the active task ID for Phase 2 interaction use */
  const currentTaskIdRef = useRef<string | undefined>(undefined);
  currentTaskIdRef.current = currentTaskId;

  const onStatsRef = useRef<((s: StatsSnapshot) => void) | undefined>(undefined);
  onStatsRef.current = onStats;

  const onScenePropsReadyRef = useRef<(() => void) | undefined>(undefined);
  onScenePropsReadyRef.current = onScenePropsReady;

  const renderFpsLimitRef = useRef<number>(0);
  renderFpsLimitRef.current = renderFpsLimit ?? 0;

  const isRecordingRef = useRef(false);
  isRecordingRef.current = isRecording ?? false;
  const prevRecordingRef = useRef(false);
  const originalDprRef = useRef(Math.min(window.devicePixelRatio, 2));

  const avgPoseIntervalsRef = useRef<Record<string, number>>({});

  const speakingIdentitiesRef = useRef<string[]>([]);
  speakingIdentitiesRef.current = speakingIdentities ?? [];
  const onSpeakerAnchorsRef = useRef<UseBigScreenSceneOptions['onSpeakerAnchors']>(undefined);
  onSpeakerAnchorsRef.current = onSpeakerAnchors;
  /** 上次回呼頭部座標的時間（節流） */
  const lastAnchorAtRef = useRef(0);
  /** 上次是否回報過非空 anchors（用來只在「轉為空」時清一次） */
  const hadAnchorsRef = useRef(false);

  // ─── Group transform helpers ──────────────────────────────────────────────
  const memberBase = useCallback(
    (ref: GroupMemberRef, preset: SceneConfig): { pos: Vec3; rot: Vec3 } | null => {
      if (ref.kind === 'slot') {
        const s = preset.slots?.find(x => x.id === ref.id);
        if (!s) return null;
        return { pos: s.position, rot: s.rotation ?? [0, 0, 0] };
      }
      if (ref.kind === 'staticProp') {
        const p = preset.propSystem?.staticProps?.find(x => x.id === ref.id);
        if (!p) return null;
        return { pos: p.position, rot: p.rotation ?? [0, 0, 0] };
      }
      const t = preset.propSystem?.taskProps?.[ref.id];
      if (!t) return null;
      return { pos: t.displayPos, rot: t.rotation ?? [0, 0, 0] };
    },
    [],
  );

  const resolveMemberObject = useCallback(
    (ref: GroupMemberRef): THREE.Object3D | null => {
      if (ref.kind === 'slot') {
        const identity = slotAssignmentsRef.current?.[ref.id];
        if (!identity) return null;
        const avatar = avatarsRef.current.get(identity);
        return avatar?.vrm.scene ?? null;
      }
      if (ref.kind === 'staticProp') {
        return staticPropPoolRef.current.get(ref.id) ?? null;
      }
      return taskPropPoolRef.current.get(ref.id) ?? null;
    },
    [],
  );

  const applyAllGroupTransforms = useCallback(() => {
    const preset = presetRef.current;
    const groups = preset.groups ?? [];
    const transforms = groupTransformsRef.current;
    for (const g of groups) {
      const t = transforms[g.id] ?? IDENTITY_TRANSFORM;

      let pivot: Vec3;
      if (g.pivot) {
        pivot = g.pivot;
      } else {
        const bases = g.members
          .map(m => memberBase(m, preset))
          .filter((b): b is { pos: Vec3; rot: Vec3 } => b !== null)
          .map(b => b.pos);
        pivot = computePivot(bases);
      }

      for (const m of g.members) {
        if (m.kind === 'taskProp') {
          const base = memberBase(m, preset);
          if (!base) continue;
          const finalT = applyGroupTransform(base, pivot, t);
          effectiveDisplayPosRef.current.set(m.id, finalT.pos);

          // 只有 displayed 狀態才直接寫 prop.position；held/returning 由 RAF loop 處理
          const obj = resolveMemberObject(m);
          if (!obj) continue;
          let isHeld = false;
          for (const slot of avatarsRef.current.values()) {
            if (slot.interaction.propState === 'held' && currentTaskIdRef.current === m.id) {
              isHeld = true; break;
            }
          }
          if (!isHeld) {
            obj.position.set(finalT.pos[0], finalT.pos[1], finalT.pos[2]);
            obj.rotation.set(finalT.rot[0], finalT.rot[1], finalT.rot[2]);
          }
          continue;
        }
        const base = memberBase(m, preset);
        const obj = resolveMemberObject(m);
        if (!base || !obj) {
          if (import.meta.env.DEV) {
            console.log('[groupTransform] skip', g.id, m, '(base or obj missing)');
          }
          continue;
        }
        const finalT = applyGroupTransform(base, pivot, t);
        obj.position.set(finalT.pos[0], finalT.pos[1], finalT.pos[2]);
        obj.rotation.set(finalT.rot[0], finalT.rot[1], finalT.rot[2]);
      }
    }
  }, [memberBase, resolveMemberObject]);

  // Re-apply when groupTransforms prop changes
  useEffect(() => {
    applyAllGroupTransforms();
  }, [groupTransforms, applyAllGroupTransforms]);

  // ─── Scene initialisation ─────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const preset: SceneConfig =
      SCENE_PRESETS[sceneId] ?? SCENE_PRESETS[DEFAULT_SCENE_ID];
    presetRef.current = preset;
    effectiveDisplayPosRef.current.clear();


    const scene = new THREE.Scene();
    // Background is now handled via DOM layers (BigScreen.tsx)
    sceneRef.current = scene;
    setSceneReady(true);

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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.info.autoReset = true;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    rendererRef.current = renderer;

    applyLights(scene, preset);

    // Invisible floor plane to catch VRM avatar shadows
    const shadowFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 24),
      new THREE.ShadowMaterial({ opacity: 0.35, transparent: true }),
    );
    shadowFloor.rotation.x = -Math.PI / 2;
    shadowFloor.position.y = 0;
    shadowFloor.receiveShadow = true;
    scene.add(shadowFloor);

    // Pre-load scene props (per-asset errors are swallowed inside propLoader)
    let propsCancelled = false;
    const notifyPropsReady = () => { if (!propsCancelled) onScenePropsReadyRef.current?.(); };
    if (preset.propSystem) {
      const staticP = loadStaticProps(preset.propSystem.staticProps ?? [], scene)
        .then((pool) => {
          if (propsCancelled) { disposeStaticProps(pool, scene); return; }
          staticPropPoolRef.current = pool;
        })
        .catch((err) => console.warn('[BigScreenScene] staticProps load error:', err));

      const taskP = loadTaskProps(preset.propSystem.taskProps ?? {}, scene)
        .then((pool) => {
          if (propsCancelled) { disposeTaskProps(pool, scene); return; }
          taskPropPoolRef.current = pool;
        })
        .catch((err) => console.warn('[BigScreenScene] taskProps load error:', err));

      Promise.allSettled([staticP, taskP]).then(() => {
        applyAllGroupTransforms();
        notifyPropsReady();
      });
    } else {
      notifyPropsReady();
    }

    // Render loop
    let shadowTick = 0;
    let lastRenderAt = 0;
    const animate = (timestamp: number) => {
      rafRef.current = requestAnimationFrame(animate);
      const fpsLimit = renderFpsLimitRef.current;
      if (fpsLimit > 0 && timestamp - lastRenderAt < 1000 / fpsLimit) return;
      lastRenderAt = timestamp;
      timerRef.current.update(timestamp);
      const delta = timerRef.current.getDelta();
      elapsedRef.current += delta;
      // Update shadow map every 2 frames to halve shadow rendering cost
      renderer.shadowMap.needsUpdate = (shadowTick++ % 2 === 0);

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
            ia.grabFistFirstAt = 0;
            ia.grabCooldownUntil = 0;
            ia.lastTaskId = taskId;
          }

          // ── Cross-task returning: runs BEFORE the prop-guard so the old prop
          //    always lerps home even when the new task has no prop yet. ────────
          if (ia.propState === 'returning' && ia.returningTaskId) {
            const returningProp = taskPropPoolRef.current.get(ia.returningTaskId);
            const dpCfg = presetRef.current.propSystem?.taskProps?.[ia.returningTaskId]?.displayPos;
            const effective = effectiveDisplayPosRef.current.get(ia.returningTaskId);
            const dp = effective ?? dpCfg;
            if (returningProp && dp) {
              _displayPosVec.set(...dp);
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
            const heldBy = heldByIdentityRef.current.get(taskId);
            const isHolderActive = heldBy ? avatarsRef.current.has(heldBy) : false;

            // Self-heal if the holder left the room without dropping the prop
            if (heldBy && !isHolderActive) {
              heldByIdentityRef.current.delete(taskId);
              // Snap orphaned prop back to display pos
              const dpCfg = presetRef.current.propSystem?.taskProps?.[taskId]?.displayPos;
              const effective = effectiveDisplayPosRef.current.get(taskId);
              const dp = effective ?? dpCfg;
              if (dp) _displayPosVec.set(...dp), prop.position.copy(_displayPosVec);
            }

            // console.log(heldBy);
            // console.log(isHolderActive);

            if (!heldBy || !isHolderActive) {
              highlightProp(prop, true, elapsedRef.current);
            }

            let grabbedThisFrame = false;
            let fistDetectedThisFrame = false;
            if (cameraRef.current) {
              projectToUV(prop.position, cameraRef.current, slot._propUV);

              for (const hand of ['right', 'left'] as const) {
                const hLandmarks = hand === 'right' ? rightHand : leftHand;
                if (!hLandmarks || hLandmarks.length < 21) continue;
                if (!pose || pose.length < 25) continue;
                // Prevent a second slot from grabbing a prop already held
                if (heldByIdentityRef.current.has(taskId)) continue;

                const wristUV = { x: hLandmarks[0].x, y: hLandmarks[0].y };
                const fist = detectFist(hLandmarks);
                const raised = isHandRaised(pose, hand);
                const near = isHandNearProp(wristUV, slot._propUV);

                if (fist && (raised || near)) {
                  fistDetectedThisFrame = true;
                  const now = performance.now();
                  if (ia.grabFistFirstAt === 0) ia.grabFistFirstAt = now;
                  if (now - ia.grabFistFirstAt >= GRAB_CONFIRM_MS) {
                    ia.propState = 'held';
                    ia.lockHand = hand;
                    ia.handLostAt = 0;
                    ia.grabFistFirstAt = 0;
                    ia.grabCooldownUntil = now + GRAB_RELEASE_COOLDOWN_MS;
                    heldByIdentityRef.current.set(taskId, identity);
                    highlightProp(prop, false);
                    grabbedThisFrame = true;
                  }
                  break; // counting toward one hand at a time
                }
              }
            }
            // Reset timer when fist breaks — must be held continuously for GRAB_CONFIRM_MS.
            if (!fistDetectedThisFrame && !grabbedThisFrame) {
              ia.grabFistFirstAt = 0;
            }

            // ── held: follow hand bone, detect release ─────────────────────────
          } else if (ia.propState === 'held' && ia.lockHand) {
            const hLandmarks = ia.lockHand === 'right' ? rightHand : leftHand;
            const now = performance.now();
            const inCooldown = now < ia.grabCooldownUntil;

            // 剛抓取時 (inCooldown) held=false 以產生平滑飛向手部的 lerp 動畫
            attachPropToHand(prop, slot.vrm, ia.lockHand, !inCooldown);

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
            const effective = effectiveDisplayPosRef.current.get(taskId);
            const dp = effective ?? dpCfg;
            if (dp) {
              _displayPosVec.set(...dp);
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

      // ── 說話中 avatar 頭上標記投影（節流 ~100ms）───────────────────────
      {
        const cb = onSpeakerAnchorsRef.current;
        const cam = cameraRef.current;
        if (cb && cam && timestamp - lastAnchorAtRef.current >= 100) {
          lastAnchorAtRef.current = timestamp;
          const speaking = speakingIdentitiesRef.current;
          if (speaking.length === 0) {
            if (hadAnchorsRef.current) {
              hadAnchorsRef.current = false;
              cb({});
            }
          } else {
            const anchors: Record<string, { x: number; y: number }> = {};
            let any = false;
            for (const id of speaking) {
              if (id.startsWith('__placeholder__:')) continue;
              const slot = avatarsRef.current.get(id);
              if (!slot) continue;
              const head = slot.vrm.humanoid?.getNormalizedBoneNode('head');
              if (!head) continue;
              head.getWorldPosition(_headWorld);
              _headWorld.y += 0.44; // 抬到頭頂上方
              projectToUV(_headWorld, cam, _headUV);
              anchors[id] = { x: _headUV.x, y: _headUV.y };
              any = true;
            }
            if (!any) {
              if (hadAnchorsRef.current) { hadAnchorsRef.current = false; cb({}); }
            } else {
              hadAnchorsRef.current = true;
              cb(anchors);
            }
          }
        }
      }

      // Lower pixel ratio to 1 during recording — composite canvas already caps at 1080p,
      // so rendering at DPR 2 (Retina) wastes GPU work that the recording never sees.
      const rec = isRecordingRef.current;
      if (rec !== prevRecordingRef.current) {
        prevRecordingRef.current = rec;
        renderer.setPixelRatio(rec ? 1 : originalDprRef.current);
      }

      // Drive composite canvas from inside this loop instead of a second RAF.
      onPostRenderRef?.current?.(timestamp);

      const cb = onStatsRef.current;
      if (cb) {
        const api = avgPoseIntervalsRef.current;
        // Remove keys for identities that have left
        for (const k of Object.keys(api)) {
          if (!avatarsRef.current.has(k)) delete api[k];
        }
        // Update existing / add new
        for (const [id, s] of avatarsRef.current) {
          api[id] = s.avgPoseIntervalMs;
        }
        cb({
          frameMs: delta * 1000,
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
          avatarCount: avatarsRef.current.size,
          avgPoseIntervals: api,
        });
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
      disposeStaticProps(staticPropPoolRef.current, scene);
      disposeTaskProps(taskPropPoolRef.current, scene);
      // 釋放所有遮罩物件
      for (const group of occluderPoolRef.current.values()) {
        disposeOccluder(group, scene);
      }
      occluderPoolRef.current.clear();
      occluderLibIdsRef.current.clear();
      occluderLoadingRef.current.clear();
      // Placeholder identities already removed by the avatarsRef.current loop above;
      // just clear the tracking set so the placeholder effect doesn't try to re-remove.
      placeholderIdentitiesRef.current.clear();
      heldByIdentityRef.current.clear();
      avgPoseIntervalsRef.current = {};
      scene.remove(shadowFloor);
      (shadowFloor.material as THREE.Material).dispose();
      shadowFloor.geometry.dispose();
      renderer.dispose();
      sceneRef.current = null;
      setSceneReady(false);
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
        applyAllGroupTransforms();
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
          // Fully dispose the orphaned VRM so rapid switching doesn't leak GPU
          // memory (geometries/textures/spring bones) for every superseded load.
          if (loadGenRef.current.get(identity) !== gen) {
            scene.remove(vrm.scene);
            VRMUtils.deepDispose(vrm.scene);
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
              grabFistFirstAt: 0,
              grabCooldownUntil: 0,
            },
            _propUV: { x: 0, y: 0 },
          };
          avatarsRef.current.set(identity, slot);
          loadingRef.current.delete(identity);
          if (!isSlotPinned) reposition();
          applyAllGroupTransforms();
          return slot;
        })
        .catch((err) => {
          // Only clear the in-flight entry if THIS load is still the current
          // generation. A stale/superseded load must NOT delete the map entry,
          // because a newer ensureAvatar() call already registered its own
          // promise there. Deleting it would make pose frames see no in-flight
          // load, spawn yet another load, bump the generation, and invalidate
          // the previous one — an endless load/discard churn that leaves the
          // model perpetually "incompletely loaded" after rapid switching.
          if (loadGenRef.current.get(identity) === gen) {
            loadingRef.current.delete(identity);
          }
          throw err;
        });

      loadingRef.current.set(identity, loadPromise);
      return loadPromise;
    },
    [reposition, vrmSourceId, applyAllGroupTransforms],
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
        VRMUtils.deepDispose(slot.vrm.scene);
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

        // In slotted scenes, only load avatars for assigned participants.
        // Skip the guard if this identity is already tracked (avatar loaded or
        // load in-flight). This handles the race where slot-assign triggers
        // ensureAvatar synchronously but the slotAssignments React prop hasn't
        // re-rendered yet, which would cause every pose frame to early-return
        // and leave the freshly-loaded VRM permanently in T-pose.
        let slotSpawn: AvatarSpawnConfig | undefined;
        if (preset.slots && preset.slots.length > 0) {
          const alreadyTracked = avatarsRef.current.has(identity) || loadingRef.current.has(identity);
          if (!alreadyTracked) {
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
      VRMUtils.deepDispose(slot.vrm.scene);
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
