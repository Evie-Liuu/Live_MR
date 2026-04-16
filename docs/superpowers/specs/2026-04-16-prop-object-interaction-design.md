# Prop Object Interaction Design
**Date:** 2026-04-16  
**Branch:** feature/scene-slot-assignment  
**Scope:** 服飾店場景 — 手勢觸發取物 + Prop 跟隨手部

---

## 1. 功能概述

當 VRM 角色站在吊衣桿旁，且當前任務有對應的 task prop 時（例如任務 `ask_price_1` 對應 `Tshirt_Blue.glb`）：

1. **高亮**：task prop 以 emissive 脈衝標示為可互動目標
2. **觸發取物**：偵測到「握拳」+ （手部舉起 OR 手部接近 prop 投影位置）→ prop 鎖定並跟隨該手的 VRM 骨骼
3. **歸位**：偵測到「開掌」或任務切換 → prop lerp 回 displayPos，重新進入高亮狀態

效能原則：純 CPU transform，無額外 draw call，無物理計算。

---

## 2. 新增 / 修改檔案

| 動作 | 路徑 | 說明 |
|------|------|------|
| 新增 | `frontend/src/utils/gestureDetector.ts` | 純函式：fist / openHand / handRaised / handNearProp |
| 新增 | `frontend/src/utils/propInteraction.ts` | Three.js prop 操控：highlight / attachToHand / returnToDisplay / projectToUV |
| 修改 | `frontend/src/hooks/useBigScreenScene.ts` | AvatarSlot 擴充互動欄位，RAF 循環整合狀態機 |
| 修改 | `frontend/src/types/vrm.ts` | （不修改 public 介面，僅內部型別參考） |

---

## 3. 資料流

```
PoseFrame (每幀，來自 slot.lastFrame)
  ├─ gestureDetector.detectFist(handLandmarks)       → isFist
  ├─ gestureDetector.detectOpenHand(handLandmarks)   → isOpen
  ├─ gestureDetector.isHandRaised(poseLandmarks, hand) → isRaised
  └─ gestureDetector.isHandNearProp(wristUV, propUV)  → isNear

RAF 循環（per AvatarSlot）
  1. 若 currentTaskId 對應 prop 存在 → projectToUV(prop.position, camera) → propUV
  2. 讀取 lastFrame 中左/右 handLandmarks
  3. 分別對左右手執行手勢偵測
  4. 狀態機轉換（見第 5 節）
  5. 依狀態執行 highlight / attachToHand / returnToDisplay
```

---

## 4. 手勢偵測規格（`gestureDetector.ts`）

### 4.1 `detectFist(landmarks: PoseLandmark[]): boolean`

MediaPipe HandLandmarker 21 點，影像座標 y 向下（0=頂，1=底）。  
手指捲縮 = tip.y > mcp.y（指尖低於掌指關節）。

| 手指 | tip index | mcp index |
|------|-----------|-----------|
| Index | 8 | 5 |
| Middle | 12 | 9 |
| Ring | 16 | 13 |
| Pinky | 20 | 17 |

**條件**：4 根中至少 3 根 tip.y > mcp.y → `true`（容錯 1 根遮擋）

### 4.2 `detectOpenHand(landmarks: PoseLandmark[]): boolean`

與 detectFist 對稱：4 根中至少 3 根 tip.y < mcp.y → `true`

### 4.3 `isHandRaised(poseLandmarks: PoseLandmark[], hand: 'left' | 'right'): boolean`

使用全身 33 點 pose landmark（影像空間）：

- right: wrist = pose[16], hip = pose[24]
- left:  wrist = pose[15], hip = pose[23]

`wrist.y < hip.y` → 手高於腰部 → `true`

### 4.4 `isHandNearProp(wristUV: {x,y}, propUV: {x,y}, threshold = 0.15): boolean`

```
distance = sqrt((wristUV.x - propUV.x)² + (wristUV.y - propUV.y)²)
return distance ≤ threshold
```

wristUV 來自 `handLandmarks[0]`（MediaPipe wrist = index 0）。  
propUV 由 `propInteraction.projectToUV()` 每幀計算。

### 4.5 觸發條件

```ts
const grab = isFist && (isRaised || isNear);
const release = isOpenHand;
```

---

## 5. 狀態機（per AvatarSlot）

### AvatarSlot 新增欄位（內部型別）

```ts
interaction: {
  propState: 'displayed' | 'held' | 'returning';
  lockHand: 'left' | 'right' | null;
  lastTaskId: string | undefined;
  handLostAt: number;   // performance.now() timestamp，用於 grace period
}
```

### 狀態轉換

```
displayed
  → held：grab 條件成立（fist && (raised || near)）
           記錄 lockHand = 觸發的手

held
  → returning：
      a. detectOpenHand(lockHand 的 landmarks) = true
      b. currentTaskId 改變
      c. lockHand landmarks 消失超過 500ms（handLostAt grace period）

returning
  → displayed：returnPropToDisplay() 回傳 true（距離 < 0.02m）
               同時重置 lockHand = null
```

### 任務切換副作用

- 舊 task prop → 強制 returning（若在 held 或 displayed）
- 新 task prop → 若存在，進入 displayed 並開始高亮

---

## 6. Prop 互動函式（`propInteraction.ts`）

### 6.1 `highlightProp(group, time, enabled)`

```
enabled = true:
  traverse → MeshStandardMaterial / MeshPhysicalMaterial
  emissive = Color(1, 0.8, 0.2)
  emissiveIntensity = 0.4 + 0.35 * sin(time * 2.5)   ← 慢速暖黃脈衝

enabled = false:
  emissiveIntensity = 0
```

### 6.2 `projectToUV(worldPos: THREE.Vector3, camera: THREE.Camera): {x, y}`

```ts
const v = worldPos.clone().project(camera);
return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
```

### 6.3 `attachPropToHand(group, vrm, hand, offset = [0, 0.1, 0.05])`

```ts
const boneName = hand === 'right' ? 'rightHand' : 'leftHand';
const boneNode = vrm.humanoid.getNormalizedBoneNode(boneName);
boneNode.getWorldPosition(tempVec);          // VRM 在 vrm.update() 後已更新
tempVec.add(offsetVec);
group.position.lerp(tempVec, 0.3);          // 輕微 lerp 消除抖動
```

### 6.4 `returnPropToDisplay(group, displayPos, delta): boolean`

```ts
group.position.lerp(displayPos, delta * 8);
return group.position.distanceTo(displayPos) < 0.02;
```

---

## 7. Edge Cases

| 情境 | 處理 |
|------|------|
| 當前任務無對應 prop | 跳過所有互動，無高亮 |
| 兩個 slot 同時握拳 | `heldByIdentity: Map<taskId, identity>` ref 在 `useBigScreenScene` 中；先觸發的 slot 鎖定 prop，其他 slot 的 grab 條件成立時檢查 flag，若已被佔用則不轉換狀態 |
| 任務切換時 prop 在 held 狀態 | 立即切 returning；新 task prop 開始高亮 |
| 手部 landmark 遮擋 | 500ms grace period（`handLostAt`），超時強制 returning |
| 場景切換 | taskPropPool dispose，狀態機隨 scene teardown 清空 |

---

## 8. 不實作項目（明確排除）

- Prop 旋轉跟隨手骨方向（只跟位置，保持 displayPos 初始旋轉）
- 碰撞體積計算
- 多人搶奪 prop 的複雜仲裁
- 任何物理模擬（gravity、swing）

---

## 9. RAF 循環整合位置

`useBigScreenScene.ts` 現有 RAF 的 `slot.vrm.update(delta)` **之後**，`renderer.render()` **之前**插入互動更新邏輯。每幀計算量：

- 1 次 `project()` 投影
- 5 次 float 比較（手勢）
- 1 次 `getWorldPosition()` + 1 次 `lerp()`（held 時）或 1 次 `sin(time)`（displayed 時）
