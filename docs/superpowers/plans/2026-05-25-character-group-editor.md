# 角色群組編輯器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 為 BigScreen 場景新增「群組編輯器」— 老師在 HostSession 端透過抽屜選擇預先定義的群組（角色 + 道具），以剛體 translate / 三軸 rotate 調整位置，結果存於 `localStorage` 並於 BigScreen 即時預覽 / 重啟後自動套用。

**Architecture:** scenes.ts 新增 `groups` 欄位定義邏輯群組；HostSession 端 `SceneEditor.tsx` 抽屜推送 `'group-transform'` BroadcastChannel 訊息；BigScreen 接收後維護 `groupTransforms` state；`useBigScreenScene` 透過純函式 `utils/groupTransform.ts`（pivot 計算 + 變換套用）對群組成員的 `Object3D` 統一寫位置/旋轉。`taskProp` 在 `held` 狀態時跳過群組變換。

**Tech Stack:** React 18 + TypeScript + Three.js + @pixiv/three-vrm + Vite。專案目前無測試 framework（依設計文件 §8.1）— 每個 task 結尾用 TypeScript build (`npm run build` 或 `tsc --noEmit`) 與手動瀏覽器驗證取代自動化測試。

設計文件：`docs/superpowers/specs/2026-05-25-character-group-editor-design.md`

---

## File Structure

**Create:**
- `frontend/src/utils/groupTransform.ts` — 純函式：pivot 計算、Euler 旋轉向量、群組變換套用
- `frontend/src/components/SceneEditor.tsx` — HostSession 端抽屜 UI

**Modify:**
- `frontend/src/types/vrm.ts` — 加 `GroupMemberRef` / `GroupConfig` 型別、`SceneVariant.groups` / `SceneConfig.groups` 欄位
- `frontend/src/config/scenes.ts` — `clothingStore_cashier` 加 `groups` 範例、`buildScenePresets` 把 `variant.groups` 帶入
- `frontend/src/utils/propLoader.ts` — `loadStaticProps` 回傳 `Map<id, THREE.Group>`、`disposeStaticProps` 收 `Map`
- `frontend/src/hooks/useBigScreenScene.ts` — 新 `groupTransforms` option、新 staticProp map ref、整合變換套用、taskProp 互動狀態特殊處理
- `frontend/src/components/BigScreen.tsx` — `BigScreenMsg` 加 `'group-transform'`、`groupTransforms` state + localStorage 啟動載入、message handler、傳給 hook
- `frontend/src/components/HostSession.tsx` — slot-card ⚙ 按鈕、`sceneEditorGroupId` state、`<SceneEditor />` 抽屜渲染

**Total:** 2 new files, 6 modified files

---

## Task 1: 加入型別定義

**Files:**
- Modify: `frontend/src/types/vrm.ts`

- [ ] **Step 1: 加 `GroupMemberRef` 與 `GroupConfig` 型別**

在 `frontend/src/types/vrm.ts` 的「Scene Configuration」段（`ScenePropSystem` interface 之後、`SceneVariant` 之前）插入：

```ts
/** 群組成員引用（指向場景內既存的 slot / staticProp / taskProp） */
export interface GroupMemberRef {
  kind: 'slot' | 'staticProp' | 'taskProp';
  /** 對應 slot.id / staticProp.id / taskProp 的 task id（map key） */
  id: string;
}

/** 邏輯群組：可在 SceneEditor 中被選中、整組套用剛體變換 */
export interface GroupConfig {
  id: string;       // e.g. 'customer_area'
  label: string;    // 顯示用 e.g. '顧客區（顧客+衣架+衣物）'
  members: GroupMemberRef[];
  /** 選填：固定旋轉中心。未設定 → 用所有成員 base position 的 centroid */
  pivot?: [number, number, number];
}
```

- [ ] **Step 2: `SceneVariant` 加 `groups?` 欄位**

於 `SceneVariant` interface 既有 `propSystem?: ScenePropSystem;` 後加一行：

```ts
  /** 邏輯群組：允許 SceneEditor 對整組成員套用變換 */
  groups?: GroupConfig[];
```

- [ ] **Step 3: `SceneConfig` 同樣加 `groups?` 欄位**

於 `SceneConfig` interface 既有 `propSystem?: ScenePropSystem;` 後加一行：

```ts
  /** 邏輯群組（由 SceneVariant.groups 帶入） */
  groups?: GroupConfig[];
```

- [ ] **Step 4: TypeScript 編譯確認**

執行：
```
cd frontend && npx tsc --noEmit
```
預期：無新增 error。

- [ ] **Step 5: Commit**

```
git add frontend/src/types/vrm.ts
git commit -m "feat(types): 新增 GroupConfig / GroupMemberRef 型別"
```

---

## Task 2: 純函式 `groupTransform.ts`

**Files:**
- Create: `frontend/src/utils/groupTransform.ts`

- [ ] **Step 1: 建立檔案**

於 `frontend/src/utils/groupTransform.ts` 新增（**整檔內容**）：

```ts
/**
 * groupTransform.ts
 *
 * 純函式：群組剛體變換。
 *  - computePivot       — 取群組成員 base 座標的 centroid
 *  - rotateByEulerXYZ   — 對單一向量套用 XYZ 順序的 Euler 旋轉
 *  - applyGroupTransform — 已知成員 base、群組 pivot、群組 transform，回傳成員 final pos/rot
 *
 * 三軸對應：rot[0] = Pitch (X), rot[1] = Yaw (Y), rot[2] = Roll (Z)。Euler 順序 'XYZ'。
 * 不依賴 Three.js，便於將來引入 vitest 直接覆蓋。
 */

export type Vec3 = [number, number, number];

/** 取多個 3D 點的算術平均（centroid）。傳空陣列回 [0,0,0]。 */
export function computePivot(positions: Vec3[]): Vec3 {
  if (positions.length === 0) return [0, 0, 0];
  let sx = 0, sy = 0, sz = 0;
  for (const p of positions) {
    sx += p[0]; sy += p[1]; sz += p[2];
  }
  const n = positions.length;
  return [sx / n, sy / n, sz / n];
}

/**
 * 對向量 v 套用 Euler 旋轉 (rx, ry, rz)，順序 X → Y → Z（與 Three.js 'XYZ' 一致）。
 * 數學：v' = Rz · Ry · Rx · v
 */
export function rotateByEulerXYZ(v: Vec3, r: Vec3): Vec3 {
  const [x, y, z] = v;
  const [rx, ry, rz] = r;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);

  // Rx
  let x1 = x;
  let y1 = y * cx - z * sx;
  let z1 = y * sx + z * cx;
  // Ry
  let x2 = x1 * cy + z1 * sy;
  let y2 = y1;
  let z2 = -x1 * sy + z1 * cy;
  // Rz
  const x3 = x2 * cz - y2 * sz;
  const y3 = x2 * sz + y2 * cz;
  const z3 = z2;

  return [x3, y3, z3];
}

/**
 * 把群組變換套到單一成員。
 *
 *  final.pos = pivot + Rxyz(base.pos - pivot, t.rot) + t.pos
 *  final.rot = base.rot + t.rot   （元素相加；Three.js Euler 沒有真正的「加法」但對小角度 / 單軸組合 OK）
 *
 * 對成員旋轉採用直接相加是設計上的取捨：成員預設多半 rot 為 [0,0,0]
 * 或單一 Y 軸（slot 朝向），群組變換大多是 Y 軸轉向場 — 相加足以表達意圖。
 * 若未來需要精準 quaternion 組合，可在此函式內升級而不影響呼叫端。
 */
export function applyGroupTransform(
  base: { pos: Vec3; rot: Vec3 },
  pivot: Vec3,
  transform: { pos: Vec3; rot: Vec3 },
): { pos: Vec3; rot: Vec3 } {
  const rel: Vec3 = [
    base.pos[0] - pivot[0],
    base.pos[1] - pivot[1],
    base.pos[2] - pivot[2],
  ];
  const rotated = rotateByEulerXYZ(rel, transform.rot);
  const finalPos: Vec3 = [
    pivot[0] + rotated[0] + transform.pos[0],
    pivot[1] + rotated[1] + transform.pos[1],
    pivot[2] + rotated[2] + transform.pos[2],
  ];
  const finalRot: Vec3 = [
    base.rot[0] + transform.rot[0],
    base.rot[1] + transform.rot[1],
    base.rot[2] + transform.rot[2],
  ];
  return { pos: finalPos, rot: finalRot };
}

/** 中性變換（無位移、無旋轉）— 供 Reset 使用。 */
export const IDENTITY_TRANSFORM: { pos: Vec3; rot: Vec3 } = {
  pos: [0, 0, 0],
  rot: [0, 0, 0],
};
```

- [ ] **Step 2: TypeScript 編譯確認**

```
cd frontend && npx tsc --noEmit
```
預期：無 error。

- [ ] **Step 3: 瀏覽器 DevTools 快速正確性檢查（可選但推薦）**

啟動 dev server（`npm run dev`），在任一頁面 DevTools console 貼：

```js
// 簡單檢查 rotateByEulerXYZ 對 90° Y 旋轉
// (1,0,0) → (0,0,-1)
import('/src/utils/groupTransform.ts').then(m => {
  const v = m.rotateByEulerXYZ([1,0,0], [0, Math.PI/2, 0]);
  console.log(v, '應約等於 [0, 0, -1]');
});
```
預期：印出 `[~6e-17, 0, -1]`（浮點誤差級的 0）。

- [ ] **Step 4: Commit**

```
git add frontend/src/utils/groupTransform.ts
git commit -m "feat(utils): 新增 groupTransform 純函式（pivot/Euler/apply）"
```

---

## Task 3: `propLoader` 暴露 id-keyed map

目前 `loadStaticProps` 回傳 `Group[]`，無法以 prop id 反查。改為 `Map<id, Group>` 以支援群組成員解析。

**Files:**
- Modify: `frontend/src/utils/propLoader.ts`
- Modify: `frontend/src/hooks/useBigScreenScene.ts`（call site 與 ref 型別）

- [ ] **Step 1: 改 `loadStaticProps` 回傳型別為 `Map<string, THREE.Group>`**

於 `frontend/src/utils/propLoader.ts` 把 `loadStaticProps` 整個函式替換為：

```ts
/** Load all static props for a scene. Returns a map of prop id → Group (missing assets excluded). */
export async function loadStaticProps(
  staticProps: PropConfig[],
  scene: THREE.Scene,
): Promise<Map<string, THREE.Group>> {
  const pool = new Map<string, THREE.Group>();
  await Promise.all(
    staticProps.map(async (cfg) => {
      const group = await loadGlb(cfg.url, scene);
      if (!group) return;
      group.position.set(...cfg.position);
      if (cfg.rotation) group.rotation.set(...cfg.rotation);
      if (cfg.scale != null) group.scale.setScalar(cfg.scale);
      pool.set(cfg.id, group);
    }),
  );
  return pool;
}
```

- [ ] **Step 2: 改 `disposeStaticProps` 收 `Map`**

於同檔把 `disposeStaticProps` 整個函式替換為：

```ts
/** Dispose all groups in a static prop pool. */
export function disposeStaticProps(pool: Map<string, THREE.Group>, scene: THREE.Scene): void {
  for (const group of pool.values()) disposeGroup(group, scene);
  pool.clear();
}
```

- [ ] **Step 3: 更新 `useBigScreenScene` ref 型別**

於 `frontend/src/hooks/useBigScreenScene.ts` 找到 `staticPropGroupsRef`（大約在 `taskPropPoolRef` 附近，約 line 188 區域）：

舊：
```ts
const staticPropGroupsRef = useRef<THREE.Group[]>([]);
```

改為：
```ts
const staticPropPoolRef = useRef<Map<string, THREE.Group>>(new Map());
```

並把檔內所有 `staticPropGroupsRef` 改為 `staticPropPoolRef`（IDE 全檔取代）。

- [ ] **Step 4: 更新呼叫處（load 與 dispose）**

`useBigScreenScene.ts` 約 line 263–268 改為：

```ts
const staticP = loadStaticProps(preset.propSystem.staticProps ?? [], scene)
  .then((pool) => {
    if (propsCancelled) { disposeStaticProps(pool, scene); return; }
    staticPropPoolRef.current = pool;
  })
  .catch((err) => console.warn('[BigScreenScene] staticProps load error:', err));
```

清理 cleanup 處（約 line 563）：

舊：
```ts
disposeStaticProps(staticPropGroupsRef.current, scene);
```

新（變數名已改、call signature 同）：
```ts
disposeStaticProps(staticPropPoolRef.current, scene);
```

- [ ] **Step 5: TypeScript 編譯確認**

```
cd frontend && npx tsc --noEmit
```
預期：無 error。

- [ ] **Step 6: 手動煙霧測試 — 場景物件仍正常顯示**

`npm run dev`，開 HostSession → BigScreen，確認服飾店收銀台場景的 `cashier_counter`、`rack` 仍正確顯示在原位（行為應無改變）。

- [ ] **Step 7: Commit**

```
git add frontend/src/utils/propLoader.ts frontend/src/hooks/useBigScreenScene.ts
git commit -m "refactor(propLoader): loadStaticProps 回傳 Map<id, Group>"
```

---

## Task 4: scenes.ts 加入 `groups` 範例

**Files:**
- Modify: `frontend/src/config/scenes.ts`

- [ ] **Step 1: 在 `clothingStore_cashier` SceneVariant 內 `propSystem` 之後加入 `groups`**

於 `frontend/src/config/scenes.ts` 找到 `clothingStore_cashier`（約 line 21 開始）的 `propSystem: { ... },` 後、`},` 收尾之前插入：

```ts
        groups: [
          {
            id: 'cashier_side',
            label: '收銀區',
            members: [
              { kind: 'slot',       id: 'cashier' },
              { kind: 'staticProp', id: 'cashier_counter' },
            ],
          },
          {
            id: 'customer_side',
            label: '顧客區',
            members: [
              { kind: 'slot',       id: 'customer' },
              { kind: 'staticProp', id: 'rack' },
              { kind: 'taskProp',   id: 'ask_price_1' },
              { kind: 'taskProp',   id: 'ask_price_2' },
              { kind: 'taskProp',   id: 'ask_price_3' },
              { kind: 'taskProp',   id: 'ask_price_4' },
              { kind: 'taskProp',   id: 'ask_price_5' },
            ],
          },
        ],
```

- [ ] **Step 2: 修改 `buildScenePresets` 把 `variant.groups` 帶入 preset**

於 `frontend/src/config/scenes.ts` 找到 `buildScenePresets` 內構造 `presets[variant.id]` 的 spread block（約 line 276–286），於 `propSystem: variant.propSystem,` 後加：

```ts
        groups: variant.groups,
```

- [ ] **Step 3: TypeScript 編譯確認**

```
cd frontend && npx tsc --noEmit
```
預期：無 error。

- [ ] **Step 4: Commit**

```
git add frontend/src/config/scenes.ts
git commit -m "feat(scenes): 服飾店收銀台加入 groups 範例（收銀區/顧客區）"
```

---

## Task 5: `useBigScreenScene` — 暴露成員解析 + 套用 hook（不含 taskProp 互動狀態）

把「解析 member → Object3D 與 base 位置」「套用 group 變換到非 taskProp 成員」這兩件事接上。taskProp 的互動狀態處理留到 Task 6 — 本任務先讓 slot 與 staticProp 的群組變換動起來。

**Files:**
- Modify: `frontend/src/hooks/useBigScreenScene.ts`

- [ ] **Step 1: 新增 hook option `groupTransforms`**

於 `UseBigScreenSceneOptions` interface（檔頭附近）加：

```ts
  /** 群組變換：groupId → {pos, rot}（rot 為 radian）。改變時自動 re-apply。 */
  groupTransforms?: Record<string, { pos: [number, number, number]; rot: [number, number, number] }>;
```

於 hook 函式參數解構 options 處加 `groupTransforms`，並建立 ref 與同步 useEffect（沿用檔內既有「`xxxRef.current = xxx`」pattern）：

```ts
const groupTransformsRef = useRef<Record<string, { pos: [number, number, number]; rot: [number, number, number] }>>({});
useEffect(() => { groupTransformsRef.current = groupTransforms ?? {}; }, [groupTransforms]);
```

- [ ] **Step 2: import 新工具與型別**

於 hook 檔頂 import 區塊加：

```ts
import {
  applyGroupTransform,
  computePivot,
  IDENTITY_TRANSFORM,
  type Vec3,
} from '../utils/groupTransform';
import type { GroupConfig, GroupMemberRef } from '../types/vrm';
```

- [ ] **Step 3: 加成員 base 資料解析函式（hook 內 helper）**

於 hook 內部（任何 useEffect 外、或 inside 主 useEffect 內均可；建議放 hook function body 最上方接近 helpers 處）新增：

```ts
/** 取成員的 base pos / rot — 依 kind 對應 slots.position / staticProps.position / taskProps.displayPos */
function memberBase(
  ref: GroupMemberRef,
  preset: SceneConfig,
): { pos: Vec3; rot: Vec3 } | null {
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
  // taskProp
  const t = preset.propSystem?.taskProps?.[ref.id];
  if (!t) return null;
  return { pos: t.displayPos, rot: t.rotation ?? [0, 0, 0] };
}
```

（`SceneConfig` 型別已 import 在檔頭。）

- [ ] **Step 4: 加成員 Object3D 解析函式**

於同位置新增（會使用到 `slotAssignmentsRef` — 已存在於既有 code 內；若 ref 名稱不同請就地調整）：

```ts
/** 解析成員 id → Object3D（slot 透過 slotAssignments → identity → avatar.vrm.scene） */
function resolveMemberObject(ref: GroupMemberRef): THREE.Object3D | null {
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
}
```

如果 hook 內目前沒有 `slotAssignmentsRef`，搜尋既有 `slotAssignments` 用法、確認以何種形式存取。設計文件假設它已存在於 options。若實際是 prop 而非 ref，建議補一個 ref（沿用同檔 pattern）。

- [ ] **Step 5: 新增 `applyAllGroupTransforms()` 函式**

於同位置新增：

```ts
/** 對目前 preset 所有 group 重新套用 transform。lookup 失敗的成員 skip（不報錯）。 */
function applyAllGroupTransforms() {
  const preset = presetRef.current;
  const groups = preset.groups ?? [];
  const transforms = groupTransformsRef.current;
  for (const g of groups) {
    const t = transforms[g.id] ?? IDENTITY_TRANSFORM;

    // pivot
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
      // taskProp 走 Task 6 的特殊路徑，本任務先 skip
      if (m.kind === 'taskProp') continue;

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
}
```

確認 `presetRef` 存在於 hook 內（檔內既有 code 使用 `presetRef.current.propSystem`）；若不存在則新建。

- [ ] **Step 6: 在關鍵時機呼叫 `applyAllGroupTransforms()`**

接到「物件已就緒」或「transforms 改變」時都要 re-apply。加入以下三處 trigger：

(a) **props 載入完成**：於既有 `Promise.allSettled([staticP, taskP]).then(notifyPropsReady);` 改為：

```ts
Promise.allSettled([staticP, taskP]).then(() => {
  applyAllGroupTransforms();
  notifyPropsReady();
});
```

(b) **groupTransforms 改變**：於 hook function body 加 useEffect：

```ts
useEffect(() => {
  applyAllGroupTransforms();
}, [groupTransforms]);
```

註：這個 useEffect 必須在 `applyAllGroupTransforms` 定義之後（且 `applyAllGroupTransforms` 讀 ref，不必放進 dep array）。

(c) **avatar 加入/換模**：找到 `ensureAvatar`、`swapAvatar` 完成（async resolve）處，在新增/替換完成後呼叫：

```ts
applyAllGroupTransforms();
```

- [ ] **Step 7: 從 BigScreen 傳一個空 `groupTransforms` 給 hook（編譯先過）**

於 `frontend/src/components/BigScreen.tsx` 找到 `useBigScreenScene(canvasRef, { ... })` 呼叫（約 line 312），加入：

```ts
    groupTransforms: {}, // Task 8 補上實際 state
```

- [ ] **Step 8: TypeScript 編譯確認**

```
cd frontend && npx tsc --noEmit
```
預期：無 error。

- [ ] **Step 9: 手動驗證 — slot 與 staticProp 行為應與之前一致（無變換 = identity）**

`npm run dev` → BigScreen 開服飾店收銀台。預期：櫃台、衣架、顧客 slot、收銀員 slot 位置與引入此功能前完全一致。

- [ ] **Step 10: Commit**

```
git add frontend/src/hooks/useBigScreenScene.ts frontend/src/components/BigScreen.tsx
git commit -m "feat(scene): useBigScreenScene 套用群組變換到 slot/staticProp"
```

---

## Task 6: `useBigScreenScene` — taskProp 的群組變換（含 held/returning 特殊處理）

taskProp 受 prop interaction 影響：`displayed` 時應跟群組變換；`held` 時跟手（不套變換）；`returning` 時目標位置是「套了變換的 displayPos」。

**Files:**
- Modify: `frontend/src/hooks/useBigScreenScene.ts`

- [ ] **Step 1: 新增 effective displayPos cache**

於 hook 內 ref 區（與 `taskPropPoolRef` 相鄰）加：

```ts
/** 套用群組變換後的 taskProp displayPos：taskId → final pos。 */
const effectiveDisplayPosRef = useRef<Map<string, Vec3>>(new Map());
```

- [ ] **Step 2: 在 `applyAllGroupTransforms` 內處理 taskProp**

把 Task 5 Step 5 中的 `if (m.kind === 'taskProp') continue;` 改為：

```ts
if (m.kind === 'taskProp') {
  const base = memberBase(m, preset);
  if (!base) continue;
  const finalT = applyGroupTransform(base, pivot, t);
  effectiveDisplayPosRef.current.set(m.id, finalT.pos);

  // 只有在 displayed 狀態才直接寫 prop.position；held/returning 由 RAF loop 處理
  const obj = resolveMemberObject(m);
  if (!obj) continue;
  // 找出該 taskProp 是否被某 slot 持有 — 若沒有持有者則視為 displayed
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
```

同時保留先前 slot / staticProp 的處理（在這個 `if` 之後維持原樣）。

- [ ] **Step 3: 在 RAF loop 內把「displayPos」讀取改為走 effective cache**

於 hook 內既有 RAF 區塊找出所有 `presetRef.current.propSystem?.taskProps?.[<taskId>]?.displayPos` 的讀取（grep `displayPos`，應有 ~3 處：returning lerp 目標、task 切換時放回 displayed、grab 重置）。每處改為：

```ts
const dpCfg = presetRef.current.propSystem?.taskProps?.[<taskId>]?.displayPos;
const effective = effectiveDisplayPosRef.current.get(<taskId>);
const dp = effective ?? dpCfg;
```

把後續使用 `dpCfg` 的程式碼改用 `dp`（型別都是 `[x,y,z]`）。

具體 3 處（依設計文件 §5.3 / §6）：
1. returning 狀態 lerp target（約 line 365）
2. task 切換時舊 prop 回 displayed（約 line 401）
3. grab 重置 / 其他取 displayPos 處（約 line 484）

逐處替換。

- [ ] **Step 4: 場景切換時清除 cache**

於 hook 內主 useEffect 開頭（重建 scene 處）加：

```ts
effectiveDisplayPosRef.current.clear();
```

- [ ] **Step 5: TypeScript 編譯確認**

```
cd frontend && npx tsc --noEmit
```
預期：無 error。

- [ ] **Step 6: 手動驗證 — taskProp 互動仍正常（無變換時行為不變）**

`npm run dev` → BigScreen → 切到「Ask for the price of a blue T-shirt」任務 → 衣物應在原位（與引入前一致）。模擬 host 抓取 / 放下 → prop 應正常回到原位。

- [ ] **Step 7: Commit**

```
git add frontend/src/hooks/useBigScreenScene.ts
git commit -m "feat(scene): taskProp 群組變換整合（held 跳過、displayed/returning 用 effective）"
```

---

## Task 7: `BigScreen.tsx` — 訊息型別、state、localStorage 啟動載入

**Files:**
- Modify: `frontend/src/components/BigScreen.tsx`

- [ ] **Step 1: `BigScreenMsg` 加 `'group-transform'`**

於 `frontend/src/components/BigScreen.tsx` 約 line 18–38 的 `BigScreenMsg` interface：

舊 `type:`：
```ts
  type: 'pose' | 'leave' | 'scene-change' | 'vrm-change' | 'vrm-identity-change' | 'slot-assign' | 'task-change' | 'recording-start' | 'recording-stop' | 'settlement-done' | 'hint-change';
```

新：
```ts
  type: 'pose' | 'leave' | 'scene-change' | 'vrm-change' | 'vrm-identity-change' | 'slot-assign' | 'task-change' | 'recording-start' | 'recording-stop' | 'settlement-done' | 'hint-change' | 'group-transform';
```

於 interface 末端（`hintLevel?:` 後）加：

```ts
  /** For 'group-transform': 目標 group id */
  groupId?: string;
  /** For 'group-transform': 變換值（pos m、rot rad） */
  groupTransform?: { pos: [number, number, number]; rot: [number, number, number] };
```

- [ ] **Step 2: 加 `groupTransforms` state 與 localStorage 啟動載入**

於 `BigScreen()` function body state 區（其他 useState 附近，例如 `slotAssignments` state 旁），加：

```ts
type StoredGroupTransform = { pos: [number, number, number]; rot: [number, number, number] };
const [groupTransforms, setGroupTransforms] = useState<Record<string, StoredGroupTransform>>(() => {
  try {
    const all = JSON.parse(localStorage.getItem('bigscreen-group-transforms') || '{}') as Record<string, Record<string, StoredGroupTransform>>;
    return all[sceneId] ?? {};
  } catch {
    return {};
  }
});

// 場景切換時重新讀對應 entry
useEffect(() => {
  try {
    const all = JSON.parse(localStorage.getItem('bigscreen-group-transforms') || '{}') as Record<string, Record<string, StoredGroupTransform>>;
    setGroupTransforms(all[sceneId] ?? {});
  } catch {
    setGroupTransforms({});
  }
}, [sceneId]);
```

- [ ] **Step 3: 把 `groupTransforms` 餵給 hook**

找到 Task 5 Step 7 加的 `groupTransforms: {},`，改為：

```ts
    groupTransforms,
```

- [ ] **Step 4: BroadcastChannel message handler 處理 `'group-transform'`**

找到 BigScreen 既有 message handler（grep `case 'slot-assign':` 找到 switch 區塊），在最後一個 case 之後 / `default` 之前加：

```ts
        case 'group-transform': {
          if (!msg.groupId || !msg.groupTransform) break;
          setGroupTransforms(prev => ({ ...prev, [msg.groupId!]: msg.groupTransform! }));
          break;
        }
```

- [ ] **Step 5: TypeScript 編譯確認**

```
cd frontend && npx tsc --noEmit
```
預期：無 error。

- [ ] **Step 6: 手動煙霧測試**

`npm run dev` → 開 BigScreen。在 DevTools console：

```js
const ch = new BroadcastChannel('bigscreen-channel'); // 用實際 channel 名稱
ch.postMessage({ type: 'group-transform', groupId: 'customer_side', groupTransform: { pos: [1, 0, 0], rot: [0, 0, 0] } });
```

（channel 名稱見 `frontend/src/config/constants.ts` 的 `BIGSCREEN_CHANNEL_NAME`。）

預期：BigScreen 上 `customer_side` 群組所有成員（顧客、衣架、衣物）整組向右位移 1m。

- [ ] **Step 7: Commit**

```
git add frontend/src/components/BigScreen.tsx
git commit -m "feat(BigScreen): 接收 group-transform 訊息並維護 state"
```

---

## Task 8: `SceneEditor.tsx` 新元件

**Files:**
- Create: `frontend/src/components/SceneEditor.tsx`

- [ ] **Step 1: 建立元件檔（**整檔內容**）**

於 `frontend/src/components/SceneEditor.tsx` 新增：

```tsx
import { useState, useEffect } from 'react';
import type { GroupConfig } from '../types/vrm';

type Vec3 = [number, number, number];

interface SceneEditorProps {
  sceneId: string;
  group: GroupConfig;
  channel: BroadcastChannel | null;
  open: boolean;
  onClose: () => void;
}

interface Transform {
  pos: Vec3;
  rot: Vec3; // radian
}

const ZERO: Transform = { pos: [0, 0, 0], rot: [0, 0, 0] };
const STORAGE_KEY = 'bigscreen-group-transforms';

function loadStored(sceneId: string, groupId: string): Transform {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, Record<string, Transform>>;
    return all[sceneId]?.[groupId] ?? ZERO;
  } catch { return ZERO; }
}

function saveStored(sceneId: string, groupId: string, t: Transform) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, Record<string, Transform>>;
    all[sceneId] = all[sceneId] ?? {};
    all[sceneId][groupId] = t;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch (e) {
    console.warn('[SceneEditor] save failed:', e);
  }
}

function deleteStored(sceneId: string, groupId: string) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, Record<string, Transform>>;
    if (all[sceneId]) {
      delete all[sceneId][groupId];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    }
  } catch (e) {
    console.warn('[SceneEditor] delete failed:', e);
  }
}

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

export default function SceneEditor({ sceneId, group, channel, open, onClose }: SceneEditorProps) {
  const [t, setT] = useState<Transform>(() => loadStored(sceneId, group.id));

  // 群組切換時 reload；open 切換時不重置
  useEffect(() => {
    setT(loadStored(sceneId, group.id));
  }, [sceneId, group.id]);

  const broadcast = (next: Transform) => {
    channel?.postMessage({
      type: 'group-transform',
      groupId: group.id,
      groupTransform: { pos: next.pos, rot: next.rot },
    });
  };

  const onPosChange = (axis: 0 | 1 | 2, value: number) => {
    const next: Transform = { ...t, pos: [...t.pos] as Vec3 };
    next.pos[axis] = value;
    setT(next);
    broadcast(next);
  };

  const onRotChangeDeg = (axis: 0 | 1 | 2, degValue: number) => {
    const next: Transform = { ...t, rot: [...t.rot] as Vec3 };
    next.rot[axis] = degValue * DEG2RAD;
    setT(next);
    broadcast(next);
  };

  const onSave = () => { saveStored(sceneId, group.id, t); };
  const onReset = () => {
    setT(ZERO);
    deleteStored(sceneId, group.id);
    broadcast(ZERO);
  };

  const hasSlotMember = group.members.some(m => m.kind === 'slot');

  return (
    <div className={`panel-drawer ${open ? 'panel-drawer--open' : ''}`}>
      <div className="panel-drawer-header">
        <div className="slot-drawer-title">
          <span className="orange">場景編輯</span> <span className="teal">{group.label}</span>
        </div>
        <button className="panel-close-btn" onClick={onClose}>✕</button>
      </div>
      <div className="panel-drawer-body">

        <div className="scene-editor-members">
          {group.members.map(m => (
            <span key={`${m.kind}:${m.id}`} className="scene-editor-member-chip">
              {m.kind === 'slot' ? '👤' : m.kind === 'staticProp' ? '📦' : '🧺'} {m.id}
            </span>
          ))}
        </div>

        <fieldset className="scene-editor-section">
          <legend>位置 (m)</legend>
          {(['X', 'Y', 'Z'] as const).map((label, i) => (
            <div key={label} className="scene-editor-row">
              <label>{label}</label>
              <input type="range" min={-5} max={5} step={0.05}
                value={t.pos[i as 0|1|2]}
                onChange={e => onPosChange(i as 0|1|2, Number(e.target.value))} />
              <input type="number" step={0.05}
                value={t.pos[i as 0|1|2]}
                onChange={e => onPosChange(i as 0|1|2, Number(e.target.value))} />
            </div>
          ))}
        </fieldset>

        <fieldset className="scene-editor-section">
          <legend>旋轉 (°) — Pitch / Yaw / Roll</legend>
          {(['Pitch', 'Yaw', 'Roll'] as const).map((label, i) => (
            <div key={label} className="scene-editor-row">
              <label>{label}</label>
              <input type="range" min={-180} max={180} step={1}
                value={t.rot[i as 0|1|2] * RAD2DEG}
                onChange={e => onRotChangeDeg(i as 0|1|2, Number(e.target.value))} />
              <input type="number" step={1}
                value={Math.round(t.rot[i as 0|1|2] * RAD2DEG * 100) / 100}
                onChange={e => onRotChangeDeg(i as 0|1|2, Number(e.target.value))} />
            </div>
          ))}
          {hasSlotMember && (
            <div className="scene-editor-hint">⚠️ 角色傾斜（Pitch/Roll）可能不自然</div>
          )}
        </fieldset>

        <div className="scene-editor-actions">
          <button onClick={onReset} className="scene-editor-btn-reset">Reset</button>
          <button onClick={onSave}  className="scene-editor-btn-save">Save</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 加最小 CSS（沿用既有 `panel-drawer` 樣式 + 編輯器專屬類）**

於 `frontend/src/index.css` 或現有 BigScreen / HostSession 樣式檔（搜 `panel-drawer` 看哪一檔），於同檔末尾加：

```css
.scene-editor-members {
  display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px;
}
.scene-editor-member-chip {
  background: rgba(0,0,0,0.06); border-radius: 999px;
  padding: 2px 10px; font-size: 12px;
}
.scene-editor-section {
  border: 1px solid rgba(0,0,0,0.1); border-radius: 8px;
  padding: 8px 12px; margin-bottom: 12px;
}
.scene-editor-section legend { font-weight: 600; padding: 0 6px; }
.scene-editor-row {
  display: grid; grid-template-columns: 50px 1fr 80px;
  gap: 8px; align-items: center; margin: 6px 0;
}
.scene-editor-row input[type="range"] { width: 100%; }
.scene-editor-row input[type="number"] { width: 100%; }
.scene-editor-hint {
  font-size: 12px; color: #b76b00; margin-top: 6px;
}
.scene-editor-actions {
  display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px;
}
.scene-editor-btn-reset, .scene-editor-btn-save {
  padding: 8px 16px; border-radius: 6px; border: none; cursor: pointer; font-weight: 600;
}
.scene-editor-btn-reset { background: rgba(0,0,0,0.08); color: #333; }
.scene-editor-btn-save { background: #F76E12; color: #fff; }
```

- [ ] **Step 3: TypeScript 編譯確認**

```
cd frontend && npx tsc --noEmit
```
預期：無 error。

- [ ] **Step 4: Commit**

```
git add frontend/src/components/SceneEditor.tsx frontend/src/index.css
git commit -m "feat(SceneEditor): 群組變換編輯抽屜元件"
```

（若 CSS 加在其他檔，git add 該檔。）

---

## Task 9: `HostSession.tsx` — slot-card ⚙ 按鈕 + 抽屜 wiring

**Files:**
- Modify: `frontend/src/components/HostSession.tsx`

- [ ] **Step 1: import SceneEditor**

於 `frontend/src/components/HostSession.tsx` 檔頭加：

```ts
import SceneEditor from './SceneEditor';
```

- [ ] **Step 2: 加 `sceneEditorGroupId` state**

於 HostSession function body state 區（與 `showSlotPanel` 相鄰）加：

```ts
const [sceneEditorGroupId, setSceneEditorGroupId] = useState<string | null>(null);
```

- [ ] **Step 3: 加 helper：依 slot id 找出所屬 group**

於 HostSession function body 內、`currentScenePreset` 之後加：

```ts
const groupForSlot = (slotId: string) => {
  return currentScenePreset.groups?.find(g =>
    g.members.some(m => m.kind === 'slot' && m.id === slotId)
  );
};
```

- [ ] **Step 4: 在 slot-card 加 ⚙ 按鈕**

於 `frontend/src/components/HostSession.tsx` 約 line 1652 找到：

```tsx
<div key={sceneSlot.id} className="slot-card">
  <div className="slot-card-top">
    <div className="slot-icon-container">
      {sceneSlot.icon}
    </div>
```

在 `slot-icon-container` 之後（即 `slot-info` div 之前）插入：

```tsx
    {(() => {
      const g = groupForSlot(sceneSlot.id);
      if (!g) return null;
      return (
        <button
          className="slot-card-settings-btn"
          title={`編輯群組：${g.label}`}
          onClick={() => setSceneEditorGroupId(g.id)}
        >
          ⚙
        </button>
      );
    })()}
```

加最小 CSS（同 Task 8 Step 2 那個 CSS 檔末尾）：

```css
.slot-card-settings-btn {
  border: none; background: transparent; cursor: pointer;
  font-size: 18px; padding: 4px 8px; opacity: 0.6;
}
.slot-card-settings-btn:hover { opacity: 1; }
```

- [ ] **Step 5: 渲染 SceneEditor 抽屜**

於 HostSession 既有 Slot Drawer JSX（約 line 1634 `{/* ── Slot Drawer ── */}`）之後加：

```tsx
{/* ── Scene Editor Drawer ────────────────────────────────────── */}
{sceneEditorGroupId && (() => {
  const g = currentScenePreset.groups?.find(x => x.id === sceneEditorGroupId);
  if (!g) return null;
  return (
    <SceneEditor
      sceneId={selectedSceneId}
      group={g}
      channel={channelRef.current}
      open={true}
      onClose={() => setSceneEditorGroupId(null)}
    />
  );
})()}
```

確認 `channelRef` 在 HostSession 內存在（grep `channelRef`）。若 channel 物件以其他名稱保存，調整對應。

- [ ] **Step 6: TypeScript 編譯確認**

```
cd frontend && npx tsc --noEmit
```
預期：無 error。

- [ ] **Step 7: Commit**

```
git add frontend/src/components/HostSession.tsx frontend/src/index.css
git commit -m "feat(HostSession): slot-card 加 ⚙ 開啟 SceneEditor 抽屜"
```

---

## Task 10: 手動驗證 checklist（PR 結束前完整跑一輪）

**Files:** 無

- [ ] **基本流程**
  - [ ] 開 HostSession → 點 `cashier` slot-card 的 ⚙ → 抽屜開啟、預選「收銀區」、列出成員 `cashier`、`cashier_counter`
  - [ ] 點 `customer` slot-card 的 ⚙ → 抽屜切到「顧客區」
  - [ ] 拖 X 位移 slider → BigScreen 該群組所有成員同步向左右移動
  - [ ] 拖 Yaw slider → 成員繞群組中心轉向（不是各自原地轉；驗證法：兩個成員的相對距離不變但相對位置繞中心）
  - [ ] 拖 Pitch / Roll slider → 角色 / 道具傾斜
  - [ ] 按 Save → 關閉抽屜、重新整理 BigScreen → 位置仍維持
  - [ ] 按 Reset → 立即還原、`localStorage.getItem('bigscreen-group-transforms')` 中該 entry 消失

- [ ] **互動相容性**
  - [ ] 切換任務（`ask_price_1` → `ask_price_2`）→ 新 taskProp 出場時自動帶上群組變換
  - [ ] 學生抓取 prop（held 狀態）→ prop 跟手走，**不**被群組變換干擾
  - [ ] 放下 prop（returning 狀態）→ lerp 回到「套了群組變換的 displayPos」

- [ ] **邊界**
  - [ ] 切場景到另一個（若有 alternative scene；目前只有一個 active scene，跳過此項或以 dev console 改 sceneId 模擬）→ 舊 group transform 不殘留、新場景 transform 清空
  - [ ] 重新指派 slot 給不同 identity → 新 VRM 立即在群組變換後的位置
  - [ ] 同時編輯兩個 group（依序開兩個抽屜，各拖不同值）→ 互不干擾，localStorage 兩個 entry 都存

- [ ] **錄影**
  - [ ] 編輯中按錄影 → 錄出影片內元素位置與 BigScreen 即時畫面一致

- [ ] **dev console 雜訊**
  - [ ] release 前移除 / 確認 Task 5 Step 5 的 `if (import.meta.env.DEV) console.log(...)` 還在（DEV-only 不漏到 prod）

- [ ] **最後 commit（如有 polish 修改）**

```
git status
git add -A
git commit -m "chore: 手動驗證後微調"
```

---

## Self-Review 備忘

寫完計劃後對照設計文件做了一輪 scan：

- **§3 資料模型** → Task 1（types）+ Task 4（scenes.ts groups）+ Task 7（BigScreenMsg / localStorage）涵蓋
- **§4 元件邊界** → Task 8（SceneEditor）+ Task 9（HostSession wiring）+ Task 5/6（hook 變更）涵蓋
- **§5 資料流** → Task 7 啟動載入 + Task 8 broadcast + Task 5/6 套用涵蓋
- **§6 邊界處理** → Task 5 lookup-fail skip / Task 6 held / Task 7 localStorage try-catch / Task 8 Reset 涵蓋
- **§7 互動相容** → Task 6 effective displayPos cache + held 跳過涵蓋
- **§8 測試策略** → Task 10 手動 checklist 涵蓋

**Type 一致性 check**：
- `Vec3` 在 groupTransform.ts 定義為 `[number, number, number]`，scenes.ts / vrm.ts 使用 inline 同型，兼容 ✓
- `groupTransforms` 在 BigScreen state、hook option、broadcast payload 三處型別一致 ✓
- `IDENTITY_TRANSFORM` 在 hook 套用、SceneEditor `ZERO` 雙處皆為 `{pos:[0,0,0], rot:[0,0,0]}` ✓
