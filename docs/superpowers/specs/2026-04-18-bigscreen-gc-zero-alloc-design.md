# BigScreen GC 零分配渲染優化設計

**日期：** 2026-04-18  
**狀態：** 已核准  
**目標：** 消除大屏 RAF 渲染迴圈中所有逐幀堆積配置（heap allocation），降低 GC spike 造成的掉幀

---

## 問題描述

現有渲染管線在每個 RAF 幀中存在以下分配來源（每幀 × N 個 avatar）：

| 位置 | 分配來源 | 規模 |
|------|----------|------|
| `vrmPoseApplier.ts:391` | `new THREE.Euler(rotX, rotY, rotZ)` in Face solver | 1 × 有人臉的幀 |
| `vrmPoseApplier.ts: eulerToBoneRot` | `return { x, y, z, w }` — 每骨一個新物件 | ~15 × 2 手 × N avatar |
| `vrmPoseApplier.ts: slerpBone` | `return { x: _prev.x, ... }` — 同上 | ~15 × 2 手 × N avatar |
| `vrmPoseApplier.ts: solveHand` | `const result: Record<string, BoneRotation> = {}` | 2 × N avatar |
| `propInteraction.ts: projectToUV` | `return { x, y }` | 2 手 × N avatar（displayed 狀態）|
| `useBigScreenScene.ts: onStats` | `Object.fromEntries([...entries()].map(...))` | 1（stats 顯示時）|

---

## 範圍

**修改：**
- `frontend/src/utils/vrmPoseApplier.ts`
- `frontend/src/utils/propInteraction.ts`
- `frontend/src/hooks/useBigScreenScene.ts`

**不動：**
- `BigScreen.tsx`、`StatsPanel.tsx`、`PerformanceMonitor.tsx`
- BroadcastChannel 邏輯、VRM 載入、錄影功能

---

## 架構

### 核心原則

1. **暫存物件（中間計算結果）** → 模組頂層預配置，synchronous 函式內安全複用
2. **持久物件（跨幀狀態）** → 放入 `PoseApplyState`，in-place 更新 `x/y/z/w`
3. **Caller-owned 輸出** → 需要回傳物件的公開函式改為接收 `out` 參數

---

## 各檔案修改細節

### `vrmPoseApplier.ts`

#### 1. 模組頂層新增暫存

```ts
// 已有：_targetQuat, _euler, _quat, _prev, _target
// 新增：
const _boneRotTemp: BoneRotation = { x: 0, y: 0, z: 0, w: 0 };
```

#### 2. `PoseApplyState` 介面

```ts
export interface PoseApplyState {
  prevRotations: Record<string, BoneRotation>;
  cachedBoneRotations: Record<string, BoneRotation> | null;
  cachedHipsPos: { x: number; y: number; z: number } | null;
  // 取代 prevLeftHandBones / prevRightHandBones
  // 物件在 createPoseApplyState() 建立時預配置，每幀 in-place 更新
  leftHandBones: Record<string, BoneRotation>;
  rightHandBones: Record<string, BoneRotation>;
}
```

`createPoseApplyState()` 遍歷 `LEFT_HAND_BONE_MAP` / `RIGHT_HAND_BONE_MAP` 的 values，
為每個 bone name 建立 `{ x: 0, y: 0, z: 0, w: 1 }`（identity quaternion）。

#### 3. `eulerToBoneRot` — 寫入模組頂層暫存

```ts
// before: returns new { x, y, z, w }
// after: writes into _boneRotTemp, returns same reference
function eulerToBoneRot(e: { x: number; y: number; z: number }): BoneRotation {
  _euler.set(e.x, e.y, e.z, 'XYZ');
  _quat.setFromEuler(_euler);
  _boneRotTemp.x = _quat.x;
  _boneRotTemp.y = _quat.y;
  _boneRotTemp.z = _quat.z;
  _boneRotTemp.w = _quat.w;
  return _boneRotTemp; // caller 必須立即消費，不得跨幀持有
}
```

#### 4. `slerpBone` → `slerpBoneInto` — 寫入 out 參數

```ts
// before: function slerpBone(cur, prev, smoothing): BoneRotation
// after:
function slerpBoneInto(
  cur: BoneRotation,
  prev: BoneRotation,
  smoothing: number,
  out: BoneRotation,
): void {
  _prev.set(prev.x, prev.y, prev.z, prev.w); // 先讀完 prev（prev === out 安全）
  _target.set(cur.x, cur.y, cur.z, cur.w);
  _prev.slerp(_target, 1 - smoothing);
  out.x = _prev.x; out.y = _prev.y; out.z = _prev.z; out.w = _prev.w;
}
```

> `prev === out` 安全性：`_prev.set(prev.*)` 在寫入 `out.*` 前已原子性讀取四個值。

#### 5. `solveHand` — 改為寫入 `outBones`

```ts
// before: returns SolveHandResult | null  (含新建 bones 物件)
// after:
export function solveHand(
  landmarks: HandLandmark[],
  side: 'Left' | 'Right',
  outBones: Record<string, BoneRotation>, // 同時作為 prev（slerp 來源）與輸出
  smoothing: number,
): HandGesture | null  // null = 無效 landmarks
```

內部迴圈：
```ts
for (const [role, vrmName] of Object.entries(boneMap)) {
  // ... determine euler ...
  const cur = eulerToBoneRot(euler); // 寫入 _boneRotTemp
  if (outBones[vrmName]) {
    slerpBoneInto(cur, outBones[vrmName], smoothing, outBones[vrmName]);
  } else {
    // 首幀無 prev：直接寫入
    outBones[vrmName].x = cur.x; /* ... */
  }
}
return gesture;
```

呼叫端（`applyPoseToVrm`）：
```ts
// before:
const result = solveHand(landmarks, 'Left', state.prevLeftHandBones, smoothing);
if (result) { applyHandBones(humanoid, result.bones, t); state.prevLeftHandBones = result.bones; }

// after:
const gesture = solveHand(landmarks, 'Left', state.leftHandBones, smoothing);
if (gesture !== null) applyHandBones(humanoid, state.leftHandBones, t);
```

#### 6. Face solver — 修正 `new THREE.Euler()` bug

```ts
// before:
_targetQuat.setFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'XYZ'));

// after（複用模組頂層 _euler）:
_euler.set(rotX, rotY, rotZ, 'XYZ');
_targetQuat.setFromEuler(_euler);
```

---

### `propInteraction.ts`

#### `projectToUV` — output 參數

```ts
// before: returns { x: number; y: number }
// after:
export function projectToUV(
  worldPos: THREE.Vector3,
  camera: THREE.Camera,
  out: { x: number; y: number },
): void {
  _ndcPos.copy(worldPos).project(camera);
  out.x = (_ndcPos.x + 1) / 2;
  out.y = (1 - _ndcPos.y) / 2;
}
```

---

### `useBigScreenScene.ts`

#### `AvatarSlot` — 新增 `_propUV`

```ts
interface AvatarSlot {
  // ... existing fields ...
  _propUV: { x: number; y: number }; // projectToUV 輸出預配置
}
```

`ensureAvatar` 建立 slot 時加入 `_propUV: { x: 0, y: 0 }`。

呼叫端更新：
```ts
// before:
const propUV = projectToUV(prop.position, cameraRef.current);
const wristUV = { x: hLandmarks[0].x, y: hLandmarks[0].y };

// after:
projectToUV(prop.position, cameraRef.current, slot._propUV);
const wristUV = { x: hLandmarks[0].x, y: hLandmarks[0].y }; // wristUV 是 landmark，不需預配置
```

#### `onStats` — `avgPoseIntervals` 預配置

```ts
// 新增 ref（scene useEffect 外層）：
const avgPoseIntervalsRef = useRef<Record<string, number>>({});

// RAF 末尾（取代 Object.fromEntries + spread）：
const api = avgPoseIntervalsRef.current;
for (const k of Object.keys(api)) {
  if (!avatarsRef.current.has(k)) delete api[k];
}
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
```

> 外層 `StatsSnapshot` 物件仍每幀建立（7 個 primitive 欄位），以確保 React state setter 觸發重渲染。
> `avgPoseIntervals` 物件改為 in-place 更新，消除 spread + map + Object.fromEntries。

---

## 已知剩餘分配

| 項目 | 說明 |
|------|------|
| `wristUV` in prop loop | MediaPipe landmark `{x,y}` 直接讀取，不需獨立物件也可用 `hLandmarks[0]` 直接存取 — 可留待後續 |
| `StatsSnapshot` 外層物件 | 每幀 1 個（7 primitive 欄位），用於觸發 React re-render，接受此分配 |

---

## 驗收條件

1. `vrmPoseApplier.ts` 中 RAF 路徑不再有 `new THREE.Euler()` 或 `return { x, y, z, w }` 的新物件建立
2. `PoseApplyState` 的 `leftHandBones` / `rightHandBones` 物件在 session 期間不被替換（僅 in-place 更新）
3. `projectToUV` 不再回傳新物件
4. `avgPoseIntervals` 物件在 session 期間不被替換
5. Chrome DevTools Memory → Allocation instrumentation 顯示 RAF 期間骨骼相關物件分配大幅下降
6. 功能不退化：pose 動畫、手部姿態、臉部表情、prop 互動行為與優化前一致
