# BigScreen 編輯模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在大屏視窗上疊加一個可整合編輯場景遮罩物件(occluder)與角色群組變換(group transform)的編輯模式,具備素材庫、3D Gizmo(僅 occluder)、多步 undo/redo、單一/場景重置、與顯式保存。

**Architecture:** 同一個 `BigScreen.tsx` 元件加上 `editMode` flag;新增 `useBigScreenEditor` hook 管 reducer/undo/dirty buffer;`useBigScreenScene` 擴充 placeholder slot avatars 與 gizmo lifecycle;新增 `BigScreenEditorOverlay` 元件作為右側固定面板。所有編輯只在記憶體變動,顯式 commit 才寫 `localStorage` 並廣播。

**Tech Stack:** React 19 + TypeScript + Three.js(`three/examples/jsm/controls/TransformControls`)+ Vite + Vitest(本次新增)。

**Spec:** `docs/superpowers/specs/2026-06-05-bigscreen-edit-mode-design.md`

**Verification loop:**
- 純 logic(reducer / pure utils): vitest 單元測試(本次新增測試框架)。
- React hook / UI / Three.js 互動: `npm run build`(tsc + vite)+ `npm run lint` + 手動瀏覽器驗證(本機開 `/?screen=bigscreen&mode=edit`)。
- 沒有 e2e 框架,測試重點集中在 reducer。UI 任務以「明確驗證步驟」描述。

**Commit style:** 無 `Co-Authored-By` footer(專案偏好)。

---

## File Structure

### 新增

| 路徑 | 責任 |
|---|---|
| `frontend/vitest.config.ts` | Vitest 設定(jsdom env、include patterns) |
| `frontend/src/utils/occluderDefaults.ts` | `defaultTransform(libraryId)` 共用 helper |
| `frontend/src/utils/occluderDefaults.test.ts` | 上者單元測試 |
| `frontend/src/hooks/useBigScreenEditor.ts` | Editor reducer + React hook(draft / undo stack / dirty / commit) |
| `frontend/src/hooks/useBigScreenEditor.reducer.ts` | 純函數 reducer(分檔以利測試) |
| `frontend/src/hooks/useBigScreenEditor.reducer.test.ts` | reducer 單元測試 |
| `frontend/src/utils/editorGizmo.ts` | `attachGizmo` / `disposeGizmo` 對 `TransformControls` 的薄封裝 |
| `frontend/src/components/BigScreenEditorOverlay.tsx` | 右側 360px 編輯面板 |
| `frontend/src/components/BigScreenEditorOverlay.css` | 面板樣式 |

### 修改

| 路徑 | 改動摘要 |
|---|---|
| `frontend/package.json` | 加 `vitest`、`jsdom`、`@vitest/ui`(dev);加 `test` script |
| `frontend/src/components/SceneOccludersPanel.tsx` | 從 `utils/occluderDefaults` import `defaultTransform`;header hint |
| `frontend/src/components/SceneEditor.tsx` | Header 加 hint「也可在大屏編輯模式整合調整」 |
| `frontend/src/hooks/useBigScreenScene.ts` | 新 prop:`editorPlaceholderSlots`、`editorGizmoEnabled`、`onOccluderRootMap`、`onGizmoApi`、`editModeIgnoreSlotPin`;新增 placeholder avatar 分支;gizmo lifecycle |
| `frontend/src/components/BigScreen.tsx` | URL `mode=edit` 初始化、`E` 鍵與左上 ✏️ toggle、`useBigScreenEditor` 接線、`effectiveOccluders`/`effectiveGroupTransforms` 衍生、`beforeunload` 守門、編輯模式 channel 訊息 guard、`onCommit` 同步 state、scene-change dirty confirm |
| `frontend/src/components/HostSession.tsx` | `openBigScreen` 接受 `mode` 參數;FAB 點擊改 popover menu;CSS class 新增 |
| `frontend/src/types/vrm.ts` | (若需)加 `__placeholder__:` 前綴常數匯出 |

### 不動

- `SCENE_PRESETS` / `THEMES`(`config/scenes.ts`)。
- `BigScreenMsg` 型別與既有訊息語意(`'occluders-set'`、`'group-transform'` 重用)。
- 教師端錄製、AI 助理、提示欄、徽章邏輯。
- iframe preview 路徑(沒有 `&mode=edit`)。

---

## Task 1: 加入 Vitest 測試框架

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/utils/sanity.test.ts`(用完即刪)

- [ ] **Step 1: 安裝 dev deps**

執行(在 `frontend/` 目錄):
```bash
npm install --save-dev vitest @vitest/ui jsdom @types/node
```

預期 `package.json` 的 `devDependencies` 多出 `vitest`、`@vitest/ui`、`jsdom`(`@types/node` 已存在則 npm 自動忽略)。

- [ ] **Step 2: 加 test script**

修改 `frontend/package.json` 的 `scripts`,在 `preview` 之後加:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: 寫 `vitest.config.ts`**

建立 `frontend/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: false,
  },
})
```

- [ ] **Step 4: 寫一個 sanity test 確認 toolchain**

建立 `frontend/src/utils/sanity.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

describe('vitest toolchain', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 5: 跑測試**

執行: `npm test`(在 `frontend/` 目錄)
預期: 1 passed,exit 0。

- [ ] **Step 6: 刪除 sanity test**

`rm frontend/src/utils/sanity.test.ts`(或對應指令)。

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts
git commit -m "build: 加入 vitest 測試框架"
```

---

## Task 2: 抽出 `defaultTransform` 到 `utils/occluderDefaults.ts`(TDD)

**Files:**
- Create: `frontend/src/utils/occluderDefaults.ts`
- Create: `frontend/src/utils/occluderDefaults.test.ts`
- Modify: `frontend/src/components/SceneOccludersPanel.tsx`(改 import,移除原 inline 函數)

- [ ] **Step 1: 寫 failing test**

建立 `frontend/src/utils/occluderDefaults.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { defaultOccluderTransform } from './occluderDefaults'

vi.mock('../config/sceneOccluders', () => ({
  OCCLUDER_LIBRARY_BY_ID: {
    rack: { id: 'rack', label: '衣架', glbUrl: '/x.glb', defaultScale: 1.5 },
    noScale: { id: 'noScale', label: 'No Scale', glbUrl: '/y.glb' },
  },
}))

describe('defaultOccluderTransform', () => {
  it('returns library defaultScale when present', () => {
    expect(defaultOccluderTransform('rack')).toEqual({
      position: [0, 1, -1],
      rotation: [0, 0, 0],
      scale: 1.5,
    })
  })

  it('falls back to 1 when defaultScale is undefined', () => {
    expect(defaultOccluderTransform('noScale').scale).toBe(1)
  })

  it('falls back to 1 when libraryId is unknown', () => {
    expect(defaultOccluderTransform('missing').scale).toBe(1)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

執行: `npm test -- occluderDefaults`
預期: FAIL — `Cannot find module './occluderDefaults'`。

- [ ] **Step 3: 寫實作**

建立 `frontend/src/utils/occluderDefaults.ts`:
```ts
import { OCCLUDER_LIBRARY_BY_ID } from '../config/sceneOccluders'
import type { SceneOccluderInstance } from '../types/sceneOccluder'

/**
 * 預設 transform — 場景中央,地面以上 1m,鏡頭前 1m。
 * scale 來自 library 設定的 defaultScale,缺省為 1。
 */
export function defaultOccluderTransform(
  libraryId: string,
): Pick<SceneOccluderInstance, 'position' | 'rotation' | 'scale'> {
  const lib = OCCLUDER_LIBRARY_BY_ID[libraryId]
  return {
    position: [0, 1, -1],
    rotation: [0, 0, 0],
    scale: lib?.defaultScale ?? 1,
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

執行: `npm test -- occluderDefaults`
預期: 3 passed。

- [ ] **Step 5: 改 `SceneOccludersPanel.tsx` 用共用版本**

在 `frontend/src/components/SceneOccludersPanel.tsx`:

**移除**(原檔約 32-40 行):
```ts
function defaultTransform(libraryId: string): Pick<SceneOccluderInstance, 'position' | 'rotation' | 'scale'> {
  const lib = OCCLUDER_LIBRARY_BY_ID[libraryId]
  return {
    position: [0, 1, -1],
    rotation: [0, 0, 0],
    scale: lib?.defaultScale ?? 1,
  }
}
```

**加 import**(與既有 imports 同區):
```ts
import { defaultOccluderTransform } from '../utils/occluderDefaults'
```

**改 call site**(`addFromLibrary` 內,原 `const t = defaultTransform(libraryId)`):
```ts
const t = defaultOccluderTransform(libraryId)
```

- [ ] **Step 6: 跑 build + lint 確認無破壞**

執行: `npm run build && npm run lint`
預期: 兩者皆 exit 0。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/utils/occluderDefaults.ts \
        frontend/src/utils/occluderDefaults.test.ts \
        frontend/src/components/SceneOccludersPanel.tsx
git commit -m "refactor: 抽出 defaultOccluderTransform 到共用 util"
```

---

## Task 3: Editor reducer — 型別 + occluder mutations(TDD)

**Files:**
- Create: `frontend/src/hooks/useBigScreenEditor.reducer.ts`
- Create: `frontend/src/hooks/useBigScreenEditor.reducer.test.ts`

- [ ] **Step 1: 寫 failing test**

建立 `frontend/src/hooks/useBigScreenEditor.reducer.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import {
  initialEditorState,
  editorReducer,
  type EditorDraft,
} from './useBigScreenEditor.reducer'

vi.mock('../config/sceneOccluders', () => ({
  OCCLUDER_LIBRARY_BY_ID: {
    rack: { id: 'rack', label: '衣架', glbUrl: '/x.glb', defaultScale: 1 },
  },
}))

const baseDraft: EditorDraft = {
  sceneId: 'scene1',
  occluders: [],
  groupTransforms: {},
}

describe('editorReducer — add-occluder', () => {
  it('appends a new instance with default transform', () => {
    const state = initialEditorState(baseDraft)
    const next = editorReducer(state, {
      type: 'add-occluder',
      libraryId: 'rack',
      instanceId: 'fixed-id-1',
    })
    expect(next.draft.occluders).toHaveLength(1)
    expect(next.draft.occluders[0]).toMatchObject({
      instanceId: 'fixed-id-1',
      libraryId: 'rack',
      position: [0, 1, -1],
      rotation: [0, 0, 0],
      scale: 1,
    })
    expect(next.selection).toEqual({ kind: 'occluder', id: 'fixed-id-1' })
    expect(next.dirty).toBe(true)
  })

  it('does nothing when libraryId is unknown', () => {
    const state = initialEditorState(baseDraft)
    const next = editorReducer(state, {
      type: 'add-occluder',
      libraryId: 'unknown',
      instanceId: 'x',
    })
    expect(next).toBe(state)
  })
})

describe('editorReducer — update-occluder', () => {
  it('merges patch and bumps dirty', () => {
    const seed: EditorDraft = {
      ...baseDraft,
      occluders: [{ instanceId: 'a', libraryId: 'rack', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }],
    }
    const state = initialEditorState(seed)
    const next = editorReducer(state, {
      type: 'update-occluder',
      instanceId: 'a',
      patch: { position: [1, 2, 3] },
    })
    expect(next.draft.occluders[0].position).toEqual([1, 2, 3])
    expect(next.dirty).toBe(true)
  })
})

describe('editorReducer — delete-occluder', () => {
  it('removes instance and clears selection if matched', () => {
    const seed: EditorDraft = {
      ...baseDraft,
      occluders: [{ instanceId: 'a', libraryId: 'rack', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }],
    }
    let state = initialEditorState(seed)
    state = editorReducer(state, { type: 'select', sel: { kind: 'occluder', id: 'a' } })
    const next = editorReducer(state, { type: 'delete-occluder', instanceId: 'a' })
    expect(next.draft.occluders).toHaveLength(0)
    expect(next.selection).toBeNull()
  })
})

describe('editorReducer — duplicate-occluder', () => {
  it('clones with new instanceId and offset position', () => {
    const seed: EditorDraft = {
      ...baseDraft,
      occluders: [{ instanceId: 'a', libraryId: 'rack', position: [1, 1, 1], rotation: [0, 0, 0], scale: 2 }],
    }
    const state = initialEditorState(seed)
    const next = editorReducer(state, { type: 'duplicate-occluder', instanceId: 'a', newInstanceId: 'b' })
    expect(next.draft.occluders).toHaveLength(2)
    expect(next.draft.occluders[1]).toMatchObject({
      instanceId: 'b',
      libraryId: 'rack',
      position: [1.3, 1, 1.3],
      scale: 2,
    })
    expect(next.selection).toEqual({ kind: 'occluder', id: 'b' })
  })

  it('respects MAX_OCCLUDERS_PER_SCENE', () => {
    const seed: EditorDraft = {
      ...baseDraft,
      occluders: Array.from({ length: 10 }, (_, i) => ({
        instanceId: `i${i}`, libraryId: 'rack', position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: 1,
      })),
    }
    const state = initialEditorState(seed)
    const next = editorReducer(state, { type: 'duplicate-occluder', instanceId: 'i0', newInstanceId: 'new' })
    expect(next).toBe(state)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

執行: `npm test -- useBigScreenEditor.reducer`
預期: FAIL — `Cannot find module './useBigScreenEditor.reducer'`。

- [ ] **Step 3: 寫實作**

建立 `frontend/src/hooks/useBigScreenEditor.reducer.ts`:
```ts
/**
 * Editor reducer — 純函數版本,所有純邏輯都在這裡。
 * React hook (`useBigScreenEditor.ts`) 只負責 dispatch、副作用(localStorage / channel / onCommit)。
 *
 * 設計重點:
 *  - 任何 mutation 都產生新的 `draft` snapshot(immutable)。
 *  - 隨 mutation 自動推進 dirty / undo stack;reducer 本身不知道 localStorage。
 *  - instanceId 由呼叫端提供(便於測試與 SSR-safe);hook 端用 crypto.randomUUID()。
 */
import type { SceneOccluderInstance } from '../types/sceneOccluder'
import { OCCLUDER_LIBRARY_BY_ID } from '../config/sceneOccluders'
import { defaultOccluderTransform } from '../utils/occluderDefaults'
import { IDENTITY_TRANSFORM, type Vec3 } from '../utils/groupTransform'

export const MAX_OCCLUDERS_PER_SCENE = 10
export const UNDO_STACK_LIMIT = 50
export const COALESCE_WINDOW_MS = 400

export type StoredGroupTransform = { pos: Vec3; rot: Vec3 }

export type EditorDraft = {
  sceneId: string
  occluders: SceneOccluderInstance[]
  groupTransforms: Record<string, StoredGroupTransform>
}

export type Selection =
  | { kind: 'occluder'; id: string }
  | { kind: 'group'; id: string }
  | null

export type GizmoMode = 'translate' | 'rotate'

export type EditorState = {
  draft: EditorDraft
  selection: Selection
  gizmoMode: GizmoMode
  past: EditorDraft[]
  future: EditorDraft[]
  dirty: boolean
  /** 最近一筆 update action 的 (kind, id, ts);用於 coalesce 判斷。 */
  lastUpdate: { kind: 'occluder' | 'group'; id: string; ts: number } | null
  /** 進入編輯模式 / 最近一次 commit 後的 baseline,用於 commit 時 diff group。 */
  baselineGroupTransforms: Record<string, StoredGroupTransform>
}

export type EditorAction =
  | { type: 'add-occluder'; libraryId: string; instanceId: string }
  | { type: 'update-occluder'; instanceId: string; patch: Partial<SceneOccluderInstance>; ts?: number }
  | { type: 'delete-occluder'; instanceId: string }
  | { type: 'duplicate-occluder'; instanceId: string; newInstanceId: string }
  | { type: 'update-group'; groupId: string; transform: StoredGroupTransform; ts?: number }
  | { type: 'reset-item'; kind: 'occluder' | 'group'; id: string }
  | { type: 'reset-scene' }
  | { type: 'select'; sel: Selection }
  | { type: 'deselect' }
  | { type: 'gizmo-mode'; mode: GizmoMode }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'commit' }
  | { type: 'discard' }
  | { type: 'load-scene'; draft: EditorDraft }

export function initialEditorState(draft: EditorDraft): EditorState {
  return {
    draft,
    selection: null,
    gizmoMode: 'translate',
    past: [],
    future: [],
    dirty: false,
    lastUpdate: null,
    baselineGroupTransforms: { ...draft.groupTransforms },
  }
}

function pushHistory(state: EditorState, nextDraft: EditorDraft, coalesceKey?: { kind: 'occluder' | 'group'; id: string; ts: number }): EditorState {
  // Coalesce: same target update within COALESCE_WINDOW_MS → overwrite top of past instead of push.
  const last = state.lastUpdate
  if (coalesceKey && last && last.kind === coalesceKey.kind && last.id === coalesceKey.id && coalesceKey.ts - last.ts < COALESCE_WINDOW_MS) {
    return { ...state, draft: nextDraft, future: [], dirty: true, lastUpdate: coalesceKey }
  }
  const past = [...state.past, state.draft]
  if (past.length > UNDO_STACK_LIMIT) past.shift()
  return {
    ...state,
    draft: nextDraft,
    past,
    future: [],
    dirty: true,
    lastUpdate: coalesceKey ?? null,
  }
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'add-occluder': {
      if (!OCCLUDER_LIBRARY_BY_ID[action.libraryId]) return state
      if (state.draft.occluders.length >= MAX_OCCLUDERS_PER_SCENE) return state
      const t = defaultOccluderTransform(action.libraryId)
      const instance: SceneOccluderInstance = {
        instanceId: action.instanceId,
        libraryId: action.libraryId,
        position: t.position,
        rotation: t.rotation,
        scale: t.scale,
      }
      const nextDraft = { ...state.draft, occluders: [...state.draft.occluders, instance] }
      return {
        ...pushHistory(state, nextDraft),
        selection: { kind: 'occluder', id: instance.instanceId },
      }
    }
    case 'update-occluder': {
      const idx = state.draft.occluders.findIndex(o => o.instanceId === action.instanceId)
      if (idx < 0) return state
      const merged = { ...state.draft.occluders[idx], ...action.patch }
      const occluders = state.draft.occluders.slice()
      occluders[idx] = merged
      const nextDraft = { ...state.draft, occluders }
      const ts = action.ts ?? Date.now()
      return pushHistory(state, nextDraft, { kind: 'occluder', id: action.instanceId, ts })
    }
    case 'delete-occluder': {
      const occluders = state.draft.occluders.filter(o => o.instanceId !== action.instanceId)
      if (occluders.length === state.draft.occluders.length) return state
      const nextDraft = { ...state.draft, occluders }
      const next = pushHistory(state, nextDraft)
      const sel = state.selection?.kind === 'occluder' && state.selection.id === action.instanceId ? null : state.selection
      return { ...next, selection: sel }
    }
    case 'duplicate-occluder': {
      if (state.draft.occluders.length >= MAX_OCCLUDERS_PER_SCENE) return state
      const src = state.draft.occluders.find(o => o.instanceId === action.instanceId)
      if (!src) return state
      const dup: SceneOccluderInstance = {
        ...src,
        instanceId: action.newInstanceId,
        position: [src.position[0] + 0.3, src.position[1], src.position[2] + 0.3],
      }
      const nextDraft = { ...state.draft, occluders: [...state.draft.occluders, dup] }
      return {
        ...pushHistory(state, nextDraft),
        selection: { kind: 'occluder', id: dup.instanceId },
      }
    }
    case 'update-group': {
      const nextDraft = {
        ...state.draft,
        groupTransforms: { ...state.draft.groupTransforms, [action.groupId]: action.transform },
      }
      const ts = action.ts ?? Date.now()
      return pushHistory(state, nextDraft, { kind: 'group', id: action.groupId, ts })
    }
    case 'reset-item': {
      if (action.kind === 'occluder') {
        const idx = state.draft.occluders.findIndex(o => o.instanceId === action.id)
        if (idx < 0) return state
        const src = state.draft.occluders[idx]
        const t = defaultOccluderTransform(src.libraryId)
        const occluders = state.draft.occluders.slice()
        occluders[idx] = { ...src, position: t.position, rotation: t.rotation, scale: t.scale }
        return pushHistory(state, { ...state.draft, occluders })
      } else {
        if (!(action.id in state.draft.groupTransforms)) return state
        const groupTransforms = { ...state.draft.groupTransforms }
        groupTransforms[action.id] = { pos: IDENTITY_TRANSFORM.pos, rot: IDENTITY_TRANSFORM.rot }
        return pushHistory(state, { ...state.draft, groupTransforms })
      }
    }
    case 'reset-scene': {
      const nextDraft = { ...state.draft, occluders: [], groupTransforms: {} }
      return { ...pushHistory(state, nextDraft), selection: null }
    }
    case 'select':
      return { ...state, selection: action.sel }
    case 'deselect':
      return { ...state, selection: null }
    case 'gizmo-mode':
      return { ...state, gizmoMode: action.mode }
    case 'undo': {
      if (state.past.length === 0) return state
      const prev = state.past[state.past.length - 1]
      const past = state.past.slice(0, -1)
      const future = [state.draft, ...state.future]
      return { ...state, draft: prev, past, future, dirty: true, lastUpdate: null }
    }
    case 'redo': {
      if (state.future.length === 0) return state
      const next = state.future[0]
      const future = state.future.slice(1)
      const past = [...state.past, state.draft]
      return { ...state, draft: next, past, future, dirty: true, lastUpdate: null }
    }
    case 'commit':
      return {
        ...state,
        past: [],
        future: [],
        dirty: false,
        lastUpdate: null,
        baselineGroupTransforms: { ...state.draft.groupTransforms },
      }
    case 'discard':
      return {
        ...state,
        past: [],
        future: [],
        dirty: false,
        lastUpdate: null,
      }
    case 'load-scene':
      return initialEditorState(action.draft)
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

執行: `npm test -- useBigScreenEditor.reducer`
預期: 5 passed(本 task 涵蓋的 5 個 case)。

- [ ] **Step 5: 跑 lint**

執行: `npm run lint`
預期: exit 0。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useBigScreenEditor.reducer.ts \
        frontend/src/hooks/useBigScreenEditor.reducer.test.ts
git commit -m "feat: BigScreen editor reducer — occluder mutations"
```

---

## Task 4: Editor reducer — group / reset / undo / redo / commit(TDD)

**Files:**
- Modify: `frontend/src/hooks/useBigScreenEditor.reducer.test.ts`

(reducer 本身在 Task 3 已實作完整;本 task 補測試覆蓋。)

- [ ] **Step 1: 追加測試**

在 `useBigScreenEditor.reducer.test.ts` 末尾追加:
```ts
import { COALESCE_WINDOW_MS } from './useBigScreenEditor.reducer'

describe('editorReducer — update-group + coalesce', () => {
  it('two updates within window collapse to one undo entry', () => {
    let s = initialEditorState({ sceneId: 'x', occluders: [], groupTransforms: {} })
    s = editorReducer(s, { type: 'update-group', groupId: 'g1', transform: { pos: [1, 0, 0], rot: [0, 0, 0] }, ts: 1000 })
    expect(s.past).toHaveLength(1)
    s = editorReducer(s, { type: 'update-group', groupId: 'g1', transform: { pos: [2, 0, 0], rot: [0, 0, 0] }, ts: 1000 + COALESCE_WINDOW_MS - 50 })
    expect(s.past).toHaveLength(1) // coalesced
    expect(s.draft.groupTransforms.g1.pos).toEqual([2, 0, 0])
  })

  it('updates beyond window push new entry', () => {
    let s = initialEditorState({ sceneId: 'x', occluders: [], groupTransforms: {} })
    s = editorReducer(s, { type: 'update-group', groupId: 'g1', transform: { pos: [1, 0, 0], rot: [0, 0, 0] }, ts: 1000 })
    s = editorReducer(s, { type: 'update-group', groupId: 'g1', transform: { pos: [2, 0, 0], rot: [0, 0, 0] }, ts: 1000 + COALESCE_WINDOW_MS + 1 })
    expect(s.past).toHaveLength(2)
  })

  it('different targets do not coalesce', () => {
    let s = initialEditorState({ sceneId: 'x', occluders: [], groupTransforms: {} })
    s = editorReducer(s, { type: 'update-group', groupId: 'g1', transform: { pos: [1, 0, 0], rot: [0, 0, 0] }, ts: 1000 })
    s = editorReducer(s, { type: 'update-group', groupId: 'g2', transform: { pos: [1, 0, 0], rot: [0, 0, 0] }, ts: 1001 })
    expect(s.past).toHaveLength(2)
  })
})

describe('editorReducer — reset-item', () => {
  it('resets occluder to library default', () => {
    let s = initialEditorState({
      sceneId: 'x',
      occluders: [{ instanceId: 'a', libraryId: 'rack', position: [5, 5, 5], rotation: [1, 1, 1], scale: 3 }],
      groupTransforms: {},
    })
    s = editorReducer(s, { type: 'reset-item', kind: 'occluder', id: 'a' })
    expect(s.draft.occluders[0]).toMatchObject({ position: [0, 1, -1], rotation: [0, 0, 0], scale: 1 })
    expect(s.past).toHaveLength(1)
  })

  it('resets group to identity', () => {
    let s = initialEditorState({
      sceneId: 'x',
      occluders: [],
      groupTransforms: { g1: { pos: [3, 3, 3], rot: [1, 1, 1] } },
    })
    s = editorReducer(s, { type: 'reset-item', kind: 'group', id: 'g1' })
    expect(s.draft.groupTransforms.g1).toEqual({ pos: [0, 0, 0], rot: [0, 0, 0] })
  })

  it('no-op on missing id', () => {
    const seed = initialEditorState({ sceneId: 'x', occluders: [], groupTransforms: {} })
    const next = editorReducer(seed, { type: 'reset-item', kind: 'group', id: 'missing' })
    expect(next).toBe(seed)
  })
})

describe('editorReducer — reset-scene', () => {
  it('empties draft and clears selection', () => {
    let s = initialEditorState({
      sceneId: 'x',
      occluders: [{ instanceId: 'a', libraryId: 'rack', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }],
      groupTransforms: { g: { pos: [1, 0, 0], rot: [0, 0, 0] } },
    })
    s = editorReducer(s, { type: 'select', sel: { kind: 'occluder', id: 'a' } })
    s = editorReducer(s, { type: 'reset-scene' })
    expect(s.draft.occluders).toEqual([])
    expect(s.draft.groupTransforms).toEqual({})
    expect(s.selection).toBeNull()
    expect(s.dirty).toBe(true)
  })
})

describe('editorReducer — undo / redo', () => {
  it('undo restores prior state and pushes to future', () => {
    let s = initialEditorState({ sceneId: 'x', occluders: [], groupTransforms: {} })
    s = editorReducer(s, { type: 'add-occluder', libraryId: 'rack', instanceId: 'a' })
    expect(s.draft.occluders).toHaveLength(1)
    s = editorReducer(s, { type: 'undo' })
    expect(s.draft.occluders).toHaveLength(0)
    expect(s.future).toHaveLength(1)
  })

  it('redo replays', () => {
    let s = initialEditorState({ sceneId: 'x', occluders: [], groupTransforms: {} })
    s = editorReducer(s, { type: 'add-occluder', libraryId: 'rack', instanceId: 'a' })
    s = editorReducer(s, { type: 'undo' })
    s = editorReducer(s, { type: 'redo' })
    expect(s.draft.occluders).toHaveLength(1)
    expect(s.future).toHaveLength(0)
  })

  it('new mutation after undo discards future', () => {
    let s = initialEditorState({ sceneId: 'x', occluders: [], groupTransforms: {} })
    s = editorReducer(s, { type: 'add-occluder', libraryId: 'rack', instanceId: 'a' })
    s = editorReducer(s, { type: 'undo' })
    s = editorReducer(s, { type: 'add-occluder', libraryId: 'rack', instanceId: 'b' })
    expect(s.future).toHaveLength(0)
    expect(s.draft.occluders[0].instanceId).toBe('b')
  })

  it('undo on empty past is no-op', () => {
    const seed = initialEditorState({ sceneId: 'x', occluders: [], groupTransforms: {} })
    const next = editorReducer(seed, { type: 'undo' })
    expect(next).toBe(seed)
  })
})

describe('editorReducer — commit / discard', () => {
  it('commit clears history + dirty + updates baseline', () => {
    let s = initialEditorState({ sceneId: 'x', occluders: [], groupTransforms: {} })
    s = editorReducer(s, { type: 'update-group', groupId: 'g', transform: { pos: [1, 0, 0], rot: [0, 0, 0] } })
    s = editorReducer(s, { type: 'commit' })
    expect(s.past).toHaveLength(0)
    expect(s.future).toHaveLength(0)
    expect(s.dirty).toBe(false)
    expect(s.baselineGroupTransforms).toEqual({ g: { pos: [1, 0, 0], rot: [0, 0, 0] } })
  })

  it('discard clears history + dirty, keeps draft', () => {
    let s = initialEditorState({ sceneId: 'x', occluders: [], groupTransforms: {} })
    s = editorReducer(s, { type: 'update-group', groupId: 'g', transform: { pos: [1, 0, 0], rot: [0, 0, 0] } })
    const before = s.draft
    s = editorReducer(s, { type: 'discard' })
    expect(s.dirty).toBe(false)
    expect(s.past).toHaveLength(0)
    expect(s.draft).toBe(before)
  })
})
```

- [ ] **Step 2: 跑測試**

執行: `npm test -- useBigScreenEditor.reducer`
預期: 全部 passed(累計 ~17 個 case)。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useBigScreenEditor.reducer.test.ts
git commit -m "test: 補齊 editor reducer group/reset/undo/commit 測試"
```

---

## Task 5: `useBigScreenEditor` React hook

**Files:**
- Create: `frontend/src/hooks/useBigScreenEditor.ts`

純函數 reducer 已完工,本 task 寫 React 端的 hook:`useReducer` + dispatch wrapper(注入 instanceId / ts)+ commit 時的副作用(localStorage / channel / onCommit)+ sceneId 變化時 reload。

- [ ] **Step 1: 寫實作**

建立 `frontend/src/hooks/useBigScreenEditor.ts`:
```ts
/**
 * useBigScreenEditor — BigScreen 編輯模式狀態與副作用。
 * 純函數規則在 `useBigScreenEditor.reducer.ts`;本檔負責:
 *  - 把 sceneId 變化 → reducer `load-scene`。
 *  - commit 時寫兩支 localStorage、廣播 channel、呼叫 onCommit。
 *  - 包裝 dispatch 提供穩定的 wrapper API(自動補 instanceId / ts)。
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import type { SceneOccluderInstance } from '../types/sceneOccluder'
import {
  initialEditorState,
  editorReducer,
  type EditorAction,
  type EditorDraft,
  type EditorState,
  type Selection,
  type StoredGroupTransform,
} from './useBigScreenEditor.reducer'

const OCCLUDERS_KEY = 'bigscreen-scene-occluders'
const GROUP_TRANSFORMS_KEY = 'bigscreen-group-transforms'

function loadOccludersForScene(sceneId: string): SceneOccluderInstance[] {
  try {
    const all = JSON.parse(localStorage.getItem(OCCLUDERS_KEY) || '{}') as Record<string, SceneOccluderInstance[]>
    const list = all[sceneId]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function loadGroupTransformsForScene(sceneId: string): Record<string, StoredGroupTransform> {
  try {
    const all = JSON.parse(localStorage.getItem(GROUP_TRANSFORMS_KEY) || '{}') as Record<string, Record<string, StoredGroupTransform>>
    return all[sceneId] ?? {}
  } catch {
    return {}
  }
}

function buildInitialDraft(sceneId: string): EditorDraft {
  return {
    sceneId,
    occluders: loadOccludersForScene(sceneId),
    groupTransforms: loadGroupTransformsForScene(sceneId),
  }
}

export type BigScreenChannelMsg = {
  type: 'occluders-set' | 'group-transform'
  occluders?: SceneOccluderInstance[]
  groupId?: string
  groupTransform?: StoredGroupTransform
}

export interface UseBigScreenEditorOptions {
  sceneId: string
  editMode: boolean
  channel: { postMessage: (m: BigScreenChannelMsg) => void } | null
  /** 由 BigScreen 提供:commit 時用來同步 `occluderInstances` 與 `groupTransforms` 上游 state。 */
  onCommit?: (committed: EditorDraft) => void
  /** quota 等寫入失敗 → 顯示 toast。預設 alert 退路。 */
  onCommitError?: (err: unknown) => void
}

export interface BigScreenEditorApi {
  state: EditorState
  // High-level wrappers
  addOccluder: (libraryId: string) => void
  updateOccluder: (instanceId: string, patch: Partial<SceneOccluderInstance>) => void
  deleteOccluder: (instanceId: string) => void
  duplicateOccluder: (instanceId: string) => void
  updateGroup: (groupId: string, transform: StoredGroupTransform) => void
  resetItem: (kind: 'occluder' | 'group', id: string) => void
  resetScene: () => void
  select: (sel: Selection) => void
  deselect: () => void
  setGizmoMode: (mode: 'translate' | 'rotate') => void
  undo: () => void
  redo: () => void
  commit: () => void
  discard: () => void
  /** Low-level escape hatch */
  dispatch: (a: EditorAction) => void
}

export function useBigScreenEditor(opts: UseBigScreenEditorOptions): BigScreenEditorApi {
  const { sceneId, channel, onCommit, onCommitError } = opts

  const [state, dispatch] = useReducer(
    editorReducer,
    undefined as unknown as EditorState,
    () => initialEditorState(buildInitialDraft(sceneId)),
  )

  // sceneId 變化 → load-scene
  const lastSceneIdRef = useRef(sceneId)
  useEffect(() => {
    if (lastSceneIdRef.current !== sceneId) {
      lastSceneIdRef.current = sceneId
      dispatch({ type: 'load-scene', draft: buildInitialDraft(sceneId) })
    }
  }, [sceneId])

  // Commit 副作用:寫 localStorage、廣播、回呼 onCommit。
  // 用 ref 抓最新 state.draft,避免 commit 時抓到 stale 值。
  const stateRef = useRef(state)
  stateRef.current = state

  const doCommit = useCallback(() => {
    const cur = stateRef.current
    const baseline = cur.baselineGroupTransforms
    try {
      // 寫 occluders
      const allOcc = JSON.parse(localStorage.getItem(OCCLUDERS_KEY) || '{}') as Record<string, SceneOccluderInstance[]>
      allOcc[cur.draft.sceneId] = cur.draft.occluders
      localStorage.setItem(OCCLUDERS_KEY, JSON.stringify(allOcc))
      // 寫 group transforms
      const allGT = JSON.parse(localStorage.getItem(GROUP_TRANSFORMS_KEY) || '{}') as Record<string, Record<string, StoredGroupTransform>>
      allGT[cur.draft.sceneId] = cur.draft.groupTransforms
      localStorage.setItem(GROUP_TRANSFORMS_KEY, JSON.stringify(allGT))
    } catch (err) {
      onCommitError?.(err)
      return // 不更新 reducer,dirty 保留
    }

    // 廣播 occluders
    channel?.postMessage({ type: 'occluders-set', occluders: cur.draft.occluders })

    // 廣播變動的 group(對比 baseline)
    const allGroupIds = new Set([
      ...Object.keys(cur.draft.groupTransforms),
      ...Object.keys(baseline),
    ])
    for (const groupId of allGroupIds) {
      const nextT = cur.draft.groupTransforms[groupId]
      const baseT = baseline[groupId]
      const changed = !nextT || !baseT
        ? nextT !== baseT
        : (nextT.pos[0] !== baseT.pos[0] || nextT.pos[1] !== baseT.pos[1] || nextT.pos[2] !== baseT.pos[2]
          || nextT.rot[0] !== baseT.rot[0] || nextT.rot[1] !== baseT.rot[1] || nextT.rot[2] !== baseT.rot[2])
      if (changed && nextT) {
        channel?.postMessage({ type: 'group-transform', groupId, groupTransform: nextT })
      }
      // 若 group 被刪 (nextT 不存在 baseT 有) — 目前 reducer 沒有 'delete-group' action,先不發訊息
    }

    onCommit?.(cur.draft)
    dispatch({ type: 'commit' })
  }, [channel, onCommit, onCommitError])

  // Wrapper API
  const api = useMemo<BigScreenEditorApi>(() => ({
    state,
    addOccluder: (libraryId) => dispatch({ type: 'add-occluder', libraryId, instanceId: crypto.randomUUID() }),
    updateOccluder: (instanceId, patch) => dispatch({ type: 'update-occluder', instanceId, patch }),
    deleteOccluder: (instanceId) => dispatch({ type: 'delete-occluder', instanceId }),
    duplicateOccluder: (instanceId) => dispatch({ type: 'duplicate-occluder', instanceId, newInstanceId: crypto.randomUUID() }),
    updateGroup: (groupId, transform) => dispatch({ type: 'update-group', groupId, transform }),
    resetItem: (kind, id) => dispatch({ type: 'reset-item', kind, id }),
    resetScene: () => dispatch({ type: 'reset-scene' }),
    select: (sel) => dispatch({ type: 'select', sel }),
    deselect: () => dispatch({ type: 'deselect' }),
    setGizmoMode: (mode) => dispatch({ type: 'gizmo-mode', mode }),
    undo: () => dispatch({ type: 'undo' }),
    redo: () => dispatch({ type: 'redo' }),
    commit: doCommit,
    discard: () => dispatch({ type: 'discard' }),
    dispatch,
  }), [state, doCommit])

  return api
}
```

- [ ] **Step 2: 跑 build + lint**

執行: `npm run build && npm run lint`
預期: exit 0,沒有 type 錯誤。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useBigScreenEditor.ts
git commit -m "feat: useBigScreenEditor hook — reducer + commit 副作用"
```

---

## Task 6: `editorGizmo.ts` — TransformControls 薄封裝

**Files:**
- Create: `frontend/src/utils/editorGizmo.ts`

- [ ] **Step 1: 寫實作**

建立 `frontend/src/utils/editorGizmo.ts`:
```ts
/**
 * editorGizmo.ts
 *
 * 對 three.js TransformControls 的薄封裝。
 *  - attachGizmo:建立並加入 scene。
 *  - 對外只透過 setTarget / setMode 操作;dragging-changed 事件由呼叫端訂閱。
 *  - disposeGizmo:從 scene 移除並釋放。
 */
import * as THREE from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'

export type GizmoMode = 'translate' | 'rotate'

export interface GizmoHandle {
  controls: TransformControls
  setTarget: (root: THREE.Object3D | null) => void
  setMode: (mode: GizmoMode) => void
  /** 主動釋放 — caller 必須在 unmount 時呼叫。 */
  dispose: () => void
}

export function attachGizmo(
  scene: THREE.Scene,
  camera: THREE.Camera,
  domElement: HTMLElement,
  mode: GizmoMode,
): GizmoHandle {
  const controls = new TransformControls(camera, domElement)
  controls.setMode(mode)
  controls.setSpace('world')
  scene.add(controls as unknown as THREE.Object3D)

  let attached: THREE.Object3D | null = null

  const setTarget = (root: THREE.Object3D | null) => {
    if (root === attached) return
    if (attached) controls.detach()
    if (root) controls.attach(root)
    attached = root
  }

  const setMode = (m: GizmoMode) => controls.setMode(m)

  const dispose = () => {
    try { controls.detach() } catch { /* ignore */ }
    try { scene.remove(controls as unknown as THREE.Object3D) } catch { /* ignore */ }
    try { controls.dispose() } catch { /* ignore */ }
  }

  return { controls, setTarget, setMode, dispose }
}
```

- [ ] **Step 2: 確認 three.js 有此模組路徑**

執行: `node -e "import('three/examples/jsm/controls/TransformControls.js').then(() => console.log('ok')).catch(e => { console.error(e); process.exit(1) })"` (在 `frontend/`)
預期: 印出 `ok`。若找不到,改 import 為 `three/addons/controls/TransformControls.js`(較新 path)並重試。

- [ ] **Step 3: 跑 build**

執行: `npm run build`
預期: exit 0。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/utils/editorGizmo.ts
git commit -m "feat: editorGizmo — TransformControls 薄封裝"
```

---

## Task 7: `useBigScreenScene` 擴充 — placeholder slot avatars

**Files:**
- Modify: `frontend/src/hooks/useBigScreenScene.ts`

讓 hook 接受新 prop `editorPlaceholderSlots: SceneSlot[]`,為列表中每個 slot 用 `slot.defaultVrmId` spawn idle avatar,identity 為 `__placeholder__:<slotId>`。離開編輯模式時批次 remove。

- [ ] **Step 1: 加 prop 與 const**

在 `frontend/src/hooks/useBigScreenScene.ts` `UseBigScreenSceneOptions` interface 末尾加:
```ts
  /**
   * 編輯模式專用:列表中每個 slot 用 defaultVrmId spawn 一個 idle avatar。
   * Identity 自動以 `__placeholder__:<slotId>` 命名,避免與真實 participant 衝突。
   * 退出編輯模式(此 prop 變空)時批次 remove。
   */
  editorPlaceholderSlots?: import('../types/vrm').SceneSlot[];
```

在檔案頂端附近加(若尚無)`SceneSlot` import,或保持 inline import 即可。

- [ ] **Step 2: 在 hook 主體新增 const 與 effect**

在 hook 主體 `slotAssignmentsRef` 區附近加:

```ts
/** 編輯模式 placeholder avatar identity 命名空間。 */
const PLACEHOLDER_PREFIX = '__placeholder__:';
const placeholderIdentitiesRef = useRef<Set<string>>(new Set());
```

(放在檔案頂部的 `function slotX` 之上,或就近放在 interface 之後皆可,只要可被內部存取。)

把上面這個 prop 加進 destructure:
```ts
const { sceneId = DEFAULT_SCENE_ID, /* ... */ occluderInstances, editorPlaceholderSlots } = options;
```

在已有的「處理 occluderInstances 變動」effect 之後,新增一個處理 placeholder 的 effect:
```ts
// ─── Editor placeholder slot avatars ─────────────────────────────────────
useEffect(() => {
  const slots = editorPlaceholderSlots ?? [];
  const wantIds = new Set(slots.map(s => `${PLACEHOLDER_PREFIX}${s.id}`));

  // Remove placeholders no longer expected
  for (const id of placeholderIdentitiesRef.current) {
    if (!wantIds.has(id)) {
      removeAvatarInternal(id);
      placeholderIdentitiesRef.current.delete(id);
    }
  }

  // Spawn missing placeholders
  for (const slot of slots) {
    const id = `${PLACEHOLDER_PREFIX}${slot.id}`;
    if (placeholderIdentitiesRef.current.has(id)) continue;
    const vrmId = slot.defaultVrmId ?? DEFAULT_VRM_SOURCE_ID;
    const vrmUrl = (VRM_SOURCES[vrmId] ?? VRM_SOURCES[DEFAULT_VRM_SOURCE_ID]).url;
    // ensureAvatar with explicit url override; once mounted, set its base pos/rot to slot.
    void ensureAvatarInternal(id, vrmUrl, {
      position: slot.position,
      rotation: slot.rotation ?? [0, 0, 0],
    });
    placeholderIdentitiesRef.current.add(id);
  }
}, [editorPlaceholderSlots]);
```

**注意**: `removeAvatarInternal` / `ensureAvatarInternal` 名稱對應 hook 既有的內部函數(對外回傳的 `removeAvatar` / `ensureAvatar`)。實作此 task 時先讀 hook 既有 export,呼叫實際存在的名字 — 若沒有 base position override 的 ensure 介面,改為 ensure + 隨後 call `applyPoseInternal(id, idleFrame)` 或直接設 `vrm.scene.position/rotation`。

- [ ] **Step 3: Scene unmount 時清掉 placeholder**

找到既有 unmount cleanup(`for (const group of occluderPoolRef.current.values())` 附近),加:
```ts
for (const id of placeholderIdentitiesRef.current) {
  removeAvatarInternal(id);
}
placeholderIdentitiesRef.current.clear();
```

- [ ] **Step 4: 修正 speakingIdentities 與 anchor 過濾**

在 `speakingIdentitiesArray` 被讀取 / `onSpeakerAnchors` 回呼前加過濾,排除 `__placeholder__:` 開頭(避免假人觸發說話徽章):
- 找到處理 `speakingIdentities` 與 `onSpeakerAnchors` 的位置;
- 在用 identity 比對 / 寫入 anchors 前加 `if (id.startsWith('__placeholder__:')) continue;`。

(若處理散落多處,本 task 只處理直接被 `speakingIdentities` Set 使用與 `onSpeakerAnchors` 寫入處 — 兩處即可。)

- [ ] **Step 5: 跑 build + lint**

執行: `npm run build && npm run lint`
預期: exit 0。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useBigScreenScene.ts
git commit -m "feat: useBigScreenScene — placeholder slot avatars(編輯模式用)"
```

---

## Task 8: `useBigScreenScene` 擴充 — occluder root map + gizmo lifecycle

**Files:**
- Modify: `frontend/src/hooks/useBigScreenScene.ts`

對外暴露每個 occluder instance 的 root `THREE.Object3D`,讓 Overlay 知道要 attach 哪個 root;新增 `editorGizmoEnabled` prop 控制 gizmo 生命週期。

- [ ] **Step 1: 加 props**

在 `UseBigScreenSceneOptions` 末尾加:
```ts
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
```

把它們加進 destructure。

- [ ] **Step 2: 把 occluderPoolRef 同步往外通知**

在每次 occluder add/delete 完成的 effect 結尾(`occluderPoolRef.current.set(...)` 與 `.delete(...)` 兩處之後)加:
```ts
options.onOccluderRoots?.(occluderPoolRef.current);
```

或更簡單:在處理 `occluderInstances` 變動的 effect 結尾(包含異步 load 完成的 callback)各補一次 `onOccluderRoots` 呼叫。也可改為每幀 RAF 觸發,但這裡選擇事件驅動。

**注意**: 這個回呼可能會被 React rerender 反覆觸發。Overlay 端應用 `useMemo` 或 ref 來避免無限循環(下文 Task 13 會處理)。

- [ ] **Step 3: 加 gizmo lifecycle effect**

在處理 occluder 的 effect 之後加:
```ts
// ─── TransformControls gizmo lifecycle(編輯模式)──────────────────────
useEffect(() => {
  const enabled = !!options.editorGizmoEnabled;
  const scene = sceneRef.current;
  const camera = cameraRef.current;
  const renderer = rendererRef.current;
  if (!enabled || !scene || !camera || !renderer) {
    options.onGizmoHandle?.(null);
    return;
  }
  // 動態 import 避開 SSR / 同步循環
  let handle: import('../utils/editorGizmo').GizmoHandle | null = null;
  let cancelled = false;
  void import('../utils/editorGizmo').then(({ attachGizmo }) => {
    if (cancelled) return;
    handle = attachGizmo(scene, camera, renderer.domElement, 'translate');
    const onDragChange = (e: { value: boolean }) => {
      const target = (handle!.controls as unknown as { object?: import('three').Object3D }).object;
      if (!target) return;
      if (e.value) options.onGizmoDragStart?.(target);
      else options.onGizmoDragEnd?.(target);
    };
    handle.controls.addEventListener('dragging-changed', onDragChange as unknown as () => void);
    (handle as unknown as { _onDragChange: typeof onDragChange })._onDragChange = onDragChange;
    options.onGizmoHandle?.(handle);
  });
  return () => {
    cancelled = true;
    if (handle) {
      const onDragChange = (handle as unknown as { _onDragChange: () => void })._onDragChange;
      try { handle.controls.removeEventListener('dragging-changed', onDragChange); } catch { /* ignore */ }
      handle.dispose();
    }
    options.onGizmoHandle?.(null);
  };
}, [options.editorGizmoEnabled]);
```

- [ ] **Step 4: 在 occluder transform sync 處跳過 editorPinned**

找到既有「保留 → 同步 transform」分支(處理 `inst` 的位置/旋轉/縮放套用到 `existing`),在那段最前面加:
```ts
if (existing.userData.editorPinned) continue;
```

- [ ] **Step 5: 跑 build + lint**

執行: `npm run build && npm run lint`
預期: exit 0。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useBigScreenScene.ts
git commit -m "feat: useBigScreenScene — occluder root map + gizmo lifecycle"
```

---

## Task 9: `BigScreenEditorOverlay` — 框架 + 列表 + library popover

**Files:**
- Create: `frontend/src/components/BigScreenEditorOverlay.tsx`
- Create: `frontend/src/components/BigScreenEditorOverlay.css`

寫元件骨架(右側 360px 面板)、物件/群組列表、「+ 加入」popover。Transform editor 與工具列在後續 task 加。

- [ ] **Step 1: 寫元件**

建立 `frontend/src/components/BigScreenEditorOverlay.tsx`:
```tsx
import { useState } from 'react'
import type { BigScreenEditorApi } from '../hooks/useBigScreenEditor'
import type { SceneConfig } from '../types/vrm'
import { OCCLUDER_LIBRARY, OCCLUDER_LIBRARY_BY_ID } from '../config/sceneOccluders'
import { MAX_OCCLUDERS_PER_SCENE } from '../hooks/useBigScreenEditor.reducer'
import './BigScreenEditorOverlay.css'

interface Props {
  editor: BigScreenEditorApi
  scene: SceneConfig
  onExit: () => void
}

export default function BigScreenEditorOverlay({ editor, scene, onExit }: Props) {
  const { state } = editor
  const [libraryOpen, setLibraryOpen] = useState(false)

  const occluders = state.draft.occluders
  const groups = scene.groups ?? []
  const atOccluderLimit = occluders.length >= MAX_OCCLUDERS_PER_SCENE

  return (
    <div className="bs-editor-overlay" aria-label="BigScreen 編輯模式面板">
      {/* Header */}
      <div className="bs-editor-header">
        <span className="bs-editor-title">編輯模式</span>
        <button className="bs-editor-exit" onClick={onExit}>✕ 退出</button>
      </div>

      {/* Section: occluders */}
      <section className="bs-editor-section">
        <div className="bs-editor-section-header">
          <span>場景物件 ({occluders.length}/{MAX_OCCLUDERS_PER_SCENE})</span>
          <button
            className="bs-editor-btn-add"
            disabled={atOccluderLimit}
            onClick={() => setLibraryOpen(v => !v)}
            title={atOccluderLimit ? `每場景最多 ${MAX_OCCLUDERS_PER_SCENE} 個` : '加入物件'}
          >
            + 加入
          </button>
        </div>

        {libraryOpen && !atOccluderLimit && (
          <div className="bs-editor-library">
            {OCCLUDER_LIBRARY.length === 0 && (
              <div className="bs-editor-hint">尚未登錄任何遮罩物件(見 sceneOccluders.ts)</div>
            )}
            {OCCLUDER_LIBRARY.map(lib => (
              <button
                key={lib.id}
                className="bs-editor-library-item"
                onClick={() => { editor.addOccluder(lib.id); setLibraryOpen(false) }}
              >
                🪴 {lib.label}
              </button>
            ))}
          </div>
        )}

        {occluders.length === 0 && !libraryOpen && (
          <div className="bs-editor-hint">尚未加入物件</div>
        )}

        {occluders.map((inst, idx) => {
          const lib = OCCLUDER_LIBRARY_BY_ID[inst.libraryId]
          const isSelected = state.selection?.kind === 'occluder' && state.selection.id === inst.instanceId
          const sameLibBefore = occluders.slice(0, idx).filter(i => i.libraryId === inst.libraryId).length + 1
          return (
            <div
              key={inst.instanceId}
              className={`bs-editor-list-item ${isSelected ? 'bs-editor-list-item--selected' : ''}`}
              onClick={() => editor.select({ kind: 'occluder', id: inst.instanceId })}
            >
              <span>{lib ? `🪴 ${lib.label}` : '⚠ (已失效)'} <span className="bs-editor-item-suffix">#{sameLibBefore}</span></span>
              <button
                className="bs-editor-item-delete"
                onClick={(e) => { e.stopPropagation(); editor.deleteOccluder(inst.instanceId) }}
              >×</button>
            </div>
          )
        })}
      </section>

      {/* Section: groups */}
      {groups.length > 0 && (
        <section className="bs-editor-section">
          <div className="bs-editor-section-header"><span>角色群組 ({groups.length})</span></div>
          {groups.map(g => {
            const isSelected = state.selection?.kind === 'group' && state.selection.id === g.id
            return (
              <div
                key={g.id}
                className={`bs-editor-list-item ${isSelected ? 'bs-editor-list-item--selected' : ''}`}
                onClick={() => editor.select({ kind: 'group', id: g.id })}
              >
                <span>👥 {g.label}</span>
              </div>
            )
          })}
        </section>
      )}

      {/* Transform editor & toolbar — Task 10 / Task 11 加入 */}
      <section className="bs-editor-section bs-editor-placeholder-section">
        (transform editor 待 Task 10 加入)
      </section>
    </div>
  )
}
```

- [ ] **Step 2: 寫 CSS**

建立 `frontend/src/components/BigScreenEditorOverlay.css`:
```css
.bs-editor-overlay {
  position: fixed;
  top: 0;
  right: 0;
  width: 360px;
  height: 100vh;
  background: rgba(15, 12, 10, 0.92);
  color: #fff;
  font: 13px/1.4 system-ui, sans-serif;
  z-index: 999;
  overflow-y: auto;
  backdrop-filter: blur(8px);
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  pointer-events: auto;
}

.bs-editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.bs-editor-title { font-weight: 700; color: #ffb347; letter-spacing: 0.5px; }
.bs-editor-exit {
  background: transparent;
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
}
.bs-editor-exit:hover { background: rgba(255, 255, 255, 0.08); }

.bs-editor-section { padding: 12px 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
.bs-editor-section-header {
  display: flex; justify-content: space-between; align-items: center;
  font-weight: 700; margin-bottom: 8px; color: #d8c8b8;
}
.bs-editor-btn-add {
  background: #f76e12; color: #fff; border: none; border-radius: 6px;
  padding: 4px 10px; cursor: pointer; font-weight: 700;
}
.bs-editor-btn-add:disabled { opacity: 0.4; cursor: not-allowed; }

.bs-editor-library { background: rgba(0, 0, 0, 0.35); border-radius: 6px; padding: 6px; margin-bottom: 8px; }
.bs-editor-library-item {
  display: block; width: 100%; text-align: left;
  background: transparent; color: #fff; border: none; border-radius: 4px;
  padding: 6px 8px; cursor: pointer;
}
.bs-editor-library-item:hover { background: rgba(255, 255, 255, 0.08); }

.bs-editor-list-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 8px; border-radius: 4px; cursor: pointer;
}
.bs-editor-list-item:hover { background: rgba(255, 255, 255, 0.06); }
.bs-editor-list-item--selected { background: rgba(247, 110, 18, 0.18); }
.bs-editor-item-suffix { opacity: 0.55; margin-left: 4px; }
.bs-editor-item-delete {
  background: transparent; color: #fff; border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 4px; padding: 1px 6px; cursor: pointer;
}

.bs-editor-hint { opacity: 0.6; font-style: italic; padding: 4px 8px; }
.bs-editor-placeholder-section { opacity: 0.4; font-style: italic; }
```

- [ ] **Step 3: 跑 build + lint**

執行: `npm run build && npm run lint`
預期: exit 0。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/BigScreenEditorOverlay.tsx \
        frontend/src/components/BigScreenEditorOverlay.css
git commit -m "feat: BigScreenEditorOverlay 骨架 — 列表 + library popover"
```

---

## Task 10: `BigScreenEditorOverlay` — transform editor

**Files:**
- Modify: `frontend/src/components/BigScreenEditorOverlay.tsx`
- Modify: `frontend/src/components/BigScreenEditorOverlay.css`

加「選中變換」區:選 occluder 顯示 X/Y/Z/Yaw/Scale + 重置/複製/刪除;選 group 顯示 X/Y/Z/Pitch/Yaw/Roll + 重置。

- [ ] **Step 1: 加 helpers**

在 `BigScreenEditorOverlay.tsx` 頂部 import 之後加:
```ts
const RAD2DEG = 180 / Math.PI
const DEG2RAD = Math.PI / 180

function NumberRow({
  label, min, max, step, value, onChange,
}: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <div className="bs-editor-row">
      <label>{label}</label>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}
```

- [ ] **Step 2: 加 transform editor 元件**

在 `BigScreenEditorOverlay.tsx` 末尾(`export default function` 之後)加:
```tsx
function OccluderEditor({ editor }: { editor: BigScreenEditorApi }) {
  const sel = editor.state.selection
  if (sel?.kind !== 'occluder') return null
  const inst = editor.state.draft.occluders.find(o => o.instanceId === sel.id)
  if (!inst) return null
  const lib = OCCLUDER_LIBRARY_BY_ID[inst.libraryId]
  const update = (patch: Partial<typeof inst>) => editor.updateOccluder(inst.instanceId, patch)
  return (
    <section className="bs-editor-section">
      <div className="bs-editor-section-header"><span>選中變換 — {lib?.label ?? '(已失效)'}</span></div>
      <NumberRow label="X" min={-5} max={5} step={0.05}
        value={inst.position[0]} onChange={v => update({ position: [v, inst.position[1], inst.position[2]] })} />
      <NumberRow label="Y" min={-5} max={5} step={0.05}
        value={inst.position[1]} onChange={v => update({ position: [inst.position[0], v, inst.position[2]] })} />
      <NumberRow label="Z" min={-5} max={5} step={0.05}
        value={inst.position[2]} onChange={v => update({ position: [inst.position[0], inst.position[1], v] })} />
      <NumberRow label="Yaw(°)" min={-180} max={180} step={1}
        value={Math.round(inst.rotation[1] * RAD2DEG * 100) / 100}
        onChange={deg => update({ rotation: [inst.rotation[0], deg * DEG2RAD, inst.rotation[2]] })} />
      <NumberRow label="Scale" min={0.1} max={5} step={0.05}
        value={inst.scale} onChange={v => update({ scale: v })} />
      <div className="bs-editor-actions">
        <button className="bs-editor-btn-secondary" onClick={() => editor.resetItem('occluder', inst.instanceId)}>↺ 單一重置</button>
        <button className="bs-editor-btn-secondary" onClick={() => editor.duplicateOccluder(inst.instanceId)}>⎘ 複製</button>
        <button className="bs-editor-btn-danger" onClick={() => editor.deleteOccluder(inst.instanceId)}>🗑 刪除</button>
      </div>
    </section>
  )
}

function GroupEditor({ editor, scene }: { editor: BigScreenEditorApi; scene: SceneConfig }) {
  const sel = editor.state.selection
  if (sel?.kind !== 'group') return null
  const g = scene.groups?.find(x => x.id === sel.id)
  if (!g) return null
  const t = editor.state.draft.groupTransforms[g.id] ?? { pos: [0, 0, 0] as [number, number, number], rot: [0, 0, 0] as [number, number, number] }
  const setT = (next: typeof t) => editor.updateGroup(g.id, next)
  return (
    <section className="bs-editor-section">
      <div className="bs-editor-section-header"><span>選中變換 — {g.label}</span></div>
      <NumberRow label="X" min={-5} max={5} step={0.05}
        value={t.pos[0]} onChange={v => setT({ ...t, pos: [v, t.pos[1], t.pos[2]] })} />
      <NumberRow label="Y" min={-5} max={5} step={0.05}
        value={t.pos[1]} onChange={v => setT({ ...t, pos: [t.pos[0], v, t.pos[2]] })} />
      <NumberRow label="Z" min={-5} max={5} step={0.05}
        value={t.pos[2]} onChange={v => setT({ ...t, pos: [t.pos[0], t.pos[1], v] })} />
      <NumberRow label="Pitch(°)" min={-180} max={180} step={1}
        value={Math.round(t.rot[0] * RAD2DEG * 100) / 100}
        onChange={deg => setT({ ...t, rot: [deg * DEG2RAD, t.rot[1], t.rot[2]] })} />
      <NumberRow label="Yaw(°)" min={-180} max={180} step={1}
        value={Math.round(t.rot[1] * RAD2DEG * 100) / 100}
        onChange={deg => setT({ ...t, rot: [t.rot[0], deg * DEG2RAD, t.rot[2]] })} />
      <NumberRow label="Roll(°)" min={-180} max={180} step={1}
        value={Math.round(t.rot[2] * RAD2DEG * 100) / 100}
        onChange={deg => setT({ ...t, rot: [t.rot[0], t.rot[1], deg * DEG2RAD] })} />
      <div className="bs-editor-actions">
        <button className="bs-editor-btn-secondary" onClick={() => editor.resetItem('group', g.id)}>↺ 單一重置</button>
      </div>
    </section>
  )
}
```

- [ ] **Step 3: 接到主元件**

把主元件裡的「(transform editor 待 Task 10 加入)」整段 `<section>` 換成:
```tsx
<OccluderEditor editor={editor} />
<GroupEditor editor={editor} scene={scene} />
```

- [ ] **Step 4: 補 CSS**

在 `BigScreenEditorOverlay.css` 末尾加:
```css
.bs-editor-row {
  display: grid; grid-template-columns: 60px 1fr 64px; gap: 8px; align-items: center;
  padding: 3px 0;
}
.bs-editor-row label { font-size: 11px; opacity: 0.7; }
.bs-editor-row input[type="number"] {
  background: rgba(255, 255, 255, 0.06); color: #fff; border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px; padding: 2px 4px; width: 100%; font: inherit;
}
.bs-editor-row input[type="range"] { width: 100%; }

.bs-editor-actions {
  display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap;
}
.bs-editor-btn-secondary, .bs-editor-btn-danger {
  background: rgba(255, 255, 255, 0.08); color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 6px;
  padding: 4px 10px; cursor: pointer;
}
.bs-editor-btn-danger { background: rgba(220, 53, 69, 0.25); border-color: rgba(220, 53, 69, 0.5); }
```

- [ ] **Step 5: 跑 build + lint**

執行: `npm run build && npm run lint`
預期: exit 0。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/BigScreenEditorOverlay.tsx \
        frontend/src/components/BigScreenEditorOverlay.css
git commit -m "feat: BigScreenEditorOverlay — occluder / group transform 編輯區"
```

---

## Task 11: `BigScreenEditorOverlay` — 工具列 + gizmo 串接

**Files:**
- Modify: `frontend/src/components/BigScreenEditorOverlay.tsx`
- Modify: `frontend/src/components/BigScreenEditorOverlay.css`

加 toolbar(undo / redo / 移動 / 旋轉 / 保存 / 場景重置)、dirty 提示、gizmo handle + occluder root map props 串接。

- [ ] **Step 1: 擴展 props**

把 `Props` interface 改為:
```ts
import type { GizmoHandle } from '../utils/editorGizmo'
import type { Object3D } from 'three'

interface Props {
  editor: BigScreenEditorApi
  scene: SceneConfig
  onExit: () => void
  gizmoHandle: GizmoHandle | null
  occluderRoots: ReadonlyMap<string, Object3D>
}
```

- [ ] **Step 2: 加 toolbar**

在 header 之後、`場景物件` section 之前插入:
```tsx
<div className="bs-editor-toolbar">
  {editor.state.selection?.kind === 'occluder' && (
    <>
      <button
        className={`bs-editor-tb-btn ${editor.state.gizmoMode === 'translate' ? 'bs-editor-tb-btn--active' : ''}`}
        onClick={() => editor.setGizmoMode('translate')}
        title="移動 (Translate)"
      >↔</button>
      <button
        className={`bs-editor-tb-btn ${editor.state.gizmoMode === 'rotate' ? 'bs-editor-tb-btn--active' : ''}`}
        onClick={() => editor.setGizmoMode('rotate')}
        title="旋轉 (Rotate)"
      >↻</button>
      <span className="bs-editor-tb-sep" />
    </>
  )}
  <button className="bs-editor-tb-btn" disabled={editor.state.past.length === 0} onClick={editor.undo} title="Undo (Ctrl+Z)">↶</button>
  <button className="bs-editor-tb-btn" disabled={editor.state.future.length === 0} onClick={editor.redo} title="Redo (Ctrl+Shift+Z)">↷</button>
</div>
```

- [ ] **Step 3: 加底部「保存 / 場景重置」**

在最末尾 `</div>`(`bs-editor-overlay` 收尾)之前加:
```tsx
<section className="bs-editor-footer">
  {editor.state.dirty && <div className="bs-editor-dirty-hint">⚠ 未保存變動</div>}
  <button
    className="bs-editor-btn-primary"
    disabled={!editor.state.dirty}
    onClick={editor.commit}
  >💾 保存</button>
  <button
    className="bs-editor-btn-secondary"
    onClick={() => { if (confirm('將清除此場景所有自訂(物件實例 + 群組變換)。確定?')) editor.resetScene() }}
  >↺ 場景重置</button>
</section>
```

- [ ] **Step 4: Gizmo target 同步**

在元件主體最頂端加 `useEffect`(緊接著 `const { state } = editor` 之後):
```tsx
useEffect(() => {
  if (!gizmoHandle) return
  const sel = state.selection
  if (sel?.kind === 'occluder') {
    const root = occluderRoots.get(sel.id) ?? null
    gizmoHandle.setTarget(root)
  } else {
    gizmoHandle.setTarget(null)
  }
}, [gizmoHandle, occluderRoots, state.selection])

useEffect(() => {
  gizmoHandle?.setMode(state.gizmoMode)
}, [gizmoHandle, state.gizmoMode])
```

並補上 import:
```ts
import { useEffect, useState } from 'react'
```

- [ ] **Step 5: 補 CSS**

在 `BigScreenEditorOverlay.css` 末尾加:
```css
.bs-editor-toolbar {
  display: flex; gap: 6px; padding: 8px 16px; align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.bs-editor-tb-btn {
  background: rgba(255, 255, 255, 0.06); color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 6px;
  padding: 4px 10px; cursor: pointer; min-width: 32px;
}
.bs-editor-tb-btn--active { background: #f76e12; border-color: #f76e12; }
.bs-editor-tb-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.bs-editor-tb-sep { width: 1px; height: 18px; background: rgba(255, 255, 255, 0.1); margin: 0 4px; }

.bs-editor-footer {
  position: sticky; bottom: 0;
  display: flex; flex-direction: column; gap: 6px;
  padding: 12px 16px;
  background: rgba(0, 0, 0, 0.6); border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.bs-editor-dirty-hint { color: #ffb347; font-weight: 700; }
.bs-editor-btn-primary {
  background: #f76e12; color: #fff; border: none; border-radius: 6px;
  padding: 8px 14px; cursor: pointer; font-weight: 700;
}
.bs-editor-btn-primary:disabled { opacity: 0.35; cursor: not-allowed; }
```

- [ ] **Step 6: 跑 build + lint**

執行: `npm run build && npm run lint`
預期: exit 0。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/BigScreenEditorOverlay.tsx \
        frontend/src/components/BigScreenEditorOverlay.css
git commit -m "feat: BigScreenEditorOverlay — toolbar / 保存 / gizmo 串接"
```

---

## Task 12: `BigScreen.tsx` — mode toggle + effective values + placeholder slots

**Files:**
- Modify: `frontend/src/components/BigScreen.tsx`

把編輯模式 state + URL/E 鍵/✏️ 鈕 toggle 接上,以 `editor` API 計算 effective occluders / group transforms,並把 placeholder slots 傳給 `useBigScreenScene`。Channel guard / commit sync / dirty confirms 在下一個 task。

- [ ] **Step 1: 加 import**

在 `BigScreen.tsx` import 區加:
```ts
import { useBigScreenEditor } from '../hooks/useBigScreenEditor';
import BigScreenEditorOverlay from './BigScreenEditorOverlay';
import type { GizmoHandle } from '../utils/editorGizmo';
import type { Object3D } from 'three';
```

- [ ] **Step 2: 加 mode state**

在 `BigScreen` 元件最頂端、`useState<sceneId>` 附近加:
```ts
// 編輯模式
const initialEditMode = (() => {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('mode') === 'edit';
  } catch { return false; }
})();
const [editMode, setEditMode] = useState<boolean>(initialEditMode);
```

- [ ] **Step 3: 建立 BroadcastChannel ref(若 BigScreen 沒有就加)**

`BigScreen.tsx` 已有讀 channel 的 effect。在現有 channel 建立處(`new BroadcastChannel(BIGSCREEN_CHANNEL_NAME)`)取出 ref 對外:`const channelRef = useRef<BroadcastChannel | null>(null);` 並在 useEffect 中設 `channelRef.current = ch;`。若已有等價 ref,直接重用。

- [ ] **Step 4: 接 useBigScreenEditor**

在 channelRef 之後加:
```ts
const editor = useBigScreenEditor({
  sceneId,
  editMode,
  channel: channelRef.current,
  onCommit: (committed) => {
    // 同步上游 state,讓退出編輯模式後 fall back 正確
    setOccluderInstances(committed.occluders);
    setGroupTransforms(committed.groupTransforms);
  },
  onCommitError: (err) => {
    console.warn('[BigScreen] commit failed:', err);
    alert('保存失敗 — localStorage 可能配額已滿。請刪除一些物件後再試。');
  },
});
```

- [ ] **Step 5: 計算 effective values**

在 `useBigScreenScene` 的 call 之前加:
```ts
const effectiveOccluders = editMode ? editor.state.draft.occluders : occluderInstances;
const effectiveGroupTransforms = editMode ? editor.state.draft.groupTransforms : groupTransforms;

const placeholderSlots = useMemo(() => {
  if (!editMode) return [];
  const preset = SCENE_PRESETS[sceneId] ?? SCENE_PRESETS[DEFAULT_SCENE_ID];
  return (preset.slots ?? []).filter(s => !slotAssignments[s.id]);
}, [editMode, sceneId, slotAssignments]);
```

- [ ] **Step 6: 把它們傳給 hook**

把 `useBigScreenScene` 的 `occluderInstances` / `groupTransforms` 參數改為 effective 版本,並加 `editorPlaceholderSlots`、`editorGizmoEnabled`、`onGizmoHandle`、`onOccluderRoots`、`onGizmoDragStart`、`onGizmoDragEnd`:

```ts
const [gizmoHandle, setGizmoHandle] = useState<GizmoHandle | null>(null);
const [occluderRoots, setOccluderRoots] = useState<ReadonlyMap<string, Object3D>>(new Map());

const { applyPose, removeAvatar, swapAvatar, setVrmOverride, ensureAvatar } = useBigScreenScene(canvasRef, {
  sceneId,
  vrmSourceId,
  slotAssignments,
  currentTaskId,
  onScenePropsReady: () => bumpBootUnit('props'),
  renderFpsLimit: renderFps,
  isRecording: isActivelyRecording,
  onPostRenderRef: postRenderRef,
  groupTransforms: effectiveGroupTransforms,
  speakingIdentities: speakingIdentitiesArray,
  onSpeakerAnchors: setSpeakerAnchors,
  occluderInstances: effectiveOccluders,
  editorPlaceholderSlots: placeholderSlots,
  editorGizmoEnabled: editMode,
  onGizmoHandle: setGizmoHandle,
  onOccluderRoots: setOccluderRoots,
  onGizmoDragStart: (target) => { target.userData.editorPinned = true; },
  onGizmoDragEnd: (target) => {
    target.userData.editorPinned = false;
    const sel = editor.state.selection;
    if (sel?.kind === 'occluder') {
      editor.updateOccluder(sel.id, {
        position: [target.position.x, target.position.y, target.position.z],
        rotation: [target.rotation.x, target.rotation.y, target.rotation.z],
      });
    }
  },
});
```

(對應上面已宣告過的變數;確保整段 destructure 區與 hook arg 一致。)

- [ ] **Step 7: 加 'E' 鍵 toggle + ✏️ 按鈕**

在 `BigScreen.tsx` 既有 keydown handler 區附近加:
```ts
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'e' || e.key === 'E') {
      // dirty guard 在 Task 13;先簡單 toggle
      setEditMode(v => !v);
    } else if (e.ctrlKey && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      if (editMode) { e.preventDefault(); editor.undo(); }
    } else if (e.ctrlKey && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      if (editMode) { e.preventDefault(); editor.redo(); }
    } else if (e.key === 'Escape') {
      if (editMode) {
        if (editor.state.selection) editor.deselect();
        else setEditMode(false);
      }
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [editMode, editor]);
```

在 JSX 中找一個合適位置(左上 16/16),加按鈕:
```tsx
<button
  className="bs-editmode-toggle"
  title={editMode ? '退出編輯模式 (E)' : '進入編輯模式 (E)'}
  onClick={() => setEditMode(v => !v)}
  style={{
    position: 'absolute', top: 16, left: 16, zIndex: 60,
    background: editMode ? '#f76e12' : 'rgba(0,0,0,0.5)',
    color: '#fff', border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: 8, padding: '6px 12px', cursor: 'pointer',
  }}
>{editMode ? '✕ 退出編輯' : '✏️ 編輯'}</button>
```

(若已有相似 dev 按鈕,就近放置。)

- [ ] **Step 8: 掛 Overlay**

在 BigScreen JSX 末尾(`</div>` 之前)加:
```tsx
{editMode && (
  <BigScreenEditorOverlay
    editor={editor}
    scene={SCENE_PRESETS[sceneId] ?? SCENE_PRESETS[DEFAULT_SCENE_ID]}
    onExit={() => setEditMode(false)}
    gizmoHandle={gizmoHandle}
    occluderRoots={occluderRoots}
  />
)}
```

- [ ] **Step 9: 跑 build + lint**

執行: `npm run build && npm run lint`
預期: exit 0。

- [ ] **Step 10: 手動驗證**

執行: `cd frontend && npm run dev`,在另一個視窗開 `http://localhost:5173/?screen=bigscreen&mode=edit`(或本機對應 port)。

預期:
- 右側 360px 編輯面板出現,顯示「場景物件 (0/10)」「角色群組」。
- 按「+ 加入」popover 出現 library;點「衣架」後場景出現一個衣架物件,列表多一項。
- 拖 gizmo 箭頭 — 衣架位置變動。
- 切去顯示模式 URL(`?screen=bigscreen`)→ 編輯面板消失。

- [ ] **Step 11: Commit**

```bash
git add frontend/src/components/BigScreen.tsx
git commit -m "feat: BigScreen — 編輯模式 toggle + Overlay 接線 + gizmo 串接"
```

---

## Task 13: `BigScreen.tsx` — channel guard + dirty confirms + scene-change

**Files:**
- Modify: `frontend/src/components/BigScreen.tsx`

讓編輯模式忽略自送的 `'occluders-set'` / `'group-transform'` channel 訊息;加 dirty 守門(E 鍵退出 / beforeunload / 切場景)。

- [ ] **Step 1: Channel guard**

找到 BigScreen 中處理 `'occluders-set'` 與 `'group-transform'` 兩種訊息的 handler。各自在最開頭加:
```ts
if (editModeRef.current) return;
```

並在 mode state 旁加 ref:
```ts
const editModeRef = useRef(editMode);
useEffect(() => { editModeRef.current = editMode; }, [editMode]);
```

(若 handler 在外層的 useEffect 內透過 closure 抓 editMode,改成讀 ref 才能取到最新值。)

- [ ] **Step 2: E 鍵 dirty guard**

把 Task 12 加入的 'E' / Esc 與按鈕 toggle 改為:
```ts
const tryExitEditMode = useCallback(() => {
  if (editor.state.dirty) {
    if (!confirm('未保存的變動會丟失,確定退出編輯模式?')) return;
    editor.discard();
  }
  setEditMode(false);
}, [editor]);
```

並在 keydown handler / Esc / ✏️ 鈕 onClick 換成:
```ts
if (e.key === 'e' || e.key === 'E') {
  if (editMode) tryExitEditMode(); else setEditMode(true);
}
```

按鈕 onClick:
```tsx
onClick={() => { editMode ? tryExitEditMode() : setEditMode(true); }}
```

Overlay 的 `onExit` 也指向 `tryExitEditMode`。

- [ ] **Step 3: beforeunload guard**

加:
```ts
useEffect(() => {
  if (!editMode) return;
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!editor.state.dirty) return;
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  return () => window.removeEventListener('beforeunload', onBeforeUnload);
}, [editMode, editor.state.dirty]);
```

- [ ] **Step 4: scene-change dirty guard**

找到 BigScreen 處理 `'scene-change'` 訊息的 handler(更新 `setSceneId(msg.sceneId)`),在 setSceneId 之前加:
```ts
if (editModeRef.current && editor.state.dirty) {
  if (!confirm('編輯模式中有未保存變動,確定切換場景?(變動會丟失)')) return;
  editor.discard();
}
```

(`editor.state.dirty` 需要透過 ref 或當前 closure 抓 — 如 closure 不易抓,可額外加 `editorDirtyRef`。)

加 ref(放在 editModeRef 附近):
```ts
const editorDirtyRef = useRef(false);
useEffect(() => { editorDirtyRef.current = editor.state.dirty; }, [editor.state.dirty]);
```

然後 scene-change handler 用 `editorDirtyRef.current` 與 `editor.discard()` 即可。

- [ ] **Step 5: 跑 build + lint**

執行: `npm run build && npm run lint`
預期: exit 0。

- [ ] **Step 6: 手動驗證**

`npm run dev`,在 `?screen=bigscreen&mode=edit` 視窗:
- 加一個 occluder(dirty 變 true)→ 按 E → 跳 confirm → 取消 → 保留編輯模式 + 變動。
- 同上 → 確認 → 退出編輯模式,且編輯內容丟失(occluder 沒寫進 localStorage)。
- 加一個 occluder → 在 HostSession 切場景 → 跳 confirm。
- 加一個 occluder → 關閉視窗 → 瀏覽器原生確認對話框。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/BigScreen.tsx
git commit -m "feat: BigScreen — channel guard + dirty 守門(E/scene-change/beforeunload)"
```

---

## Task 14: `HostSession.tsx` — FAB 下拉選單(顯示 / 編輯)

**Files:**
- Modify: `frontend/src/components/HostSession.tsx`
- Modify: 既有 stylesheet(找到 `.hs-bigscreen-fab` 樣式位置)

把 FAB 從「點擊直接開」改為「點擊展開兩項 popover」,把 `openBigScreen` 改為接受 mode 參數。

- [ ] **Step 1: 加 menu state**

在 `HostSession` 元件其他 `useState` 附近加:
```ts
const [bigScreenMenuOpen, setBigScreenMenuOpen] = useState(false);
```

- [ ] **Step 2: 改 openBigScreen 簽名**

把現有 `openBigScreen` callback 改為接受 mode:
```ts
const openBigScreen = useCallback((mode: 'display' | 'edit' = 'display') => {
  try {
    sessionStorage.setItem('bigscreen-roomId', roomId);
    sessionStorage.setItem('bigscreen-snapshot', JSON.stringify(poseSnapshotRef.current));
    sessionStorage.setItem('bigscreen-sceneId', selectedSceneId);
    if (selectedVrmSourceId) sessionStorage.setItem('bigscreen-vrmSourceId', selectedVrmSourceId);
    else sessionStorage.removeItem('bigscreen-vrmSourceId');
    if (teacherVrmSourceId) sessionStorage.setItem('bigscreen-teacherVrmSourceId', teacherVrmSourceId);
    else sessionStorage.removeItem('bigscreen-teacherVrmSourceId');
    sessionStorage.setItem('bigscreen-slotAssignments', JSON.stringify(slotAssignments));
    sessionStorage.setItem('bigscreen-tasks', JSON.stringify(selectedTasks));
    sessionStorage.setItem('bigscreen-hintEnabled', JSON.stringify(hintEnabled));
    sessionStorage.setItem('bigscreen-hintLevel', JSON.stringify(hintLevel));
  } catch {/* ignore */}

  const url = `${window.location.origin}/?screen=bigscreen${mode === 'edit' ? '&mode=edit' : ''}`;
  const win = window.open(url, mode === 'edit' ? 'live-mr-bigscreen-edit' : 'live-mr-bigscreen', 'width=1280,height=720,menubar=no,toolbar=no');
  bigScreenWindowRef.current = win;
}, [selectedSceneId, selectedVrmSourceId, teacherVrmSourceId, slotAssignments, selectedTasks, roomId, hintEnabled, hintLevel]);
```

- [ ] **Step 3: 改 FAB JSX**

找到 `id="open-bigscreen-btn"` 的 `<button>`,整段換成:
```tsx
<div className="hs-bigscreen-fab-wrap">
  {bigScreenMenuOpen && (
    <div className="hs-bigscreen-fab-menu">
      <button
        className="hs-bigscreen-fab-menu-item"
        onClick={() => { openBigScreen('display'); setBigScreenMenuOpen(false); }}
      >
        <span className="material-symbols-outlined">visibility</span> 顯示模式
      </button>
      <button
        className="hs-bigscreen-fab-menu-item"
        onClick={() => { openBigScreen('edit'); setBigScreenMenuOpen(false); }}
      >
        <span className="material-symbols-outlined">edit</span> 編輯模式
      </button>
    </div>
  )}
  <button
    id="open-bigscreen-btn"
    className="hs-bigscreen-fab"
    onClick={() => setBigScreenMenuOpen(v => !v)}
    title="在新視窗開啟大屏"
  >
    <span className="material-symbols-outlined">rocket_launch</span>
    <span className="hs-fab-label">開啟大屏</span>
  </button>
</div>
```

- [ ] **Step 4: 加 CSS**

找到 `.hs-bigscreen-fab` 的 stylesheet(`HostSession.css` 或合併樣式檔)位置,加:
```css
.hs-bigscreen-fab-wrap { position: relative; }
.hs-bigscreen-fab-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  background: rgba(15, 12, 10, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 160px;
  z-index: 100;
  backdrop-filter: blur(8px);
}
.hs-bigscreen-fab-menu-item {
  display: flex; align-items: center; gap: 8px;
  background: transparent; color: #fff;
  border: none; border-radius: 6px;
  padding: 8px 10px;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.hs-bigscreen-fab-menu-item:hover { background: rgba(247, 110, 18, 0.18); }
```

- [ ] **Step 5: 點外部關 menu**

在 `BigScreenMenuOpen` state 旁加 effect:
```ts
useEffect(() => {
  if (!bigScreenMenuOpen) return;
  const onDown = (e: MouseEvent) => {
    const t = e.target as HTMLElement | null;
    if (!t?.closest('.hs-bigscreen-fab-wrap')) setBigScreenMenuOpen(false);
  };
  window.addEventListener('mousedown', onDown);
  return () => window.removeEventListener('mousedown', onDown);
}, [bigScreenMenuOpen]);
```

- [ ] **Step 6: 跑 build + lint**

執行: `npm run build && npm run lint`
預期: exit 0。

- [ ] **Step 7: 手動驗證**

`npm run dev`,在 HostSession 頁點右下 FAB:
- 出現兩項 menu。
- 點「顯示模式」→ 開新視窗 URL `?screen=bigscreen`,沒有編輯面板。
- 點「編輯模式」→ 開另一個新視窗 URL `?screen=bigscreen&mode=edit`,出現編輯面板。
- 點 menu 外部 → 收起。

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/HostSession.tsx frontend/src/components/HostSession.css
# 若樣式合併在其他檔,改檔名
git commit -m "feat: HostSession FAB — 顯示 / 編輯雙模式下拉"
```

---

## Task 15: 舊 drawer 補 hint + 端到端手動驗證

**Files:**
- Modify: `frontend/src/components/SceneOccludersPanel.tsx`
- Modify: `frontend/src/components/SceneEditor.tsx`

- [ ] **Step 1: SceneOccludersPanel hint**

在 `<div className="panel-drawer-header">` 內、`<button className="panel-close-btn">` 之前加:
```tsx
<div className="scene-editor-hint" style={{ marginRight: 8, fontSize: 11 }}>
  💡 在大屏編輯模式可整合調整
</div>
```

- [ ] **Step 2: SceneEditor hint**

在 `<div className="panel-drawer-header">` 內、`<button className="panel-close-btn">` 之前加同樣的 hint。

- [ ] **Step 3: 跑 build + lint + 全部測試**

執行(在 `frontend/`):
```bash
npm run lint && npm run build && npm test
```
預期: 全部 exit 0;測試全 passed。

- [ ] **Step 4: 端到端手動驗證(spec §7)**

`npm run dev`,在兩個 BigScreen 視窗驗證 spec 中表列的每一項:

1. **Undo coalesce**: 編輯視窗加一個 occluder → 連續拖動 Yaw 滑桿 5 次(<400ms 間隔)→ 按 Undo → 衣架應該回到加入時的位置,而不是只回上一格。
2. **Undo 結構**: add / delete / duplicate / reset-item / reset-scene 各一次後,Undo 5 次應回到空。
3. **Commit 清空**: 任意動 → 保存 → toolbar 上 Undo / Redo 都 disabled,「⚠ 未保存變動」消失。
4. **Dirty 守門**: 加一個 occluder 後分別測試 — 按 E、按 ✕、關視窗、教師端切場景,全部都跳 confirm。
5. **Placeholder 隔離**: 進編輯模式 → 兩個 slot 都有人;退出 → 沒指派的 slot 空(真實學生不受影響);讓教師講話 → 不會在 placeholder 頭上出現徽章。
6. **廣播一致**: A 視窗開顯示模式 + B 視窗開編輯模式 + B 視窗加 occluder + 保存 → A 視窗即時看到新物件。
7. **失效 library**: 暫時把 `OCCLUDER_LIBRARY` 的 `rack` entry 註解掉 → 重整 → 已有的衣架在列表變「⚠ (已失效)」、只能刪、不會 attach gizmo。(測完還原)
8. **Gizmo 切換**: 選 occluder → gizmo 出現;選 group → gizmo 消失;切回 occluder → 重新 attach。
9. **Gizmo undo**: 拖 gizmo 從 A → B → 放手 → 按 Undo 一次 → 回到 A 位置。
10. **Quota 失敗**(可選): chrome devtools 改 storage 配額,commit → 警告 toast,dirty 保留。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SceneOccludersPanel.tsx \
        frontend/src/components/SceneEditor.tsx
git commit -m "docs: 舊 drawer 加上「大屏編輯模式可整合調整」提示"
```

---

## Self-Review

**Spec coverage:**
- §2 進入路徑 → Task 12(URL/E/✏️)、Task 14(FAB menu)。
- §3 編輯狀態(reducer / undo / commit / discard / reset)→ Task 3 / 4 / 5。
- §4 渲染層 placeholder → Task 7;Gizmo → Task 6 / 8;Overlay 三段 → Task 9 / 10 / 11。
- §5 邊緣行為 selection 失效 → Task 3 reducer;切場景 → Task 13;quota 失敗 → Task 5 hook;失效 library → Task 9 + Task 15 手動。
- §6 檔案清單全部對應到 Tasks。
- §7 測試重點 → Task 15 手動清單覆蓋。

**Placeholder scan:** 無 TBD / TODO;每段都有具體 code。

**Type consistency:**
- `EditorDraft` / `Selection` / `EditorAction` 在 Task 3 定義,後續 Task 4 / 5 / 9 / 10 / 11 使用一致。
- `defaultOccluderTransform` 在 Task 2 命名,Task 3 reducer / Task 5 hook / Task 10 transform editor 重置邏輯都用此名(reducer 內部 call 同名 export)。
- `MAX_OCCLUDERS_PER_SCENE` 從 Task 3 reducer export,Task 9 Overlay 重用同一名字(本 plan 移除原 `SceneOccludersPanel.tsx` 中的 const 並改 import 此處;Task 2 已先做 import 重構基礎)。注意 Task 2 沒做這條重構,而 `SceneOccludersPanel.tsx` 自己有 `export const MAX_OCCLUDERS_PER_SCENE`;Task 9 為避免循環 import,改從 reducer 拿。原 panel 那一行可保留,兩個常數值相同。
- `useBigScreenEditor` 與 `BigScreenEditorApi` 在 Task 5 export,Overlay (Task 9–11) 與 BigScreen.tsx (Task 12) import 同名。
- `GizmoHandle` 在 Task 6 export,Task 8 / 11 / 12 用同名。
- `onGizmoHandle` / `onOccluderRoots` / `onGizmoDragStart` / `onGizmoDragEnd` / `editorPlaceholderSlots` / `editorGizmoEnabled` 五個新 props 在 Task 7 / 8 加入,Task 12 餵入 — 名字一致。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-05-bigscreen-edit-mode.md`. Two execution options:

**1. Subagent-Driven (recommended)** — 分派一個 fresh subagent 跑一個 task,我在 task 之間 review;適合這種 15 個 task 的長計畫。
**2. Inline Execution** — 在這個 session 中分批跑 task,checkpoint 由我控制。
