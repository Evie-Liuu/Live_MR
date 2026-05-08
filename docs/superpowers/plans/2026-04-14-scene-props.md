# Scene Props System — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pre-load static and task-associated GLB props into the BigScreen Three.js scene, all visible from scene load, with `currentTaskId` tracked for future Phase 2 interaction.

**Architecture:** New types flow from `types/vrm.ts` → `scenes.ts` config authoring → `useBigScreenScene.ts` rendering. A new `propLoader.ts` utility handles GLB loading. BigScreen derives `currentTaskId` from `activeTasks` and passes it to the hook.

**Tech Stack:** Three.js `GLTFLoader` (already in project via `vrmLoader.ts`), React refs for prop pool management.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `frontend/src/types/vrm.ts` | Add `PropConfig`, `TaskPropConfig`, `ScenePropSystem`; extend `SceneConfig` + `SceneVariant` |
| Modify | `frontend/src/config/scenes.ts` | Pass `propSystem` through `buildScenePresets()`; add example entries |
| Create | `frontend/src/utils/propLoader.ts` | GLB load + dispose utility |
| Modify | `frontend/src/hooks/useBigScreenScene.ts` | Pre-load props on scene init, dispose on teardown, track `currentTaskId` |
| Modify | `frontend/src/components/BigScreen.tsx` | Derive `currentTaskId`, pass to hook |

---

## Task 1: Type definitions

**Files:**
- Modify: `frontend/src/types/vrm.ts`

- [ ] **Step 1: Add new interfaces after the `SceneModule` block (line 101)**

Open `frontend/src/types/vrm.ts`. After the closing `}` of `SceneModule` (line 101), insert:

```ts
/** Static scene prop: always visible when the scene is loaded */
export interface PropConfig {
  id: string;
  url: string;                                    // GLB path e.g. '/models/cashier_counter.glb'
  position: [x: number, y: number, z: number];
  rotation?: [x: number, y: number, z: number];  // Euler radians
  scale?: number;                                 // uniform scale, default 1.0
}

/** Task-associated prop: pre-loaded at scene start, placed at world-space coords */
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
  /** Task prop registry: task ID → prop config (all pre-loaded, all visible) */
  taskProps?: Record<string, TaskPropConfig>;
}
```

- [ ] **Step 2: Add `propSystem` to `SceneConfig`**

In `SceneConfig` (around line 82, after `modules?: SceneModule[]`), add:

```ts
  /** Scene prop system: static props + task prop registry */
  propSystem?: ScenePropSystem;
```

- [ ] **Step 3: Add `propSystem` to `SceneVariant`**

In `SceneVariant` (around line 113, after `modules?: SceneModule[]`), add:

```ts
  /** Scene prop system: static props + task prop registry */
  propSystem?: ScenePropSystem;
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors related to the new types.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/vrm.ts
git commit -m "feat: add PropConfig, TaskPropConfig, ScenePropSystem types"
```

---

## Task 2: Config plumbing

**Files:**
- Modify: `frontend/src/config/scenes.ts`

- [ ] **Step 1: Pass `propSystem` through `buildScenePresets()`**

In `buildScenePresets()` (around line 235), update the preset assignment to include `propSystem`:

```ts
presets[variant.id] = {
  ...base,
  id: variant.id,
  label: `${theme.label} · ${variant.label}`,
  slots: variant.slots,
  allowedVrmIds: variant.allowedVrmIds,
  modules: variant.modules,
  propSystem: variant.propSystem,
};
```

- [ ] **Step 2: Add example `propSystem` to `clothingStore_cashier` scene**

In the `clothingStore_cashier` scene variant object (after `modules: [...]`), add:

```ts
propSystem: {
  policy: 'auto-swap',
  staticProps: [
    // Placeholder — replace url with actual GLB path when asset is ready
    // { id: 'cashier_counter', url: '/models/cashier_counter.glb', position: [0, 0, -2], scale: 1.0 },
  ],
  taskProps: {
    // Placeholder entries — replace urls with actual GLB paths when assets are ready
    // 'ask_price_1': { url: '/models/blue_tshirt.glb',  displayPos: [0.5, 1.2, -1.5] },
    // 'ask_price_2': { url: '/models/black_jacket.glb', displayPos: [0.5, 1.2, -1.5] },
    // 'ask_price_3': { url: '/models/red_skirt.glb',    displayPos: [0.5, 1.2, -1.5] },
  },
},
```

(All entries commented out until actual GLB assets exist. The system silently skips missing files.)

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/config/scenes.ts
git commit -m "feat: wire propSystem through buildScenePresets, add placeholder entries"
```

---

## Task 3: GLB prop loader utility

**Files:**
- Create: `frontend/src/utils/propLoader.ts`

- [ ] **Step 1: Create the file**

Create `frontend/src/utils/propLoader.ts` with the following content:

```ts
/**
 * propLoader.ts
 *
 * Loads a plain GLB model (non-VRM) into a Three.js scene.
 * Returns the root Group and a dispose function that removes it from the scene
 * and frees GPU resources.
 *
 * Errors (e.g. missing file) are caught per-asset and logged; they do not
 * propagate so a missing GLB never breaks the scene setup.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { PropConfig, TaskPropConfig } from '../types/vrm';

const loader = new GLTFLoader();

export interface LoadedProp {
  group: THREE.Group;
  dispose: () => void;
}

/** Load a plain GLB and add it to the scene. Resolves to null on error. */
async function loadGlb(
  url: string,
  scene: THREE.Scene,
): Promise<THREE.Group | null> {
  try {
    const gltf = await loader.loadAsync(url);
    scene.add(gltf.scene);
    return gltf.scene;
  } catch (err) {
    console.warn(`[PropLoader] Failed to load "${url}":`, err);
    return null;
  }
}

function disposeGroup(group: THREE.Group, scene: THREE.Scene): void {
  scene.remove(group);
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) (m as THREE.Material).dispose();
    }
  });
}

/** Load all static props for a scene. Returns loaded groups (nulls filtered out). */
export async function loadStaticProps(
  staticProps: PropConfig[],
  scene: THREE.Scene,
): Promise<THREE.Group[]> {
  const results = await Promise.all(
    staticProps.map(async (cfg) => {
      const group = await loadGlb(cfg.url, scene);
      if (!group) return null;
      group.position.set(...cfg.position);
      if (cfg.rotation) group.rotation.set(...cfg.rotation);
      if (cfg.scale != null) group.scale.setScalar(cfg.scale);
      return group;
    }),
  );
  return results.filter((g): g is THREE.Group => g !== null);
}

/** Load all task props for a scene. Returns a map of taskId → Group (missing assets excluded). */
export async function loadTaskProps(
  taskProps: Record<string, TaskPropConfig>,
  scene: THREE.Scene,
): Promise<Map<string, THREE.Group>> {
  const pool = new Map<string, THREE.Group>();
  await Promise.all(
    Object.entries(taskProps).map(async ([taskId, cfg]) => {
      const group = await loadGlb(cfg.url, scene);
      if (!group) return;
      group.position.set(...cfg.displayPos);
      if (cfg.rotation) group.rotation.set(...cfg.rotation);
      if (cfg.scale != null) group.scale.setScalar(cfg.scale);
      group.visible = true;
      pool.set(taskId, group);
    }),
  );
  return pool;
}

/** Dispose a list of static prop groups. */
export function disposeStaticProps(groups: THREE.Group[], scene: THREE.Scene): void {
  for (const group of groups) disposeGroup(group, scene);
}

/** Dispose all groups in a task prop pool. */
export function disposeTaskProps(pool: Map<string, THREE.Group>, scene: THREE.Scene): void {
  for (const group of pool.values()) disposeGroup(group, scene);
  pool.clear();
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/utils/propLoader.ts
git commit -m "feat: add propLoader utility for GLB static and task props"
```

---

## Task 4: useBigScreenScene prop integration

**Files:**
- Modify: `frontend/src/hooks/useBigScreenScene.ts`

- [ ] **Step 1: Add `currentTaskId` to `UseBigScreenSceneOptions`**

Find the `UseBigScreenSceneOptions` interface (around line 61) and add one field:

```ts
interface UseBigScreenSceneOptions {
  sceneId?: string;
  vrmSourceId?: string;
  slotAssignments?: Record<string, string>;
  /** Currently active task ID — tracked for Phase 2 interaction triggers */
  currentTaskId?: string;
}
```

- [ ] **Step 2: Import the prop loader functions**

At the top of the file, add the import after existing imports:

```ts
import {
  loadStaticProps,
  loadTaskProps,
  disposeStaticProps,
  disposeTaskProps,
} from '../utils/propLoader';
```

- [ ] **Step 3: Add prop refs inside the hook body**

After the existing `spawnOverridesRef` declaration (around line 112), add:

```ts
const staticPropGroupsRef = useRef<THREE.Group[]>([]);
const taskPropPoolRef     = useRef<Map<string, THREE.Group>>(new Map());
/** Tracks the active task ID for Phase 2 interaction use */
const currentTaskIdRef    = useRef<string | undefined>(undefined);
```

- [ ] **Step 4: Destructure `currentTaskId` from options**

On the line where options are destructured (around line 74), add `currentTaskId`:

```ts
const {
  sceneId = DEFAULT_SCENE_ID,
  vrmSourceId = DEFAULT_VRM_SOURCE_ID,
  slotAssignments,
  currentTaskId,
} = options;
```

- [ ] **Step 5: Sync `currentTaskId` to ref via useEffect**

After the existing `slotAssignmentsRef.current = slotAssignments ?? {};` line (around line 107), add:

```ts
currentTaskIdRef.current = currentTaskId;
```

- [ ] **Step 6: Load props after scene setup in the scene init `useEffect`**

In the scene initialisation `useEffect` (around line 115), after `applyGrid(scene, preset);` and before the render loop setup, add:

```ts
// Load scene props (errors per-asset are swallowed inside the loader)
if (preset.propSystem) {
  loadStaticProps(preset.propSystem.staticProps ?? [], scene)
    .then((groups) => { staticPropGroupsRef.current = groups; })
    .catch((err) => console.warn('[BigScreenScene] staticProps load error:', err));

  loadTaskProps(preset.propSystem.taskProps ?? {}, scene)
    .then((pool) => { taskPropPoolRef.current = pool; })
    .catch((err) => console.warn('[BigScreenScene] taskProps load error:', err));
}
```

- [ ] **Step 7: Dispose props in the scene teardown `return` function**

Inside the cleanup `return () => { ... }` of the same `useEffect` (around line 200), add before `renderer.dispose()`:

```ts
disposeStaticProps(staticPropGroupsRef.current, scene);
staticPropGroupsRef.current = [];
disposeTaskProps(taskPropPoolRef.current, scene);
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/hooks/useBigScreenScene.ts
git commit -m "feat: pre-load scene props in useBigScreenScene, dispose on teardown"
```

---

## Task 5: BigScreen currentTaskId wiring

**Files:**
- Modify: `frontend/src/components/BigScreen.tsx`

- [ ] **Step 1: Derive `currentTaskId` from `activeTasks`**

In `BigScreen.tsx`, find the line where `activeTasks` is used (around line 127):

```ts
const { applyPose, removeAvatar, swapAvatar, setVrmOverride, ensureAvatar } = useBigScreenScene(canvasRef, { sceneId, vrmSourceId, slotAssignments });
```

Replace with:

```ts
const currentTaskId = activeTasks.find(t => !t.completed)?.id;
const { applyPose, removeAvatar, swapAvatar, setVrmOverride, ensureAvatar } = useBigScreenScene(canvasRef, { sceneId, vrmSourceId, slotAssignments, currentTaskId });
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Smoke test in browser**

1. Start the dev server: `cd frontend && npm run dev`
2. Open HostSession, open BigScreen in a second window
3. Switch scenes — BigScreen scene changes with no console errors
4. Advance tasks — no errors logged for task-change messages
5. Confirm existing avatar/pose functionality is unaffected

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/BigScreen.tsx
git commit -m "feat: pass currentTaskId to useBigScreenScene for prop system wiring"
```

---

## Task 6: Activate first real prop (when asset is ready)

This task is done once actual GLB files are placed in `frontend/public/models/`.

**Files:**
- Modify: `frontend/src/config/scenes.ts`

- [ ] **Step 1: Uncomment and fill a prop entry**

For each GLB placed in `frontend/public/models/`, uncomment the corresponding entry in `clothingStore_cashier.propSystem`. Example for a static counter:

```ts
staticProps: [
  { id: 'cashier_counter', url: '/models/cashier_counter.glb', position: [0, 0, -2], scale: 1.0 },
],
```

Example for a task prop:

```ts
taskProps: {
  'ask_price_1': { url: '/models/blue_tshirt.glb', displayPos: [0.5, 1.2, -1.5] },
},
```

- [ ] **Step 2: Verify in browser**

Open BigScreen, switch to `clothingStore_cashier` scene, confirm model appears at the defined position.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/config/scenes.ts
git commit -m "feat: activate <model name> prop in clothingStore_cashier scene"
```
