# BigScreen 效能指標面板設計

**日期：** 2026-04-18  
**狀態：** 已核准

## 目標

1. 優化 BigScreen 渲染流程中的既有效能問題
2. 新增可切換的詳細效能指標面板（含多邊形面數等 GPU/場景統計）

## 範圍

- `hooks/useBigScreenScene.ts`
- `components/BigScreen.tsx`
- `components/StatsPanel.tsx`（新增）
- 不動：`PerformanceMonitor.tsx`、BroadcastChannel 邏輯、VRM 載入、錄影功能

---

## 架構

### 資料流

```
useBigScreenScene (RAF loop 末尾)
  └── onStats?.( StatsSnapshot )
        ↓
BigScreen (handleStats → setStatsData)
  └── showStats && <StatsPanel data={statsData} />
```

- `onStats` 只在 `showStats === true` 時傳入 hook；panel 隱藏時 callback 為 `undefined`，overhead 為零。
- `StatsPanel` 為純展示元件，無副作用。

### 切換方式

鍵盤快捷鍵：`` ` ``（backtick）在大屏本地切換 `showStats`。現有兩個 `PerformanceMonitor`（Render FPS / Pose Rx FPS）**常駐不變**，只有詳細面板受切換控制。

---

## 型別定義

```ts
// components/StatsPanel.tsx (exported)
export interface StatsSnapshot {
  frameMs: number;                            // 單幀耗時 ms
  drawCalls: number;                          // renderer.info.render.calls
  triangles: number;                          // renderer.info.render.triangles
  geometries: number;                         // renderer.info.memory.geometries
  textures: number;                           // renderer.info.memory.textures
  avatarCount: number;                        // 場景中目前的 avatar 數量
  avgPoseIntervals: Record<string, number>;   // identity → avgPoseIntervalMs
}
```

---

## 各檔案修改細節

### `hooks/useBigScreenScene.ts`

**Option 新增：**
```ts
interface UseBigScreenSceneOptions {
  // ... 現有欄位 ...
  onStats?: (s: StatsSnapshot) => void;
}
```

**RAF loop 末尾（`renderer.render()` 之後）：**
```ts
if (onStats) {
  onStats({
    frameMs: delta * 1000,
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    avatarCount: avatarsRef.current.size,
    avgPoseIntervals: Object.fromEntries(
      [...avatarsRef.current.entries()].map(([id, s]) => [id, s.avgPoseIntervalMs])
    ),
  });
}
```

**Pixel ratio 上限（場景初始化）：**
```ts
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
```

**`onStats` 依賴處理：** 用 `useRef` 包 callback（`onStatsRef.current = onStats`），RAF 內讀 ref，避免因 callback 參考變化重建 RAF loop。

### `components/BigScreen.tsx`

**新增 state：**
```ts
const [showStats, setShowStats] = useState(false);
const [statsData, setStatsData] = useState<StatsSnapshot | null>(null);
```

**keydown listener（useEffect，cleanup 需移除）：**
```ts
const onKey = (e: KeyboardEvent) => {
  if (e.key === '`') setShowStats(v => !v);
};
window.addEventListener('keydown', onKey);
return () => window.removeEventListener('keydown', onKey);
```

**poseUpdateCount 優化（移除每 pose 幀的 React re-render）：**
- `poseUpdateCount` 改為 `poseCountRef: useRef<number>(0)`
- 每 pose 幀只做 `poseCountRef.current++`
- 新增 `useEffect` 每秒計算 Pose Rx FPS 並更新 `poseRxFps` state（1 次/秒 re-render，而非 30 次/秒）
- `<PerformanceMonitor label="Pose Rx FPS">` 改接 `count={poseRxFps}` 或直接在 BigScreen 計算後傳 `fps` 數值

**傳入 hook：**
```ts
const { ... } = useBigScreenScene(canvasRef, {
  sceneId, vrmSourceId, slotAssignments, currentTaskId,
  onStats: showStats ? setStatsData : undefined,
});
```

**JSX（常駐 PerformanceMonitor 後方加）：**
```tsx
{showStats && statsData && <StatsPanel data={statsData} />}
```

### `components/StatsPanel.tsx`（新增）

**位置：** `bottom-left`，`position: absolute`  
**樣式：** 半透明黑底（`rgba(0,0,0,0.75)`）、綠字（`#0f0`）、monospace、`pointerEvents: none`、`zIndex: 9999`  
**顯示格式：**
```
[perf] Frame:   16.2 ms
       Draw:    12
       Tris:    84,320
       Geo:     8   Tex: 14
       Avatars: 3
       Pose intervals:
         host-xxx    33 ms
         student-1   41 ms
```

數字超過 999 使用 `toLocaleString()` 加千分位逗號。

---

## 渲染優化項目

| 項目 | 修改位置 | 預期效果 |
|------|----------|---------|
| pixelRatio 上限 2 | `useBigScreenScene` 初始化 | HiDPI 螢幕降低 fill rate |
| poseUpdateCount → ref + interval | `BigScreen.tsx` | 每秒 30 次 React re-render → 1 次 |
| onStats 用 ref 包覆 | `useBigScreenScene` | 避免 RAF loop 因 callback 參考變化重建 |

---

## 不在此次範圍內

- Recording composite RAF loop 優化（需評估背景 DOM 層需求，留待後續）
- 將 StatsPanel 資料透過 BroadcastChannel 傳回 Host（未要求）
- StatsPanel 的歷史曲線圖

---

## 驗收條件

1. 按 `` ` `` 可切換 StatsPanel 顯示/隱藏，現有 PerformanceMonitor 不受影響
2. StatsPanel 顯示時，所有 7 項指標（frame ms、draw calls、triangles、geometries、textures、avatar count、per-avatar pose interval）均正確呈現
3. StatsPanel 隱藏時，`onStats` callback 不執行，無額外 overhead
4. Pixel ratio 最高 2，HiDPI 螢幕下渲染解析度不超過 2x
5. Pose Rx FPS 計算改為每秒更新一次 React state
