# BigScreen 編輯模式 — 設計書

- **日期**: 2026-06-05
- **目標**: 在現有大屏顯示之上疊加一個「編輯模式」,讓教師在實際渲染場景中整合調整「場景遮罩/裝飾物件(occluder)」與「角色群組變換(group transform)」,具備素材庫、列表選取、面板與 3D Gizmo 調整、多步 undo/redo、單一重置、場景重置與顯式保存。
- **不動**: 場景設定檔(`SCENE_PRESETS` / `THEMES`)、廣播訊息協定、教師端錄製/AI 助理/提示欄/徽章、iframe 預覽路徑。

---

## 1. 動機與範圍

現行的編輯流程分散在教師端兩個 drawer:
- `SceneOccludersPanel`(`frontend/src/components/SceneOccludersPanel.tsx`) — 編輯場景遮罩物件實例。
- `SceneEditor`(`frontend/src/components/SceneEditor.tsx`) — 編輯單一角色群組的剛體變換。

兩個 drawer 都是「盲調」:看不到大屏實際渲染,只能猜數字、開大屏視窗對照。本次把兩者整合到**大屏視窗本身**的編輯模式,並補上完整的 undo/redo、單一重置、場景重置、顯式保存、與 3D Gizmo(僅 occluder)的能力。

**範圍內**
- 大屏視窗的編輯模式(opt-in)。
- Occluder + Group 雙物件種類的整合編輯。
- Undo/redo / dirty buffer / 顯式 commit。

**範圍外**
- 單一 slot 角色的位置微調(沿用 scenes.ts 設定)。
- Canvas 上 raycast 選取(只用側欄列表)。
- Scenes 設定檔結構變更。
- 舊兩個 drawer 的刪除(保留為 fallback)。

---

## 2. 使用者流程

### 2.1 進入

1. **教師端 FAB 下拉(主路徑)**: `hs-bigscreen-fab` 從「點擊直接開啟」改為「點擊展開兩項 menu」:`顯示模式` / `編輯模式`。點擊任一以對應 URL 開新視窗。
2. **同視窗 toggle**: 任何已開的 BigScreen(不論初始模式)按 `E` 鍵或左上角 ✏️ 小按鈕都可 toggle 進/出編輯模式。
3. **iframe 預覽 readonly**: HostSession 內嵌的 `showBigScreenPreview` iframe **永遠**不進入編輯模式。

### 2.2 編輯

- 進入編輯模式後:
  - 大屏右側出現 `BigScreenEditorOverlay`(寬 360px、半透明深底)。
  - 場景所有未指派的 slot 自動 spawn 預設角色(idle 姿態)以供視覺對位。
  - 列表項點擊 → 該物件被選中。Occluder 選中時 canvas 出現 TransformControls gizmo(模式 = translate 或 rotate,toggle 可切);Group 選中時無 gizmo,僅面板。
  - 滑桿/數字輸入即時更新 draft;gizmo 拖拉中即時更新 root.position/rotation,放開時記錄一步 undo。
  - 任何變動 → `dirty = true`,Overlay 顯示「⚠ 未保存變動」。

### 2.3 保存 / 退出

- 「💾 保存」→ 寫兩支 localStorage + 廣播兩種既有 channel 訊息 + undo stack 清空 + dirty 清除 + 顯示 toast。
- 「✕ 退出」/ 按 E / `beforeunload` 且 `dirty === true` → confirm 對話框「未保存的變動會丟失」。

### 2.4 重置

- **單一重置(Occluder)**: position/rotation/scale 還原到 `defaultTransform(libraryId)`,不刪實例。
- **單一重置(Group)**: transform → `IDENTITY_TRANSFORM`(`{ pos:[0,0,0], rot:[0,0,0] }`)。
- **場景重置**: 跳 confirm 後 `draft = { occluders: [], groupTransforms: {} }`(等效 scenes.ts 預設,因為 overlay 都是空)。

---

## 3. 系統架構

### 3.1 元件 / Hook 分層

```
BigScreen.tsx
├─ useBigScreenScene (擴充: editorPlaceholderSlots, editorGizmoEnabled, 暴露 occluderRootMap + gizmoApi)
├─ useBigScreenEditor (新:管 draft / selection / undo stack / commit / discard / reset)
└─ <BigScreenEditorOverlay />  ── 只在 editMode 時掛載
       └─ library popover, 列表, 變換區, undo/save/reset 按鈕
```

`BigScreen.tsx` 多一個衍生計算:

```ts
const effectiveOccluders = editMode ? editor.draft.occluders : occluderInstances;
const effectiveGroupTransforms = editMode ? editor.draft.groupTransforms : groupTransforms;
```

這兩個值才是真正餵給 `useBigScreenScene` 的;確保編輯期間 hook 看到 draft,離開或 commit 後看到正常 state。

### 3.2 `useBigScreenEditor` API

```ts
type Selection =
  | { kind: 'occluder'; id: string }   // instanceId
  | { kind: 'group'; id: string }      // groupId
  | null;

type EditorDraft = {
  sceneId: string;
  occluders: SceneOccluderInstance[];
  groupTransforms: Record<string, { pos: Vec3; rot: Vec3 }>;
};

type EditorAction =
  | { type: 'add-occluder'; libraryId: string }
  | { type: 'update-occluder'; instanceId: string; patch: Partial<SceneOccluderInstance> }
  | { type: 'delete-occluder'; instanceId: string }
  | { type: 'duplicate-occluder'; instanceId: string }
  | { type: 'update-group'; groupId: string; transform: { pos: Vec3; rot: Vec3 } }
  | { type: 'reset-item'; kind: 'occluder' | 'group'; id: string }
  | { type: 'reset-scene' }
  | { type: 'select'; sel: Selection } | { type: 'deselect' }
  | { type: 'gizmo-mode'; mode: 'translate' | 'rotate' }
  | { type: 'undo' } | { type: 'redo' }
  | { type: 'commit' } | { type: 'discard' };

function useBigScreenEditor(opts: {
  sceneId: string;
  editMode: boolean;
  channel: BroadcastChannel | null;
  onCommit?: (committed: EditorDraft) => void;  // BigScreen 用來同步 occluderInstances / groupTransforms state
}):
  {
    draft: EditorDraft;
    selection: Selection;
    gizmoMode: 'translate' | 'rotate';
    canUndo: boolean;
    canRedo: boolean;
    dirty: boolean;
    dispatch: (a: EditorAction) => void;
  }
```

### 3.3 Undo / Redo 規則

- 內部維護 `past: EditorDraft[]` 與 `future: EditorDraft[]`,長度上限 50(超過丟最舊)。
- **進 stack 的 action**: add / delete / duplicate / reset-item / reset-scene / update-group(不 coalesce 時)/ update-occluder(不 coalesce 時)。
- **不進 stack**: select / deselect / gizmo-mode。
- **Coalesce 規則**: 若上一筆 update action 的 (kind, id) 與當前一致,且距現在 < 400ms,則直接覆蓋而不 push 新 snapshot。Gizmo 拖拉因為設計上只在 `dragging-changed=false`(放開)派發一次,本身不會塞;coalesce 主要保護面板滑桿連拉。

### 3.4 Commit 順序

1. `localStorage.bigscreen-scene-occluders[sceneId] = draft.occluders`(失敗 → toast 警告、保留 dirty)。
2. `localStorage.bigscreen-group-transforms[sceneId] = draft.groupTransforms`(失敗同上)。
3. `channel.postMessage({ type: 'occluders-set', occluders: draft.occluders })`。
4. 對每個**變動的** group 派發 `{ type: 'group-transform', groupId, groupTransform }`。
5. `past = [], future = []`,`dirty = false`。
6. Overlay toast `✓ 已保存` 1.5s。

「變動的 group」判定: 與最近一次成功 commit / 進入編輯模式時的初始 draft 比對,值不等者派發;不變者跳過(降低 channel 噪音)。

---

## 4. 渲染層

### 4.1 Placeholder 角色

- `useBigScreenScene` 新增 prop `editorPlaceholderSlots?: SceneSlot[]`。
- BigScreen 計算:
  ```ts
  const placeholderSlots = editMode && currentScenePreset.slots
    ? currentScenePreset.slots.filter(s => !slotAssignments[s.id])
    : [];
  ```
- Hook 對每個 placeholder slot 走現有 `ensureAvatar` 路徑,identity = `__placeholder__:${slotId}`,VRM url = `VRM_SOURCES[slot.defaultVrmId ?? DEFAULT_VRM_SOURCE_ID].url`。Avatar 不接 pose;hips 對齊 `slot.position` / `slot.rotation`。
- 退出編輯模式時對 `__placeholder__:` 命名空間批次 `removeAvatar`。
- 徽章 / speakingIdentities / 錄製 overlay 都以「identity 開頭是否為 `__placeholder__:`」過濾,避免假人發聲。

### 4.2 TransformControls Gizmo(僅 Occluder)

新增 `frontend/src/utils/editorGizmo.ts`:

```ts
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

export function attachGizmo(
  scene: THREE.Scene,
  camera: THREE.Camera,
  domElement: HTMLElement,
  mode: 'translate' | 'rotate',
): TransformControls;

export function disposeGizmo(controls: TransformControls): void;
```

- `useBigScreenScene` 在 `editorGizmoEnabled === true` 時建立並加入 scene;false 時 dispose。
- 對外暴露 `gizmoApi`(透過 ref callback):
  ```ts
  { setTarget(root: Object3D | null, mode: 'translate' | 'rotate'): void;
    setMode(mode: 'translate' | 'rotate'): void; }
  ```
- 事件:
  - `dragging-changed === true`(mouseDown): 快照 target 的 `position.clone()` / `rotation.clone()`,並把 `target.userData.editorPinned = true`(scene update loop 看到旗標就跳過自動重算 transform)。
  - `dragging-changed === false`(mouseUp): 讀 target 最終 transform,`dispatch('update-occluder', { instanceId, patch: { position, rotation } })`,清旗標。
- `occluderRootMap: Map<instanceId, Object3D>` 由 hook 維護,Overlay 透過 ref 拿到後 `setTarget` 對應 root。

### 4.3 BigScreenEditorOverlay

新檔 `frontend/src/components/BigScreenEditorOverlay.tsx`。固定右側 `width: 360px`,半透明深底,`z-index` 高於現有 overlay 層。內容區塊:

```
┌─ 編輯模式 ─────────────────[✕ 退出]──┐
│ [↔ 移動] [↻ 旋轉]    [↶ Undo] [↷ Redo]│
│ ──────────────────────────────────── │
│ ▾ 場景物件 (3/10)            [+ 加入] │
│   🪴 衣架 #1        ●(selected)      │
│   🪴 衣架 #2                         │
│   ⚠ (已失效) #3              [×]    │
│ ──────────────────────────────────── │
│ ▾ 角色群組 (2)                       │
│   👥 收銀區                          │
│   👥 顧客區                ●         │
│ ──────────────────────────────────── │
│ ▾ 選中變換 — 衣架 #1                  │
│   X / Y / Z 滑桿 + 數字               │
│   Yaw(occluder)/ Pitch+Yaw+Roll(group)│
│   Scale(occluder only)                │
│   [↺ 單一重置]  [⎘ 複製]  [🗑 刪除]   │
│ ──────────────────────────────────── │
│  ⚠ 未保存變動           [💾 保存]    │
│                         [↺ 場景重置] │
└──────────────────────────────────────┘
```

- `+ 加入` → 內嵌 popover 列出 `OCCLUDER_LIBRARY`;達到 `MAX_OCCLUDERS_PER_SCENE = 10` 時整個按鈕 disabled。
- `↔ 移動 / ↻ 旋轉` toggle 僅在 `selection.kind === 'occluder'` 時顯示。
- 變換區內容跟著 `selection.kind` 切換:
  - Occluder: X/Y/Z(±5)、Yaw(±180°)、Scale(0.1–5)、刪除 + 複製。
  - Group: X/Y/Z(±5)、Pitch/Yaw/Roll(±180°),無 scale 無刪除。
- `↺ 單一重置` 對應 `reset-item`。
- `💾 保存` 僅在 `dirty === true` 時 enabled。
- `↺ 場景重置` confirm 後對應 `reset-scene`(進 undo stack,可回退)。

### 4.4 鍵盤 / 焦點

- `E` toggle 編輯模式(任何 input/textarea focus 時不觸發)。
- `Ctrl+Z` / `Ctrl+Shift+Z` 在 `editMode && !inputFocused` 時 undo / redo。
- `Esc` 在編輯模式且有 selection → deselect;無 selection → toggle 退出(觸發 dirty confirm 流程)。

---

## 5. 邊緣行為

### 5.1 Selection 失效

- Occluder 被刪 → selection 清空。
- 切場景 → selection 清空(且 draft 重新初始化)。
- 該 group 在新場景不存在 → selection 清空。

### 5.2 場景切換(編輯模式下)

- 觸發來源仍是教師端 channel `'scene-change'` 訊息;編輯模式 BigScreen 不自己有切場景 UI。
- 收到 `'scene-change'`:
  - 若 `dirty === true` → `window.confirm()` 問是否丟棄。確認後切;取消則回覆教師端「拒絕切」(實作:直接 ignore 訊息;教師端 UI 視覺已切但 BigScreen 不動 — 此為 known caveat,本次接受)。
  - 切後 draft 從 localStorage 重讀,`past/future = []`,`selection = null`。

### 5.3 失效 library

- 列表顯示「⚠ (已失效)」,只允許刪除;Gizmo 不 attach(因為 scene 中該 root 不會被建立)。

### 5.4 例外處理

- TransformControls dispose 走 try/catch,容 React StrictMode 雙跑 unmount。
- `localStorage` quota 失敗 → toast「⚠ 保存失敗 — quota exceeded」,`dirty` 保留 true。
- `OCCLUDER_LIBRARY_BY_ID[libraryId]` 找不到 → 跳過 spawn,Console warn(已是現有行為)。

### 5.5 廣播一致性

- 編輯模式 commit 後,外部「顯示模式」BigScreen(若同時開著)透過 channel 即時更新。
- 編輯模式自己也是 channel 訂閱者,但 commit 時自發訊息會被自己收到 — 編輯模式收到 `'occluders-set'` / `'group-transform'` 應該**忽略**(已有 draft 為單一真實來源)。實作上加一個 `editModeRef` guard:`if (editMode) return;` 在這兩個訊息 handler 入口。
- 因為 commit 路徑會 ignore 自送訊息,BigScreen 內部的 `occluderInstances` / `groupTransforms` state(編輯模式之外的真實來源)在 commit 後可能 stale。Commit 動作除了 localStorage + channel,**也直接 call BigScreen 給的 setter**(`useBigScreenEditor` 接受 `onCommit(committedDraft)` 回呼)→ BigScreen 在回呼裡 `setOccluderInstances(d.occluders)` 與 `setGroupTransforms(d.groupTransforms)`,確保退出編輯模式時 effectiveOccluders fall back 到正確值。

---

## 6. 檔案清單

### 新增

| 檔案 | 角色 | 估算行數 |
|---|---|---|
| `frontend/src/hooks/useBigScreenEditor.ts` | reducer + undo/redo + commit/discard/reset | ~280 |
| `frontend/src/components/BigScreenEditorOverlay.tsx` | 右側面板 UI | ~360 |
| `frontend/src/utils/editorGizmo.ts` | TransformControls 薄封裝 | ~70 |
| `frontend/src/utils/occluderDefaults.ts` | 抽 `defaultTransform(libraryId)` 給 panel/hook 共用 | ~20 |
| `docs/superpowers/specs/2026-06-05-bigscreen-edit-mode-design.md` | 本 spec | — |

### 修改

| 檔案 | 改動 |
|---|---|
| `frontend/src/components/BigScreen.tsx` | 讀 `?mode=edit`、`E` 鍵與左上 ✏️ toggle、接 `useBigScreenEditor`、`beforeunload` 守門、`effectiveOccluders` / `effectiveGroupTransforms` 衍生計算、編輯模式才掛 `<BigScreenEditorOverlay />`、編輯模式忽略自送的 `'occluders-set'` / `'group-transform'` channel 訊息 |
| `frontend/src/hooks/useBigScreenScene.ts` | 新 props:`editorPlaceholderSlots`、`editorGizmoEnabled`、`onOccluderRootMap`(或 ref)、`onGizmoApi`(或 ref);新增 placeholder avatar 分支與 gizmo 生命週期 |
| `frontend/src/components/HostSession.tsx` | `openBigScreen(mode: 'display' \| 'edit')`;FAB 點擊改展開兩項 menu;URL 帶 `&mode=edit` |
| `frontend/src/components/SceneOccludersPanel.tsx` | Header 加一行 hint:「也可在大屏編輯模式整合調整」;沿用 `defaultTransform` 改 import from `utils/occluderDefaults` |
| `frontend/src/components/SceneEditor.tsx` | Header 加同樣 hint |
| CSS(現有 stylesheet,沿用既有 token) | 新增 `bs-editor-overlay` / `bs-editor-fab-menu` / `bs-editor-toast` 等樣式區塊 |

### 不動

- `SCENE_PRESETS` / `THEMES` / `BigScreenMsg` 型別 / 教師端錄製 / AI 助理 / 提示欄 / 徽章。
- iframe preview 路徑(沒有 `&mode=edit`)。

---

## 7. 測試重點

| 測試類型 | 場景 |
|---|---|
| Undo coalesce | 面板滑桿 5 次連調(<400ms) → undo stack 只進 1 步;>400ms 間隔調 → 進 N 步 |
| Undo 結構 | add / delete / duplicate / reset-item / reset-scene 各進 1 步 |
| Commit 清空 | 任意動 → commit → `canUndo === false`,`dirty === false` |
| Dirty 守門 | `E` 鍵 / `✕` / `beforeunload` / `'scene-change'` 四路徑都 prompt |
| Placeholder 隔離 | 進編輯 → 全部 slot 都有人;退出 → placeholder 全清,真實學生不受影響;`speakingIdentities` 不會把 `__placeholder__:` 認成在說話 |
| 廣播一致 | A 視窗開顯示模式 + B 視窗開編輯模式 + commit → A 即時更新 |
| 失效 library | 移除 `OCCLUDER_LIBRARY` 中某 item 後重開 → 該實例列表顯示「⚠」、只能刪 |
| Gizmo 切換 | 選 occluder → gizmo 出現;切到 group → gizmo 消失 |
| Gizmo undo | 拖 gizmo 從 A → B → 放手 → undo 一次回 A |
| Quota 失敗 | localStorage 滿 → commit 顯示警告 toast,`dirty` 仍 true |

---

## 8. 已知 caveat / 後續可做

- **編輯模式拒絕切場景的 UI 反饋**(§5.2): 教師端 UI 切了但編輯模式 BigScreen 因 `dirty` 不切,目前是「ignore 訊息」;後續可考慮反向 channel 訊息告訴教師端「編輯中,請先保存」。
- **Group 不上 gizmo**: 因為要 attach gizmo 必須把群組成員 reparent 進一個 `THREE.Group` 容器,會動到 scene tree 拓樸。本次刻意不做,留作未來需求。
- **多步 undo 上限 50**: 一般教師工作流足夠;若實測撞上限再放寬。
