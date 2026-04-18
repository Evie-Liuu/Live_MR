# BigScreen GC 零分配渲染優化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除大屏 RAF 渲染迴圈中所有逐幀 heap allocation，降低 GC spike 造成的掉幀。

**Architecture:** 三個方向：(1) `vrmPoseApplier.ts` 的手部骨骼物件改為 `PoseApplyState` 內嵌預配置 + in-place 更新；(2) `propInteraction.ts` 的 `projectToUV` 改為 output-parameter；(3) `useBigScreenScene.ts` 的 `avgPoseIntervals` 改為 ref 持有 in-place 更新。

**Tech Stack:** TypeScript, Three.js, @pixiv/three-vrm, React hooks

---

## 檔案範圍

| 檔案 | 動作 |
|------|------|
| `frontend/src/utils/vrmPoseApplier.ts` | 修改 |
| `frontend/src/utils/propInteraction.ts` | 修改 |
| `frontend/src/hooks/useBigScreenScene.ts` | 修改 |

---

### Task 1: 修正 Face solver 的 `new THREE.Euler()` bug

**Files:**
- Modify: `frontend/src/utils/vrmPoseApplier.ts`

這是最小的一行 bug fix：Face solver 每幀建立一個 `new THREE.Euler()`，但模組頂層已有 `_euler` 可以複用。

- [ ] **Step 1: 定位並修改 `vrmPoseApplier.ts` 中的 Face solver**

在 `applyPoseToVrm` 函式內找到以下這段（約 line 391）：

```ts
// Head Rotation
const head = humanoid.getNormalizedBoneNode('head');
if (head) {
  // For visual mirroring, swap Y and Z rotation signs
  const rotX = mirror ? -faceRig.head.x : faceRig.head.x;
  const rotY = mirror ? -faceRig.head.y : faceRig.head.y;
  const rotZ = mirror ? -faceRig.head.z : faceRig.head.z;
  _targetQuat.setFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'XYZ'));
  head.quaternion.slerp(_targetQuat, t);
}
```

將其改為（複用模組頂層的 `_euler`）：

```ts
// Head Rotation
const head = humanoid.getNormalizedBoneNode('head');
if (head) {
  const rotX = mirror ? -faceRig.head.x : faceRig.head.x;
  const rotY = mirror ? -faceRig.head.y : faceRig.head.y;
  const rotZ = mirror ? -faceRig.head.z : faceRig.head.z;
  _euler.set(rotX, rotY, rotZ, 'XYZ');
  _targetQuat.setFromEuler(_euler);
  head.quaternion.slerp(_targetQuat, t);
}
```

- [ ] **Step 2: TypeScript 型別檢查**

```bash
cd frontend && npx tsc --noEmit
```

期望：0 errors。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/utils/vrmPoseApplier.ts
git commit -m "fix: reuse _euler in face solver, eliminate per-frame new THREE.Euler()"
```

---

### Task 2: 新增模組暫存 + 重構 `eulerToBoneRot` 與 `slerpBone`

**Files:**
- Modify: `frontend/src/utils/vrmPoseApplier.ts`

新增 `_boneRotTemp` 模組頂層暫存，讓 `eulerToBoneRot` 寫入而非回傳新物件；
將 `slerpBone` 改為 `slerpBoneInto`，接受 `out` 參數原地寫入。

- [ ] **Step 1: 在模組頂層 reusable 物件區塊新增 `_boneRotTemp`**

找到這段（約 line 97-103）：

```ts
// ─── Reusable THREE objects – avoids per-frame allocations ────────────────────

const _targetQuat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _prev = new THREE.Quaternion();
const _target = new THREE.Quaternion();
```

改為：

```ts
// ─── Reusable THREE objects – avoids per-frame allocations ────────────────────

const _targetQuat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _prev = new THREE.Quaternion();
const _target = new THREE.Quaternion();

// Temp BoneRotation written by eulerToBoneRot; caller must consume before next call.
const _boneRotTemp: BoneRotation = { x: 0, y: 0, z: 0, w: 0 };
```

（`BoneRotation` 是從 `'./kalidokitSolver'` 匯入的型別，已在檔案中使用。）

- [ ] **Step 2: 重構 `eulerToBoneRot`**

找到：

```ts
function eulerToBoneRot(e: { x: number; y: number; z: number }): BoneRotation {
  _euler.set(e.x, e.y, e.z, 'XYZ')
  _quat.setFromEuler(_euler)
  return { x: _quat.x, y: _quat.y, z: _quat.z, w: _quat.w }
}
```

改為：

```ts
function eulerToBoneRot(e: { x: number; y: number; z: number }): BoneRotation {
  _euler.set(e.x, e.y, e.z, 'XYZ');
  _quat.setFromEuler(_euler);
  _boneRotTemp.x = _quat.x;
  _boneRotTemp.y = _quat.y;
  _boneRotTemp.z = _quat.z;
  _boneRotTemp.w = _quat.w;
  return _boneRotTemp; // caller must consume immediately — do not store reference
}
```

- [ ] **Step 3: 重構 `slerpBone` → `slerpBoneInto`**

找到：

```ts
function slerpBone(
  cur: BoneRotation,
  prev: BoneRotation | undefined,
  smoothing: number,
): BoneRotation {
  if (!prev) return cur
  _prev.set(prev.x, prev.y, prev.z, prev.w)
  _target.set(cur.x, cur.y, cur.z, cur.w)
  _prev.slerp(_target, 1 - smoothing)
  return { x: _prev.x, y: _prev.y, z: _prev.z, w: _prev.w }
}
```

整段取代為（函式名稱改變，簽名改變）：

```ts
function slerpBoneInto(
  cur: BoneRotation,
  prev: BoneRotation,
  smoothing: number,
  out: BoneRotation,
): void {
  // Read prev atomically before writing out (prev === out is safe)
  _prev.set(prev.x, prev.y, prev.z, prev.w);
  _target.set(cur.x, cur.y, cur.z, cur.w);
  _prev.slerp(_target, 1 - smoothing);
  out.x = _prev.x;
  out.y = _prev.y;
  out.z = _prev.z;
  out.w = _prev.w;
}
```

- [ ] **Step 4: TypeScript 型別檢查（此時 `solveHand` 尚未更新，預期有 error）**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```

期望：看到 `slerpBone` / `slerpBoneInto` 相關 error（正常，Task 3 會修正）。如果有其他無關 error，先記錄不處理。

- [ ] **Step 5: Commit（WIP — 型別尚未修齊）**

```bash
git add frontend/src/utils/vrmPoseApplier.ts
git commit -m "refactor: add _boneRotTemp, rewrite eulerToBoneRot/slerpBoneInto for zero alloc"
```

---

### Task 3: 重構 `PoseApplyState`、`createPoseApplyState` 與 `solveHand`

**Files:**
- Modify: `frontend/src/utils/vrmPoseApplier.ts`

將 `prevLeftHandBones`/`prevRightHandBones` 替換為預配置的 `leftHandBones`/`rightHandBones`；
`solveHand` 改為寫入 `outBones` 而非回傳新物件。

- [ ] **Step 1: 修改 `PoseApplyState` 介面**

找到：

```ts
export interface PoseApplyState {
  prevRotations: Record<string, BoneRotation>;
  /** Cached solver output – reused for 60 fps lerp between 30 fps pose frames */
  cachedBoneRotations: Record<string, BoneRotation> | null;
  cachedHipsPos: { x: number; y: number; z: number } | null;
  /** Previous hand bone rotations – used for gesture slerp smoothing */
  prevLeftHandBones: Record<string, BoneRotation>;
  prevRightHandBones: Record<string, BoneRotation>;
}
```

改為：

```ts
export interface PoseApplyState {
  prevRotations: Record<string, BoneRotation>;
  /** Cached solver output – reused for 60 fps lerp between 30 fps pose frames */
  cachedBoneRotations: Record<string, BoneRotation> | null;
  cachedHipsPos: { x: number; y: number; z: number } | null;
  /** Pre-allocated hand bone maps; updated in-place each frame (replaces prevLeft/RightHandBones) */
  leftHandBones: Record<string, BoneRotation>;
  rightHandBones: Record<string, BoneRotation>;
}
```

- [ ] **Step 2: 修改 `createPoseApplyState`**

找到：

```ts
export function createPoseApplyState(): PoseApplyState {
  return {
    prevRotations: {},
    cachedBoneRotations: null,
    cachedHipsPos: null,
    prevLeftHandBones: {},
    prevRightHandBones: {},
  };
}
```

改為：

```ts
export function createPoseApplyState(): PoseApplyState {
  const leftHandBones: Record<string, BoneRotation> = {};
  for (const boneName of Object.values(LEFT_HAND_BONE_MAP)) {
    leftHandBones[boneName] = { x: 0, y: 0, z: 0, w: 1 };
  }
  const rightHandBones: Record<string, BoneRotation> = {};
  for (const boneName of Object.values(RIGHT_HAND_BONE_MAP)) {
    rightHandBones[boneName] = { x: 0, y: 0, z: 0, w: 1 };
  }
  return {
    prevRotations: {},
    cachedBoneRotations: null,
    cachedHipsPos: null,
    leftHandBones,
    rightHandBones,
  };
}
```

- [ ] **Step 3: 移除 `SolveHandResult` 介面並重寫 `solveHand`**

找到 `SolveHandResult` 介面定義及整個 `solveHand` 函式，完整取代為：

```ts
/**
 * Solve one hand's VRM finger-bone rotations from 21 MediaPipe landmarks.
 * Writes results directly into `outBones` (in-place update, no heap allocation).
 *
 * @param landmarks  21 normalized hand landmarks from HandLandmarker
 * @param side       MediaPipe handedness ("Left" | "Right") – person's perspective
 * @param outBones   Pre-allocated bone map (also serves as prev-frame source for slerp)
 * @param smoothing  0 = snap to target, 0.9 = very slow follow
 * @returns gesture detected, or null if landmarks invalid
 */
export function solveHand(
  landmarks: HandLandmark[],
  side: 'Left' | 'Right',
  outBones: Record<string, BoneRotation>,
  smoothing: number,
): HandGesture | null {
  if (landmarks.length < 21) return null;

  const gesture = detectGesture(landmarks);
  const boneMap = side === 'Left' ? LEFT_HAND_BONE_MAP : RIGHT_HAND_BONE_MAP;
  const vrmSide = side === 'Left' ? 'Right' : 'Left';
  const isVrmLeft = vrmSide === 'Left';

  for (const [role, vrmName] of Object.entries(boneMap)) {
    let euler: { x: number; y: number; z: number };

    if (role === 'Wrist') {
      euler = EULER_OPEN;
    } else if (gesture === 'Open') {
      euler = EULER_OPEN;
    } else {
      if (role.startsWith('Thumb')) {
        euler = isVrmLeft ? FIST_THUMB_L : FIST_THUMB_R;
      } else {
        euler = isVrmLeft ? FIST_FINGER_L : FIST_FINGER_R;
      }
    }

    const cur = eulerToBoneRot(euler); // writes into _boneRotTemp
    const bone = outBones[vrmName];
    if (bone) {
      slerpBoneInto(cur, bone, smoothing, bone); // prev === out: safe (atomic read first)
    } else {
      // Safety fallback: should not happen when PoseApplyState is created via createPoseApplyState
      outBones[vrmName] = { x: cur.x, y: cur.y, z: cur.z, w: cur.w };
    }
  }

  return gesture;
}
```

- [ ] **Step 4: 更新 `applyPoseToVrm` 中呼叫 `solveHand` 的兩處**

找到：

```ts
if (frame.leftHandLandmarks && frame.leftHandLandmarks.length >= 21) {
  const result = solveHand(
    frame.leftHandLandmarks as HandLandmark[],
    'Left',
    state.prevLeftHandBones,
    solverSmoothing,
  );
  if (result) {
    applyHandBones(humanoid, result.bones, t);
    state.prevLeftHandBones = result.bones;
  }
}
if (frame.rightHandLandmarks && frame.rightHandLandmarks.length >= 21) {
  const result = solveHand(
    frame.rightHandLandmarks as HandLandmark[],
    'Right',
    state.prevRightHandBones,
    solverSmoothing,
  );
  if (result) {
    applyHandBones(humanoid, result.bones, t);
    state.prevRightHandBones = result.bones;
  }
}
```

改為：

```ts
if (frame.leftHandLandmarks && frame.leftHandLandmarks.length >= 21) {
  const gesture = solveHand(
    frame.leftHandLandmarks as HandLandmark[],
    'Left',
    state.leftHandBones,
    solverSmoothing,
  );
  if (gesture !== null) {
    applyHandBones(humanoid, state.leftHandBones, t);
  }
}
if (frame.rightHandLandmarks && frame.rightHandLandmarks.length >= 21) {
  const gesture = solveHand(
    frame.rightHandLandmarks as HandLandmark[],
    'Right',
    state.rightHandBones,
    solverSmoothing,
  );
  if (gesture !== null) {
    applyHandBones(humanoid, state.rightHandBones, t);
  }
}
```

- [ ] **Step 5: TypeScript 型別檢查（應全數通過）**

```bash
cd frontend && npx tsc --noEmit
```

期望：0 errors。

- [ ] **Step 6: 開啟瀏覽器驗證手部動畫**

啟動開發伺服器（若尚未啟動）：
```bash
cd frontend && npm run dev
```

在 BigScreen 頁面確認：
- 舉手時手指開合動畫正常（Open / Fist）
- 手部骨骼不會瞬間彈回 T-pose
- 臉部表情（眨眼、嘴型）正常

- [ ] **Step 7: Commit**

```bash
git add frontend/src/utils/vrmPoseApplier.ts
git commit -m "refactor: pre-alloc PoseApplyState hand bones, solveHand writes in-place"
```

---

### Task 4: 重構 `projectToUV` + 新增 `AvatarSlot._propUV`

**Files:**
- Modify: `frontend/src/utils/propInteraction.ts`
- Modify: `frontend/src/hooks/useBigScreenScene.ts`

`projectToUV` 改為 output-parameter 模式；在 `AvatarSlot` 新增 `_propUV` 預配置物件。

- [ ] **Step 1: 修改 `propInteraction.ts` 中的 `projectToUV`**

找到：

```ts
export function projectToUV(
  worldPos: THREE.Vector3,
  camera: THREE.Camera,
): { x: number; y: number } {
  _ndcPos.copy(worldPos).project(camera);
  return {
    x: (_ndcPos.x + 1) / 2,
    y: (1 - _ndcPos.y) / 2,
  };
}
```

改為：

```ts
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

- [ ] **Step 2: 在 `useBigScreenScene.ts` 的 `AvatarSlot` 介面新增 `_propUV`**

找到 `AvatarSlot` 介面（約 line 51-83）：

```ts
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
    // ... (keep as-is)
  };
}
```

在 `interaction` 欄位之後新增：

```ts
  /** Pre-allocated output for projectToUV — avoids per-frame {x,y} allocation */
  _propUV: { x: number; y: number };
```

- [ ] **Step 3: 在 `ensureAvatar` 的 slot 建立處加入 `_propUV`**

找到 `ensureAvatar` 內建立 `slot` 物件的程式碼（約 line 569-587）：

```ts
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
```

在 `interaction` 後新增 `_propUV`：

```ts
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
  _propUV: { x: 0, y: 0 },
};
```

- [ ] **Step 4: 更新 RAF 迴圈中 `projectToUV` 呼叫點**

在 RAF 內找到 prop 互動的 `displayed` 狀態區塊（約 line 344-375）：

```ts
if (cameraRef.current) {
  const propUV = projectToUV(prop.position, cameraRef.current);

  for (const hand of ['right', 'left'] as const) {
    // ...
    const near = isHandNearProp(wristUV, propUV);
    // ...
  }
}
```

改為：

```ts
if (cameraRef.current) {
  projectToUV(prop.position, cameraRef.current, slot._propUV);

  for (const hand of ['right', 'left'] as const) {
    // ...
    const near = isHandNearProp(wristUV, slot._propUV);
    // ...
  }
}
```

- [ ] **Step 5: TypeScript 型別檢查**

```bash
cd frontend && npx tsc --noEmit
```

期望：0 errors。

- [ ] **Step 6: 在瀏覽器驗證 Prop 互動**

在 BigScreen 頁面：
- 確認 prop 高光（emissive 脈衝）正常出現
- 舉拳靠近 prop 後可成功抓取（prop 跟隨手移動）
- 放開手後 prop 順滑返回 displayPos

- [ ] **Step 7: Commit**

```bash
git add frontend/src/utils/propInteraction.ts frontend/src/hooks/useBigScreenScene.ts
git commit -m "refactor: projectToUV output-param + AvatarSlot._propUV pre-alloc"
```

---

### Task 5: 預配置 `avgPoseIntervals` in `useBigScreenScene.ts`

**Files:**
- Modify: `frontend/src/hooks/useBigScreenScene.ts`

消除 onStats 路徑中每幀的 `Object.fromEntries` + spread + map 分配。

- [ ] **Step 1: 新增 `avgPoseIntervalsRef`**

在 `useBigScreenScene` hook 頂部的 refs 區塊中（`onStatsRef` 附近）新增：

```ts
const avgPoseIntervalsRef = useRef<Record<string, number>>({});
```

- [ ] **Step 2: 取代 RAF 末尾的 onStats block**

找到：

```ts
const cb = onStatsRef.current;
if (cb) {
  cb({
    frameMs: delta * 1000,
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    avatarCount: avatarsRef.current.size,
    avgPoseIntervals: Object.fromEntries(
      [...avatarsRef.current.entries()].map(([id, s]) => [id, s.avgPoseIntervalMs]),
    ),
  });
}
```

改為：

```ts
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
```

- [ ] **Step 3: TypeScript 型別檢查**

```bash
cd frontend && npx tsc --noEmit
```

期望：0 errors。

- [ ] **Step 4: 在瀏覽器驗證 StatsPanel 顯示**

按 `` ` `` 開啟 StatsPanel，確認：
- `Pose intervals` 區塊顯示正確的 identity 名稱與 ms 數值
- avatar 離開時，對應條目從面板消失（不殘留舊 key）

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useBigScreenScene.ts
git commit -m "refactor: pre-alloc avgPoseIntervals ref, eliminate per-frame Object.fromEntries"
```

---

### Task 6: 最終驗證

**Files:** 無修改

- [ ] **Step 1: 確認完整 TypeScript 編譯無誤**

```bash
cd frontend && npx tsc --noEmit
```

期望：0 errors。

- [ ] **Step 2: Chrome DevTools Memory 驗證（選做）**

1. 開啟 BigScreen，接入 2+ 個 avatar
2. DevTools → Memory → Allocation instrumentation on timeline → 錄製 10 秒
3. 確認 RAF 期間不再有大量 `Object` 分配（手部骨骼物件應消失）

- [ ] **Step 3: 功能回歸確認**

| 功能 | 驗收 |
|------|------|
| 身體骨骼動畫 | 流暢，無 T-pose 閃現 |
| 手部開合姿態 | Open / Fist 切換正常 |
| 臉部表情 | 眨眼、嘴型跟隨 |
| Prop 抓取 | 高光 → 抓取 → 跟隨 → 放手 → 返回 |
| StatsPanel | `` ` `` 切換，數值正確 |

- [ ] **Step 4: 最終 commit（如有未提交更動）**

```bash
git status
# 若乾淨則無需 commit
```
