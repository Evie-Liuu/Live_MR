# PoseFrame 預配置緩衝區設計

**日期**：2026-05-08
**範圍**：`frontend/src/hooks/usePoseDetection.ts`
**目標**：消除每幀 `.map()` 建立的臨時物件，降低 GC 壓力

---

## 問題背景

`usePoseDetection` 每 33ms 執行一次 MediaPipe 推論。推論完成後，以 `.map()` 將原始 landmark 結果轉換為 `PoseLandmark` 物件陣列：

- `pose.landmarks[0].map(...)` → 33 個新物件
- `pose.worldLandmarks[0].map(...)` → 33 個新物件
- `faceResult.faceLandmarks[0].map(...)` → 478 個新物件
- `handResult.landmarks[hi].map(...)` → 21 個新物件 × 最多 2 手
- `FaceBlendshapes = {}` → 1 個新物件（內含 52+ key 更新）

全功能開啟時，每幀產生約 586 個短命物件，每秒 ~17,580 個，造成頻繁 GC 停頓。

---

## 設計決策

### 為何 `frame.landmarks`（pose 33點）不預配置

`StudentSession.tsx:54` 呼叫 `setLandmarks(lms)`，將 `frame.landmarks` 存入 React state。React 以參考相等性判斷是否需要重新渲染：若每幀傳入同一個陣列參考，overlay 將不更新。因此 pose landmarks 必須每幀建立新陣列，維持目前的 `.map()` 做法。

`HostSession.tsx` 傳入 `undefined` 作為 `onLandmarksUpdate`，不受此限制。

### 其他陣列可安全重用

- `worldLandmarks`、`faceLandmarks`、手部 landmarks 不存入 React state
- `encodePoseFrame(frame)` 同步讀取完畢後即丟棄參考
- 重用相同陣列參考在單一 RAF tick 內是安全的

---

## 實作方案

### 緩衝區（在 `init()` 內、loop 啟動前建立一次）

```typescript
const worldLandmarksBuf: PoseLandmark[] =
  Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
const faceLandmarksBuf: PoseLandmark[] =
  Array.from({ length: 478 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
const leftHandBuf: PoseLandmark[] =
  Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
const rightHandBuf: PoseLandmark[] =
  Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
const blendshapesBuf: FaceBlendshapes = {};
```

### 幀內資料流

```
MediaPipe result
  ├─ pose.landmarks[0]        → .map() → frame.landmarks      (新陣列，React state 安全)
  ├─ pose.worldLandmarks[0]   → for 迴圈原地寫 → worldLandmarksBuf
  ├─ face.faceLandmarks[0]    → for 迴圈原地寫 → faceLandmarksBuf
  ├─ face.blendshapes         → for 迴圈原地寫 → blendshapesBuf
  ├─ hand.landmarks[hi]       → for 迴圈原地寫 → leftHandBuf / rightHandBuf
  └─ encodePoseFrame(frame)   → Uint8Array → publish（同步讀取）
```

### for 迴圈替代 `.map()`（以 worldLandmarks 為例）

```typescript
// 改前
worldLandmarks: result.worldLandmarks[0].map((l) => ({
  x: l.x, y: l.y, z: l.z, visibility: l.visibility ?? 0,
}))

// 改後
const wlRaw = result.worldLandmarks[0];
for (let i = 0; i < wlRaw.length; i++) {
  const w = worldLandmarksBuf[i];
  w.x = wlRaw[i].x; w.y = wlRaw[i].y; w.z = wlRaw[i].z;
  w.visibility = wlRaw[i].visibility ?? 0;
}
// frame.worldLandmarks = worldLandmarksBuf（直接指定）
```

---

## 效益

| 項目 | 改前 | 改後 |
|---|---|---|
| 每幀新建物件數 | ~586（全功能）| 33（pose landmarks）|
| 每秒 GC 壓力 | ~17,580 物件 | ~990 物件（降低 94%）|
| 修改檔案數 | — | 1（`usePoseDetection.ts`）|
| API / 行為變動 | — | 無 |

---

## 邊界條件

- `worldLandmarks` 為空時：沿用現有 `result.worldLandmarks.length > 0` 判斷，`frame.worldLandmarks` 設為 `[]`（不使用 buf）
- Face/Hand 未啟用時：緩衝區仍配置但不使用，記憶體成本可忽略（478+21+21 個小物件）
- 手部數量可能為 0、1 或 2：以 `handResult.handedness[hi][0].categoryName` 判斷 left/right，不依賴索引順序

---

## 不在範圍內

- 移入 Web Worker
- 錯開偵測器（另行評估）
- `StudentSession.tsx` 的 `landmarks` 改為 `useRef`
