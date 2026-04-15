# Scene Props System — Phase 1 Design Spec

**Date:** 2026-04-14
**Branch:** feature/scene-slot-assignment
**Scope:** Phase 1 — Static scene props + task prop registry (pre-loaded, all visible)

---

## Overview

Extend `frontend/src/config/scenes.ts` and the BigScreen rendering system to support:

1. **Static scene props** (`staticProps`) — always-visible GLB objects loaded with the scene (e.g., cashier counter, clothing rack)
2. **Task prop registry** (`taskProps`) — all task-associated GLB objects pre-loaded at scene load, all initially visible, positioned at fixed world-space coordinates

Phase 2 (hand-tracking interaction, trigger zones, object-follows-hand) is out of scope and addressed in a separate spec.

---

## Architecture

### Data Flow

```
scenes.ts (SceneVariant.propSystem)
  → buildScenePresets() spreads propSystem into SceneConfig
  → useBigScreenScene receives sceneId + currentTaskId
  → on scene load: GLTFLoader pre-loads all staticProps + taskProps
  → staticProps: always visible
  → taskProps: all visible (placed at displayPos), currentTaskId tracked for Phase 2
```

### Task Prop Visibility

All task props are pre-loaded and `visible = true` at scene load — the full item display is visible simultaneously (like merchandise on a clothing store floor). The `policy` field is reserved in the type system for Phase 2 differentiated behaviour.

---

## Type Changes — `frontend/src/types/vrm.ts`

Add three new interfaces:

```ts
/** Static scene prop: always visible when scene is loaded */
export interface PropConfig {
  id: string;
  url: string;                                    // GLB path e.g. '/models/cashier_counter.glb'
  position: [x: number, y: number, z: number];
  rotation?: [x: number, y: number, z: number];  // Euler radians
  scale?: number;                                 // uniform scale, default 1.0
}

/** Task-associated prop: loaded at scene start, positioned at world-space coords */
export interface TaskPropConfig {
  url: string;
  displayPos: [x: number, y: number, z: number];
  rotation?: [x: number, y: number, z: number];
  scale?: number;
}

/** Prop system config attached to a scene */
export interface ScenePropSystem {
  /** Visibility policy for task props — reserved for Phase 2. Default: 'auto-swap' */
  policy?: 'auto-swap' | 'accumulate' | 'manual';
  /** Always-visible props loaded with the scene */
  staticProps?: PropConfig[];
  /** Task prop registry: task ID → prop config (all pre-loaded and visible) */
  taskProps?: Record<string, TaskPropConfig>;
}
```

Add `propSystem?: ScenePropSystem` to both `SceneConfig` and `SceneVariant`.

---

## Config Changes — `frontend/src/config/scenes.ts`

### SceneVariant authoring example (clothingStore_cashier)

```ts
propSystem: {
  policy: 'auto-swap',
  staticProps: [
    {
      id: 'cashier_counter',
      url: '/models/cashier_counter.glb',
      position: [0, 0, -2],
      scale: 1.0,
    },
  ],
  taskProps: {
    'ask_price_1': { url: '/models/blue_tshirt.glb',   displayPos: [0.5, 1.2, -1.5] },
    'ask_price_2': { url: '/models/black_jacket.glb',  displayPos: [0.5, 1.2, -1.5] },
    'ask_price_3': { url: '/models/red_skirt.glb',     displayPos: [0.5, 1.2, -1.5] },
    // Tasks without a prop entry: no prop appears (no entry needed)
  },
},
```

### buildScenePresets() change

Add one line to propagate `propSystem` from `SceneVariant` into `SceneConfig`:

```ts
presets[variant.id] = {
  ...base,
  id: variant.id,
  label: `${theme.label} · ${variant.label}`,
  slots: variant.slots,
  allowedVrmIds: variant.allowedVrmIds,
  modules: variant.modules,
  propSystem: variant.propSystem,   // ← add
};
```

---

## Rendering Changes — `frontend/src/hooks/useBigScreenScene.ts`

### New parameters

```ts
interface UseBigScreenSceneOptions {
  sceneId: string;
  vrmSourceId?: string;
  slotAssignments?: ...;
  currentTaskId?: string;   // ← new: derived from activeTasks in BigScreen
}
```

### New refs

```ts
const staticPropGroupsRef = useRef<THREE.Group[]>([]);
const taskPropPoolRef     = useRef<Map<string, THREE.Group>>(new Map());
```

### Scene load — prop loading

When `sceneId` changes, after the existing scene setup:

```ts
async function loadProps(propSystem: ScenePropSystem | undefined, scene: THREE.Scene) {
  if (!propSystem) return;

  // Static props — always visible
  for (const cfg of propSystem.staticProps ?? []) {
    const gltf = await gltfLoader.loadAsync(cfg.url);
    const group = gltf.scene;
    group.position.set(...cfg.position);
    if (cfg.rotation) group.rotation.set(...cfg.rotation);
    if (cfg.scale)    group.scale.setScalar(cfg.scale);
    scene.add(group);
    staticPropGroupsRef.current.push(group);
  }

  // Task props — pre-load all, all visible
  for (const [taskId, cfg] of Object.entries(propSystem.taskProps ?? {})) {
    const gltf = await gltfLoader.loadAsync(cfg.url);
    const group = gltf.scene;
    group.position.set(...cfg.displayPos);
    if (cfg.rotation) group.rotation.set(...cfg.rotation);
    if (cfg.scale)    group.scale.setScalar(cfg.scale);
    group.visible = true;
    scene.add(group);
    taskPropPoolRef.current.set(taskId, group);
  }
}
```

### Scene teardown — prop dispose

When scene changes, dispose all loaded prop objects before reloading:

```ts
function disposeProps(scene: THREE.Scene) {
  for (const group of staticPropGroupsRef.current) {
    scene.remove(group);
    group.traverse(obj => {
      if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
      if ((obj as THREE.Mesh).material) {
        const mats = Array.isArray((obj as THREE.Mesh).material)
          ? (obj as THREE.Mesh).material : [(obj as THREE.Mesh).material];
        for (const m of mats) m.dispose();
      }
    });
  }
  staticPropGroupsRef.current = [];

  for (const group of taskPropPoolRef.current.values()) {
    scene.remove(group);
    // same traverse dispose as above
  }
  taskPropPoolRef.current.clear();
}
```

### currentTaskId — Phase 2 hook point

`currentTaskId` is stored in a ref for Phase 2 interaction triggers. No visibility toggle in Phase 1.

```ts
const currentTaskIdRef = useRef<string | undefined>(currentTaskId);
useEffect(() => { currentTaskIdRef.current = currentTaskId; }, [currentTaskId]);
```

---

## BigScreen changes — `frontend/src/components/BigScreen.tsx`

Derive `currentTaskId` and pass to `useBigScreenScene`:

```ts
const currentTaskId = activeTasks.find(t => !t.completed)?.id;

const { applyPose, removeAvatar, swapAvatar, setVrmOverride, ensureAvatar } =
  useBigScreenScene(canvasRef, { sceneId, vrmSourceId, slotAssignments, currentTaskId });
```

---

## GLB Asset Conventions

- Path: `frontend/public/models/<name>.glb`
- Served at: `/models/<name>.glb`
- Naming: lowercase, underscore-separated (e.g. `blue_tshirt.glb`, `cashier_counter.glb`)
- No GLB files are committed until the art assets are ready; scenes.ts entries with missing GLB paths are silently skipped (loader error caught per-asset)

---

## Out of Scope (Phase 2)

- Hand landmark parsing
- Trigger zones / proximity detection
- Object-follows-hand bone attachment
- BigScreen sync for grabbed objects
- Fade in/out transitions between task props
