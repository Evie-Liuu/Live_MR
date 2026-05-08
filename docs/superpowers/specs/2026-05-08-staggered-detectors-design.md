# 錯開偵測器（Staggered Detectors）設計

**日期**：2026-05-08
**範圍**：`frontend/src/hooks/usePoseDetection.ts`
**目標**：將 Face 與 Hand 偵測頻率從 30 FPS 降至各 15 FPS，減少主執行緒佔用，改善筆電效能

---

## 問題背景

全功能開啟時，每個 33ms throttle tick 均執行三個 MediaPipe 推論：

| 偵測器 | 每幀推論時間（估） | 每秒推論次數 |
|--------|------------------|------------|
| PoseLandmarker | ~8ms | 30 |
| FaceLandmarker | ~10ms | 30 |
| HandLandmarker | ~12ms | 30 |

三者合計每幀最多 ~30ms，在筆電 GPU 上容易超過 33ms 預算，造成幀率下滑與延遲。

---

## 設計決策

### 偵測頻率

- **Pose**：每 tick（33ms）執行，維持 30 FPS — 骨架主要動作來源，不可降頻
- **Face**：每 2 tick 執行一次（66ms，15 FPS） — 表情變化慢，15 FPS 足夠
- **Hand**：每 2 tick 執行一次（66ms，15 FPS），與 Face 錯開 — 手勢也慢於骨架

### 錯開策略

```
tick 0 (t=0ms):   Pose ✓  Face ✓  Hand ✗
tick 1 (t=33ms):  Pose ✓  Face ✗  Hand ✓
tick 2 (t=66ms):  Pose ✓  Face ✓  Hand ✗
tick 3 (t=99ms):  Pose ✓  Face ✗  Hand ✓
...
```

同一 tick 最多執行兩個偵測器（Pose + Face 或 Pose + Hand），避免三個同時競用 GPU。

### 跳過時的 Frame 欄位策略：省略（不保留 stale 快取）

跳過 Face 時，`frame.faceLandmarks`、`frame.faceBlendshapes` 保持 `undefined`（不寫入）。
跳過 Hand 時，`frame.leftHandLandmarks`、`frame.rightHandLandmarks` 保持 `undefined`（不寫入）。

**理由：**
- `encodePoseFrame()` 以 `frame.faceLandmarks?.length` 判斷，`undefined` → `hasFace=false` → 封包縮小 ~6KB
- VRM applier 收到無 face/hand 欄位的 frame 時，SLERP 繼續以上一個已知值內插，視覺不跳動
- 不保留 stale 快取：避免消費端誤以為「這幀確實偵測到」而做出錯誤決策

---

## 實作方案

### 計數器

在 `init()` 內、`lastDetectTime` 旁新增：

```typescript
let lastDetectTime = 0;
let detectionFrame = 0;
```

### throttle block 修改

在 `if (now - lastDetectTime >= DETECT_INTERVAL_MS)` 開頭，`lastDetectTime = now` 之後立刻 capture：

```typescript
if (now - lastDetectTime >= DETECT_INTERVAL_MS) {
  lastDetectTime = now;
  const tick = detectionFrame++;   // 先取值再 +1

  // ... pose detection（不變）...

  // Face：偶數 tick
  if (faceEnabledRef.current && faceRef.current && tick % 2 === 0) {
    // ... 現有 face 偵測邏輯（不變）...
  }

  // Hand：奇數 tick
  if (handEnabledRef.current && handRef.current && tick % 2 === 1) {
    // ... 現有 hand 偵測邏輯（不變）...
  }
}
```

### 改前 vs 改後對照

```typescript
// 改前
if (faceEnabledRef.current && faceRef.current) { ... }
if (handEnabledRef.current && handRef.current) { ... }

// 改後
if (faceEnabledRef.current && faceRef.current && tick % 2 === 0) { ... }
if (handEnabledRef.current && handRef.current && tick % 2 === 1) { ... }
```

---

## 效益

| 項目 | 改前 | 改後 |
|------|------|------|
| 每 tick 推論數（全功能） | 3（Pose+Face+Hand） | 2（Pose+Face 或 Pose+Hand）|
| Face FPS | 30 | 15 |
| Hand FPS | 30 | 15 |
| Pose FPS | 30 | 30（不變）|
| 主執行緒每 33ms 負載 | ~30ms | ~18–20ms（估）|
| 網路封包大小（跳過幀） | 完整 | 自動縮小 ~6KB |
| 修改檔案數 | — | 1（`usePoseDetection.ts`）|
| API / 行為變動 | — | 無 |

---

## 邊界條件

- `faceEnabled=false` 或 `handEnabled=false` 時：原本就不執行，tick 計數繼續正常遞增，不影響
- `detectionFrame` 溢位（Number.MAX_SAFE_INTEGER）：JavaScript 整數精度足夠數十億幀，實際不會發生
- Pose 未找到 landmark 時：tick 仍遞增（在 throttle 頂端），Face/Hand 錯開不受影響

---

## 不在範圍內

- 移入 Web Worker（另行評估）
- 動態調整偵測頻率（基於 GPU 負載回饋）
- 修改 `encodePoseFrame()` 或 VRM applier
