# 場景遮罩物件編輯器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在教師控制台新增「場景物件」drawer，讓老師從預製 GLB 物件庫加入遮罩物件至當前場景、調整位置/旋轉/縮放後即時呈現在大屏，以遮蔽 camera 背景中的真實物品。

**Architecture:** 物件庫是 static config (`OCCLUDER_LIBRARY`)；使用者加入的實例 (`SceneOccluderInstance[]`) 以 `Record<sceneId, instances[]>` 存 localStorage。HostSession 持有 state、broadcast 單一 `'occluders-set'` 訊息給 BigScreen；BigScreen 從 localStorage 啟動還原，並把陣列透過 `useBigScreenScene` 新 option 傳給 hook；hook 用 `Map<instanceId, THREE.Group>` 做 diff（新加 → 載入；移除 → dispose；保留 → 更新 transform）。

**Tech Stack:** React 19 + TypeScript + Three.js (`GLTFLoader`) + Vite。專案無自動化測試 framework — 每個 task 結尾以 `npx tsc -b --noEmit` + `npm run lint` + 手動瀏覽器驗證取代自動化測試。所有指令在 `frontend/` 目錄執行。

設計文件：`docs/superpowers/specs/2026-05-31-scene-occluder-objects-design.md`

---

## File Structure

**Create (4):**
- `frontend/src/types/sceneOccluder.ts` — `SceneOccluderInstance` 型別
- `frontend/src/config/sceneOccluders.ts` — `OccluderLibraryItem` 型別 + 空的 `OCCLUDER_LIBRARY` 陣列 + 查表 helper
- `frontend/src/utils/occluderLoader.ts` — 純 `GLTFLoader` 載入/dispose helper（非 VRM）
- `frontend/src/components/SceneOccludersPanel.tsx` — drawer UI 元件（受控元件）

**Modify (3):**
- `frontend/src/hooks/useBigScreenScene.ts` — 新 `occluderInstances?` option；instanceId-keyed diff/load/update/dispose
- `frontend/src/components/BigScreen.tsx` — `BigScreenMsg` 加 `'occluders-set'`；state；message handler；從 localStorage 還原；傳入 hook
- `frontend/src/components/HostSession.tsx` — 加 `🪴 場景物件` sidebar card + drawer 渲染；state；localStorage 寫入；廣播；場景切換時重載

**Total**: 4 new files, 3 modified files.

---

## Task 1: 加入型別與物件庫 config

**Files:**
- Create: `frontend/src/types/sceneOccluder.ts`
- Create: `frontend/src/config/sceneOccluders.ts`

- [ ] **Step 1: 建立 `frontend/src/types/sceneOccluder.ts`**

```ts
/**
 * 使用者透過 SceneOccludersPanel 加入的場景遮罩物件實例。
 * 以 instanceId 為 key（每次加入由 crypto.randomUUID() 產生）。
 * libraryId 指向 OCCLUDER_LIBRARY[].id。
 */
export interface SceneOccluderInstance {
  instanceId: string
  libraryId: string
  position: [number, number, number]
  rotation: [number, number, number] // radian
  scale: number                       // uniform scale
}
```

- [ ] **Step 2: 建立 `frontend/src/config/sceneOccluders.ts`**

```ts
/**
 * 場景遮罩物件庫：開發者預先放 GLB 到 public/models/occluders/，
 * 在這裡登錄 id / label / glbUrl / defaultScale。
 * OCCLUDER_LIBRARY 初始為空陣列；之後逐步加入。
 */
export interface OccluderLibraryItem {
  id: string
  label: string
  glbUrl: string
  /** 預設 uniform scale；未設則為 1 */
  defaultScale?: number
}

export const OCCLUDER_LIBRARY: OccluderLibraryItem[] = []

/** 根據 id 查表；找不到回 undefined（呼叫端負責處理失效情況）。 */
export function getOccluderLibraryItem(id: string): OccluderLibraryItem | undefined {
  return OCCLUDER_LIBRARY.find(item => item.id === id)
}
```

- [ ] **Step 3: 型別檢查**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: PASS（型別檔無使用方時 TS 不會報未使用 export）。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/sceneOccluder.ts frontend/src/config/sceneOccluders.ts
git commit -m "feat: 場景遮罩物件型別與物件庫 config"
```

---

## Task 2: GLB 載入/dispose helper

**Files:**
- Create: `frontend/src/utils/occluderLoader.ts`

- [ ] **Step 1: 建立 `frontend/src/utils/occluderLoader.ts`**

複製 `propLoader.ts` 的 loadGlb / dispose 樣式，封裝成單一 load + dispose 對：

```ts
/**
 * occluderLoader.ts
 *
 * 為「使用者加入的遮罩物件」載入非 VRM 的 GLB。與 propLoader 不同的是：
 * - 不批次（一次一個 instance 載入）
 * - 載入失敗回 null，呼叫端決定是否刪除實例（仍可從清單操作）
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const loader = new GLTFLoader()

/** 載入一個 GLB 並加入 scene。失敗回 null。 */
export async function loadOccluder(
  url: string,
  scene: THREE.Scene,
): Promise<THREE.Group | null> {
  try {
    const gltf = await loader.loadAsync(url)
    gltf.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    })
    scene.add(gltf.scene)
    return gltf.scene
  } catch (err) {
    console.warn(`[occluderLoader] Failed to load "${url}":`, err)
    return null
  }
}

/** Dispose 整個 group（包含 geometry/material）並從 scene 移除。 */
export function disposeOccluder(group: THREE.Group, scene: THREE.Scene): void {
  scene.remove(group)
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) (m as THREE.Material).dispose()
    }
  })
}
```

- [ ] **Step 2: 型別檢查**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/utils/occluderLoader.ts
git commit -m "feat: occluderLoader 載入/dispose helper"
```

---

## Task 3: useBigScreenScene 維護 occluder 實例

**Files:**
- Modify: `frontend/src/hooks/useBigScreenScene.ts`

設計：hook 新增 `occluderInstances?: SceneOccluderInstance[]` option。維護一個 `Map<instanceId, THREE.Group>`（`occluderPoolRef`）；當 option 變動時呼叫 `syncOccluders()`：
- 新加 instanceId（in array but not in pool）→ async load + 加進 map + 套用 transform；用 in-flight set 避免重複 load
- 移除 instanceId（in pool but not in array）→ dispose
- 保留 instanceId（兩邊都有）→ 比對 transform，有變化才更新

unmount / sceneId 改變時 dispose 全部。

- [ ] **Step 1: 加入 import 與 useEffect 依賴所需**

打開 `frontend/src/hooks/useBigScreenScene.ts`。在現有的 import 區塊（檔案頂端的 import 群）加入：

```ts
import { loadOccluder, disposeOccluder } from '../utils/occluderLoader'
import { getOccluderLibraryItem } from '../config/sceneOccluders'
import type { SceneOccluderInstance } from '../types/sceneOccluder'
```

放置位置：跟 `import { loadStaticProps, ... } from '../utils/propLoader'` 同一群即可。

- [ ] **Step 2: 在 `UseBigScreenSceneOptions` interface 加入新欄位**

在 `UseBigScreenSceneOptions` 末尾（既有 `onSpeakerAnchors?` 或 `groupTransforms?` 之後、`}` 之前）加：

```ts
  /** 老師加入的遮罩物件實例清單（per-scene）。變動時 hook 會 diff 後同步 THREE 場景。 */
  occluderInstances?: SceneOccluderInstance[]
```

- [ ] **Step 3: 解構新 option**

把現有的解構行（`const { sceneId = DEFAULT_SCENE_ID, ..., onSpeakerAnchors } = options;`）末尾追加 `, occluderInstances`。

- [ ] **Step 4: 加入 refs + in-flight 追蹤**

在 hook body 內（與其他 `useRef` 一起，例如 `groupTransformsRef` 附近）加：

```ts
  /** instanceId → loaded THREE.Group */
  const occluderPoolRef = useRef<Map<string, THREE.Group>>(new Map())
  /** instanceId → loading promise，避免重複載入 */
  const occluderLoadingRef = useRef<Map<string, Promise<THREE.Group | null>>>(new Map())
```

- [ ] **Step 5: 加入 sync 函式**

在 hook body 的 callbacks 區塊（例如 `reposition` / `ensureAvatar` 附近）加：

```ts
  const syncOccluders = useCallback(async (next: SceneOccluderInstance[]) => {
    const scene = sceneRef.current
    if (!scene) return

    const nextById = new Map(next.map(o => [o.instanceId, o]))
    const pool = occluderPoolRef.current
    const loading = occluderLoadingRef.current

    // ── Remove instances no longer present ──
    for (const [id, group] of Array.from(pool.entries())) {
      if (!nextById.has(id)) {
        disposeOccluder(group, scene)
        pool.delete(id)
      }
    }
    // 取消已不需要的進行中載入
    for (const id of Array.from(loading.keys())) {
      if (!nextById.has(id)) loading.delete(id)
    }

    // ── Add / update ──
    for (const inst of next) {
      const existing = pool.get(inst.instanceId)
      if (existing) {
        existing.position.set(...inst.position)
        existing.rotation.set(...inst.rotation)
        existing.scale.setScalar(inst.scale)
        continue
      }
      if (loading.has(inst.instanceId)) continue // 已在載入

      const libItem = getOccluderLibraryItem(inst.libraryId)
      if (!libItem) {
        console.warn(`[useBigScreenScene] occluder libraryId not found: ${inst.libraryId}`)
        continue
      }

      const p = loadOccluder(libItem.glbUrl, scene)
      loading.set(inst.instanceId, p)
      p.then((group) => {
        loading.delete(inst.instanceId)
        // 載入完成後若實例已被移除則 dispose
        if (!group) return
        if (!nextById.has(inst.instanceId) && occluderPoolRef.current === pool) {
          disposeOccluder(group, scene)
          return
        }
        group.position.set(...inst.position)
        group.rotation.set(...inst.rotation)
        group.scale.setScalar(inst.scale)
        pool.set(inst.instanceId, group)
      })
    }
  }, [])
```

- [ ] **Step 6: 加入觸發 useEffect**

於 hook body 內、其他 effects 旁加：

```ts
  useEffect(() => {
    void syncOccluders(occluderInstances ?? [])
  }, [occluderInstances, syncOccluders])
```

- [ ] **Step 7: 在 scene 初始化的 cleanup 內 dispose 全部 occluder**

找到既有的 scene 初始化 `useEffect` 的 return cleanup（`return () => { propsCancelled = true; ro.disconnect(); cancelAnimationFrame(rafRef.current); ... disposeStaticProps(...); disposeTaskProps(...); ... }`）。在 `disposeTaskProps(...)` 後面加：

```ts
      for (const g of occluderPoolRef.current.values()) disposeOccluder(g, scene)
      occluderPoolRef.current.clear()
      occluderLoadingRef.current.clear()
```

- [ ] **Step 8: 型別檢查 + Lint**

Run: `cd frontend && npx tsc -b --noEmit && npm run lint`
Expected: PASS (除既有 lint baseline 外無新增 error/warning)。

- [ ] **Step 9: Commit**

```bash
git add frontend/src/hooks/useBigScreenScene.ts
git commit -m "feat: useBigScreenScene 維護 occluder 實例（diff load/update/dispose）"
```

---

## Task 4: BigScreen 接收 `'occluders-set'` 並傳給 hook

**Files:**
- Modify: `frontend/src/components/BigScreen.tsx`

- [ ] **Step 1: 加入 import 與 type 擴充**

頂部 import 區加：

```tsx
import type { SceneOccluderInstance } from '../types/sceneOccluder';
```

在 `BigScreenMsg.type` 聯合（目前末尾為 `... | 'speaking'`）追加 `'occluders-set'`，變成：

```ts
  type: '...其餘聯合... | 'speaking' | 'occluders-set';
```

在 `BigScreenMsg` interface 末尾（最後一個欄位之後、`}` 之前）加：

```ts
  /** For 'occluders-set': 當前場景所有 occluder 實例（整包同步） */
  occluders?: SceneOccluderInstance[];
```

- [ ] **Step 2: 加入 localStorage 還原 helper（檔案上層工具函式區塊內）**

`BigScreen.tsx` 既有的工具函式區塊（例如 `resolveVrmUrl` 附近）後加：

```ts
const OCCLUDERS_STORAGE_KEY = 'bigscreen-scene-occluders';

function readOccludersFromStorage(sceneId: string): SceneOccluderInstance[] {
  try {
    const all = JSON.parse(localStorage.getItem(OCCLUDERS_STORAGE_KEY) || '{}') as Record<string, SceneOccluderInstance[]>;
    const arr = all[sceneId];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 3: 加入 state 與初始值**

在元件 body 內，跟 `speakingIdentities` 等 state 同區，加：

```tsx
  // 場景遮罩物件實例（per-scene；從 localStorage 還原，HostSession 廣播覆寫）
  const [occluderInstances, setOccluderInstances] = useState<SceneOccluderInstance[]>(
    () => readOccludersFromStorage(sceneId),
  );
```

- [ ] **Step 4: 處理 message**

在 `channel.onmessage` 的 if/else-if 鏈末尾（與 `'speaking'` 分支同層）加：

```tsx
      } else if (msg.type === 'occluders-set') {
        setOccluderInstances(msg.occluders ?? []);
      }
```

- [ ] **Step 5: 場景切換時從 localStorage 還原**

找到 `'scene-change'` 分支（內含 `setSceneId(msg.sceneId);`、`sessionStorage.setItem('bigscreen-sceneId', msg.sceneId);`、清空 slot 等）。在這個分支最後加一行：

```tsx
        setOccluderInstances(readOccludersFromStorage(msg.sceneId));
```

- [ ] **Step 6: 傳入 hook**

在 `useBigScreenScene(canvasRef, { ... })` 的 options 物件中（與 `speakingIdentities` 等同層）加：

```tsx
    occluderInstances,
```

- [ ] **Step 7: 型別檢查 + Lint**

Run: `cd frontend && npx tsc -b --noEmit && npm run lint`
Expected: PASS（無新增 error）。

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/BigScreen.tsx
git commit -m "feat: BigScreen 接收 occluders-set 並從 localStorage 還原"
```

---

## Task 5: SceneOccludersPanel 元件（受控 drawer）

**Files:**
- Create: `frontend/src/components/SceneOccludersPanel.tsx`

設計：純展示元件，所有資料由 props 傳入，所有變更由 callbacks 通知 parent。Parent (HostSession) 負責 state / localStorage / 廣播。

- [ ] **Step 1: 建立 `frontend/src/components/SceneOccludersPanel.tsx`**

```tsx
import { useMemo } from 'react';
import { OCCLUDER_LIBRARY, getOccluderLibraryItem } from '../config/sceneOccluders';
import type { SceneOccluderInstance } from '../types/sceneOccluder';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;
const MAX_INSTANCES = 10;

export interface SceneOccludersPanelProps {
  open: boolean;
  onClose: () => void;
  instances: SceneOccluderInstance[];
  selectedInstanceId: string | null;
  onSelect: (instanceId: string | null) => void;
  onAdd: (libraryId: string) => void;
  onUpdate: (instanceId: string, patch: Partial<Pick<SceneOccluderInstance, 'position' | 'rotation' | 'scale'>>) => void;
  onRemove: (instanceId: string) => void;
  onDuplicate: (instanceId: string) => void;
}

export default function SceneOccludersPanel({
  open, onClose, instances, selectedInstanceId,
  onSelect, onAdd, onUpdate, onRemove, onDuplicate,
}: SceneOccludersPanelProps) {
  const atCap = instances.length >= MAX_INSTANCES;
  const selected = useMemo(
    () => instances.find(i => i.instanceId === selectedInstanceId) ?? null,
    [instances, selectedInstanceId],
  );

  // 計算每個 instance 在自家 library 內的序號（"屏風 1"、"屏風 2"）
  const ordinalByInstance = useMemo(() => {
    const m = new Map<string, number>();
    const counts = new Map<string, number>();
    for (const inst of instances) {
      const n = (counts.get(inst.libraryId) ?? 0) + 1;
      counts.set(inst.libraryId, n);
      m.set(inst.instanceId, n);
    }
    return m;
  }, [instances]);

  const onPosChange = (axis: 0 | 1 | 2, value: number) => {
    if (!selected) return;
    const next: [number, number, number] = [...selected.position];
    next[axis] = value;
    onUpdate(selected.instanceId, { position: next });
  };
  const onRotYChangeDeg = (deg: number) => {
    if (!selected) return;
    const next: [number, number, number] = [selected.rotation[0], deg * DEG2RAD, selected.rotation[2]];
    onUpdate(selected.instanceId, { rotation: next });
  };
  const onScaleChange = (v: number) => {
    if (!selected) return;
    onUpdate(selected.instanceId, { scale: v });
  };

  return (
    <div className={`panel-drawer ${open ? 'panel-drawer--open' : ''}`}>
      <div className="panel-drawer-header">
        <div className="slot-drawer-title">
          <span className="orange">場景物件</span> <span className="teal">{instances.length}/{MAX_INSTANCES}</span>
        </div>
        <button className="panel-close-btn" onClick={onClose}>✕</button>
      </div>
      <div className="panel-drawer-body">

        {/* 物件庫 */}
        <fieldset className="scene-editor-section">
          <legend>物件庫</legend>
          {OCCLUDER_LIBRARY.length === 0 ? (
            <div className="scene-editor-hint">（尚未登錄物件，請於 sceneOccluders.ts 加入）</div>
          ) : (
            OCCLUDER_LIBRARY.map(item => (
              <div key={item.id} className="scene-editor-row">
                <label>{item.label}</label>
                <button
                  type="button"
                  disabled={atCap}
                  onClick={() => onAdd(item.id)}
                >
                  {atCap ? '已達上限' : '+ 加入'}
                </button>
              </div>
            ))
          )}
        </fieldset>

        {/* 已加入 */}
        <fieldset className="scene-editor-section">
          <legend>已加入</legend>
          {instances.length === 0 ? (
            <div className="scene-editor-hint">尚未加入任何物件</div>
          ) : (
            instances.map(inst => {
              const lib = getOccluderLibraryItem(inst.libraryId);
              const ord = ordinalByInstance.get(inst.instanceId) ?? 0;
              const isSelected = inst.instanceId === selectedInstanceId;
              return (
                <div
                  key={inst.instanceId}
                  className={`scene-editor-row${isSelected ? ' is-selected' : ''}`}
                  onClick={() => onSelect(inst.instanceId)}
                  style={{ cursor: 'pointer' }}
                >
                  <label>{lib?.label ?? '(已失效)'} {ord}</label>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onRemove(inst.instanceId); }}
                  >
                    ✕
                  </button>
                </div>
              );
            })
          )}
        </fieldset>

        {/* 變換（僅選中時顯示） */}
        {selected && (
          <>
            <fieldset className="scene-editor-section">
              <legend>位置 (m)</legend>
              {(['X', 'Y', 'Z'] as const).map((label, i) => (
                <div key={label} className="scene-editor-row">
                  <label>{label}</label>
                  <input
                    type="range" min={-5} max={5} step={0.05}
                    value={selected.position[i as 0 | 1 | 2]}
                    onChange={e => onPosChange(i as 0 | 1 | 2, Number(e.target.value))}
                  />
                  <input
                    type="number" step={0.05}
                    value={selected.position[i as 0 | 1 | 2]}
                    onChange={e => onPosChange(i as 0 | 1 | 2, Number(e.target.value))}
                  />
                </div>
              ))}
            </fieldset>

            <fieldset className="scene-editor-section">
              <legend>旋轉 Y (°)</legend>
              <div className="scene-editor-row">
                <label>Yaw</label>
                <input
                  type="range" min={-180} max={180} step={1}
                  value={selected.rotation[1] * RAD2DEG}
                  onChange={e => onRotYChangeDeg(Number(e.target.value))}
                />
                <input
                  type="number" step={1}
                  value={Math.round(selected.rotation[1] * RAD2DEG * 100) / 100}
                  onChange={e => onRotYChangeDeg(Number(e.target.value))}
                />
              </div>
            </fieldset>

            <fieldset className="scene-editor-section">
              <legend>縮放</legend>
              <div className="scene-editor-row">
                <label>Scale</label>
                <input
                  type="range" min={0.1} max={5} step={0.05}
                  value={selected.scale}
                  onChange={e => onScaleChange(Number(e.target.value))}
                />
                <input
                  type="number" step={0.05}
                  value={selected.scale}
                  onChange={e => onScaleChange(Number(e.target.value))}
                />
              </div>
            </fieldset>

            <div className="scene-editor-actions">
              <button
                type="button"
                className="scene-editor-btn-reset"
                onClick={() => onDuplicate(selected.instanceId)}
              >
                複製
              </button>
              <button
                type="button"
                className="scene-editor-btn-save"
                onClick={() => onRemove(selected.instanceId)}
              >
                刪除
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 型別檢查 + Lint**

Run: `cd frontend && npx tsc -b --noEmit && npm run lint`
Expected: PASS（此檔案目前還沒被任何地方 import，TS 不會報「未使用」— 預設 export 不會被視為未使用）。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/SceneOccludersPanel.tsx
git commit -m "feat: SceneOccludersPanel 受控 drawer 元件"
```

---

## Task 6: HostSession 整合（state、廣播、drawer 入口、persistence）

**Files:**
- Modify: `frontend/src/components/HostSession.tsx`

設計：HostSession 持有當前場景的 `occluderInstances`，所有變更同時：
1. 更新 React state
2. 寫入 localStorage（全部場景的 Record）
3. 廣播 `'occluders-set'` 給 BigScreen

- [ ] **Step 1: 加入 imports**

頂端 imports 加：

```tsx
import SceneOccludersPanel from './SceneOccludersPanel.tsx';
import type { SceneOccluderInstance } from '../types/sceneOccluder';
import { getOccluderLibraryItem } from '../config/sceneOccluders';
```

- [ ] **Step 2: 加入 localStorage helpers（檔案中接近其他工具函式或元件上方均可）**

在 HostSession 元件（`export default function HostSession(...)`）**之前**加：

```ts
const OCCLUDERS_STORAGE_KEY = 'bigscreen-scene-occluders';
const OCCLUDER_DEFAULT_POSITION: [number, number, number] = [0, 1, -1];
const OCCLUDER_DEFAULT_ROTATION: [number, number, number] = [0, 0, 0];
const OCCLUDER_MAX_PER_SCENE = 10;

function readAllOccluders(): Record<string, SceneOccluderInstance[]> {
  try {
    const raw = localStorage.getItem(OCCLUDERS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, SceneOccluderInstance[]>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAllOccluders(all: Record<string, SceneOccluderInstance[]>): void {
  try {
    localStorage.setItem(OCCLUDERS_STORAGE_KEY, JSON.stringify(all));
  } catch (err) {
    console.warn('[HostSession] occluders persist failed:', err);
  }
}
```

- [ ] **Step 3: 加入 state**

在元件 body 內，與其他 sceneId 相關 state 同區（例如 `selectedSceneId` 之後），加：

```tsx
  const [occluderInstances, setOccluderInstances] = useState<SceneOccluderInstance[]>(
    () => readAllOccluders()[selectedSceneId] ?? [],
  );
  const [selectedOccluderId, setSelectedOccluderId] = useState<string | null>(null);
  const [showOccluderPanel, setShowOccluderPanel] = useState(false);
```

- [ ] **Step 4: 加入廣播 helper**

接近其他 broadcast helper（如 `broadcastSceneChange`、`broadcastTaskChange`）加：

```tsx
  const broadcastOccluders = useCallback((arr: SceneOccluderInstance[]) => {
    const msg: BigScreenMsg = { type: 'occluders-set', occluders: arr };
    channelRef.current?.postMessage(msg);
  }, []);
```

- [ ] **Step 5: 加入提交函式（state + localStorage + broadcast 三合一）**

```tsx
  const commitOccluders = useCallback((next: SceneOccluderInstance[]) => {
    setOccluderInstances(next);
    const all = readAllOccluders();
    all[selectedSceneId] = next;
    writeAllOccluders(all);
    broadcastOccluders(next);
  }, [selectedSceneId, broadcastOccluders]);
```

- [ ] **Step 6: 加入 CRUD callbacks**

```tsx
  const handleOccluderAdd = useCallback((libraryId: string) => {
    setOccluderInstances(prev => {
      if (prev.length >= OCCLUDER_MAX_PER_SCENE) return prev;
      const lib = getOccluderLibraryItem(libraryId);
      const newInst: SceneOccluderInstance = {
        instanceId: crypto.randomUUID(),
        libraryId,
        position: [...OCCLUDER_DEFAULT_POSITION],
        rotation: [...OCCLUDER_DEFAULT_ROTATION],
        scale: lib?.defaultScale ?? 1,
      };
      const next = [...prev, newInst];
      const all = readAllOccluders();
      all[selectedSceneId] = next;
      writeAllOccluders(all);
      broadcastOccluders(next);
      setSelectedOccluderId(newInst.instanceId);
      return next;
    });
  }, [selectedSceneId, broadcastOccluders]);

  const handleOccluderUpdate = useCallback((
    instanceId: string,
    patch: Partial<Pick<SceneOccluderInstance, 'position' | 'rotation' | 'scale'>>,
  ) => {
    setOccluderInstances(prev => {
      const next = prev.map(o => o.instanceId === instanceId ? { ...o, ...patch } : o);
      const all = readAllOccluders();
      all[selectedSceneId] = next;
      writeAllOccluders(all);
      broadcastOccluders(next);
      return next;
    });
  }, [selectedSceneId, broadcastOccluders]);

  const handleOccluderRemove = useCallback((instanceId: string) => {
    setOccluderInstances(prev => {
      const next = prev.filter(o => o.instanceId !== instanceId);
      const all = readAllOccluders();
      all[selectedSceneId] = next;
      writeAllOccluders(all);
      broadcastOccluders(next);
      if (selectedOccluderId === instanceId) setSelectedOccluderId(null);
      return next;
    });
  }, [selectedSceneId, selectedOccluderId, broadcastOccluders]);

  const handleOccluderDuplicate = useCallback((instanceId: string) => {
    setOccluderInstances(prev => {
      if (prev.length >= OCCLUDER_MAX_PER_SCENE) return prev;
      const src = prev.find(o => o.instanceId === instanceId);
      if (!src) return prev;
      const newInst: SceneOccluderInstance = {
        ...src,
        instanceId: crypto.randomUUID(),
        position: [src.position[0] + 0.3, src.position[1], src.position[2]],
      };
      const next = [...prev, newInst];
      const all = readAllOccluders();
      all[selectedSceneId] = next;
      writeAllOccluders(all);
      broadcastOccluders(next);
      setSelectedOccluderId(newInst.instanceId);
      return next;
    });
  }, [selectedSceneId, broadcastOccluders]);

  // 沒被讀取的 commit helper 移除以避免 unused：上面四個 handler 已包辦三件事，
  // 但保留 commitOccluders 給未來批次操作使用 — 若 TS noUnusedLocals 報警則刪除它。
```

> 注意：如果 TS 報 `commitOccluders` 未使用，移除 Step 5 的宣告（沒被 handler 使用，是預留接口）。

- [ ] **Step 7: 場景切換時還原該場景的 occluders**

找到既有的 `handleSceneChange`。在它內部既有的 sessionStorage / 各種 reset 之後（與其他 broadcast 同層），加：

```tsx
      const sceneOccluders = readAllOccluders()[sceneId] ?? [];
      setOccluderInstances(sceneOccluders);
      setSelectedOccluderId(null);
      broadcastOccluders(sceneOccluders);
```

並把 `broadcastOccluders` 加入 `handleSceneChange` 的 useCallback 依賴陣列（在最後 `]` 之前追加 `, broadcastOccluders`）。

- [ ] **Step 8: 加入 sidebar card 按鈕**

找到 sidebar 內各 hs-card 區塊（例如 `{/* Task card */}` 之後）。在合適位置加：

```tsx
          {/* 場景物件 (occluders) card */}
          <div
            className={`hs-card hs-card--scene ${showOccluderPanel ? 'hs-card--open' : ''}`}
            onClick={() => {
              setShowOccluderPanel(v => !v);
              // 與其他 drawer 互斥，避免兩個同時開
              setShowScenePanel(false);
              setShowSlotPanel(false);
              setShowTaskPanel(false);
              setShowPendingPanel(false);
            }}
          >
            <div className="hs-card-header">
              <span className="hs-card-icon">🪴</span>
              <span className="hs-card-title">場景物件</span>
              <span className="hs-badge hs-badge--info">{occluderInstances.length}/{OCCLUDER_MAX_PER_SCENE}</span>
            </div>
          </div>
```

- [ ] **Step 9: 渲染 SceneOccludersPanel**

找到既有 drawer 渲染區塊（例如 `<div className={\`panel-drawer ${showScenePanel ? 'panel-drawer--open' : ''}\`}>`）旁邊，加：

```tsx
      <SceneOccludersPanel
        open={showOccluderPanel}
        onClose={() => setShowOccluderPanel(false)}
        instances={occluderInstances}
        selectedInstanceId={selectedOccluderId}
        onSelect={setSelectedOccluderId}
        onAdd={handleOccluderAdd}
        onUpdate={handleOccluderUpdate}
        onRemove={handleOccluderRemove}
        onDuplicate={handleOccluderDuplicate}
      />
```

- [ ] **Step 10: 修正 backdrop 條件**

找到既有的 backdrop 判斷（類似 `{(showScenePanel || showSlotPanel || showTaskPanel || showPendingPanel || sceneEditorGroupId) && (...)`）。在條件中追加 `|| showOccluderPanel`：

```tsx
      {(showScenePanel || showSlotPanel || showTaskPanel || showPendingPanel || sceneEditorGroupId || showOccluderPanel) && (
```

- [ ] **Step 11: 互斥（其他 drawer 開啟時關掉 occluder drawer）**

找到既有 `openScene` / `openSlot` / `openTask` 等開啟函式（或對應 onClick），在它們同時切換其他面板的地方追加 `setShowOccluderPanel(false);` 即可（與 Step 8 對稱）。若它們是用統一 helper 開關，也加上。

> 若這些 helpers 已是 `setShowSlotPanel(false); setShowTaskPanel(false); ...` 的形式，照樣 mirror 一行 `setShowOccluderPanel(false);`。

- [ ] **Step 12: 在元件初始載入時同步廣播一次**

由於 BigScreen 也會自己從 localStorage 讀，這步驟原則上非必要，但建議在 `useEffect` 初次掛載時把當前場景的 occluder 廣播一次，避免 BigScreen 已開窗 + 後續打開 HostSession 時 BigScreen 還是舊的（與既有「snapshot 寫 sessionStorage」邏輯精神一致）。加：

```tsx
  useEffect(() => {
    broadcastOccluders(occluderInstances);
    // 只在掛載時送一次；後續變動由 commit/handler 廣播
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 13: 型別檢查 + Lint**

Run: `cd frontend && npx tsc -b --noEmit && npm run lint`
Expected: PASS。若 `commitOccluders` 報未使用 → 刪除 Step 5 宣告。若任何新增 callback 的依賴未列齊 → 補齊。

- [ ] **Step 14: Commit**

```bash
git add frontend/src/components/HostSession.tsx
git commit -m "feat: HostSession 整合場景物件 drawer 與廣播/persistence"
```

---

## Task 7: 整合驗證

**Files:** 無（驗證用）

- [ ] **Step 1: 完整建置**

Run: `cd frontend && npm run build`
Expected: `tsc -b` 與 `vite build` 皆成功。

- [ ] **Step 2: Lint**

Run: `cd frontend && npm run lint`
Expected: 無新增 error vs baseline。

- [ ] **Step 3: 暫時登錄一個測試 GLB 以做手動驗證**

在 `frontend/src/config/sceneOccluders.ts` 暫時把 `OCCLUDER_LIBRARY` 加入一個指向專案內已有 GLB 的測試項目（用 staticProps 中某個現成 url，例如 clothingStore_cashier 內任一 staticProp 的 url 即可）。例如：

```ts
export const OCCLUDER_LIBRARY: OccluderLibraryItem[] = [
  { id: 'test-screen', label: '測試屏風', glbUrl: '/models/your-existing-glb.glb', defaultScale: 1 },
];
```

> 此項僅供本步驟手動驗證使用。確認後在 Step 6 還原為空陣列再 commit。

- [ ] **Step 4: 啟動 dev server 並手動驗證**

Run: `cd frontend && npm run dev` (背景啟動)

開教師控制台 + 大屏（`/?screen=bigscreen`）兩視窗。確認：
1. 教師端 sidebar 出現「🪴 場景物件 0/10」card。
2. 點 card → drawer 從右滑出。
3. 點測試項目「+ 加入」→ 大屏立即在 `[0,1,-1]` 出現 GLB；list 顯示「測試屏風 1」並自動選中；變換區出現。
4. 拉位置/旋轉/縮放滑桿 → 大屏即時跟隨。
5. 再加一個 → 「測試屏風 2」；「複製」→ 「測試屏風 3」位置偏 +0.3。
6. 切換選中 → 變換區值切換正確。
7. 點 [×] 刪除一個 → 大屏該物件消失；selectedOccluderId 若為被刪者則自動清空。
8. 加到第 11 次 → 「+ 加入」disabled、顯示「已達上限」。
9. 切到另一場景 → 物件消失；切回 → 還原。
10. 重新整理頁面 → 還原。
11. 開無痕視窗的 BigScreen → 不會顯示，因為 localStorage 是 per-browser（符合設計）。

- [ ] **Step 5: 還原測試 library 項目**

把 Step 3 加入的測試項目移除，`OCCLUDER_LIBRARY` 回到空陣列。

- [ ] **Step 6: 最終 commit（若有零散調整）**

```bash
git add -A
git commit -m "chore: 場景物件編輯器整合驗證"
```

---

## Self-Review 對照（規格 → 任務）

- 型別 `SceneOccluderInstance` → Task 1 ✅
- 物件庫 config + 查表 helper → Task 1 ✅
- GLB load/dispose helper → Task 2 ✅
- Hook 維護 `Map<instanceId, THREE.Group>` 並 diff sync → Task 3 ✅
- BigScreenMsg 加 `'occluders-set'`、BigScreen state + handler + localStorage 還原 + 傳給 hook → Task 4 ✅
- Drawer UI（庫列表、已加入、變換 X/Y/Z + Y 旋轉 + scale + 複製/刪除、10 上限） → Task 5 ✅
- HostSession：state、廣播、localStorage 三合一 commit、drawer 入口、互斥、場景切換還原 → Task 6 ✅
- 整合 + 手動測試 → Task 7 ✅

型別一致性：`SceneOccluderInstance`（Task 1）於 Tasks 3/4/5/6 一致；`'occluders-set'` 訊息形狀（`occluders?: SceneOccluderInstance[]`）於 Task 4 與 Task 6 producer/consumer 一致；`OCCLUDER_LIBRARY` 與 `getOccluderLibraryItem` 命名於 Tasks 1/3/5/6 一致；`OCCLUDER_MAX_PER_SCENE = 10`（HostSession）與 `MAX_INSTANCES = 10`（panel）為刻意分屬不同檔的常數，邏輯一致。
