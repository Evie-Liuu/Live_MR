# BigScreen 效能指標面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增可切換詳細效能指標面板（多邊形面數等 7 項 GPU/場景統計），同時修復 poseUpdateCount 每幀 re-render 問題並加入 pixelRatio 上限。

**Architecture:** `useBigScreenScene` RAF loop 末尾透過 `onStatsRef` callback 將 `StatsSnapshot` 回傳給 `BigScreen`；`BigScreen` 以 `` ` `` 鍵切換 `showStats`，`onStats` 僅在 `showStats` 為 true 時才傳入，panel 隱藏時 overhead 為零。`StatsPanel` 為純展示元件。

**Tech Stack:** React 18, TypeScript, Three.js, @pixiv/three-vrm

---

## 檔案清單

| 動作 | 路徑 | 說明 |
|------|------|------|
| 新增 | `frontend/src/components/StatsPanel.tsx` | 純展示元件 + `StatsSnapshot` 型別 |
| 修改 | `frontend/src/hooks/useBigScreenScene.ts` | 加 `onStats` option、ref 包覆、pixelRatio 上限、RAF 末尾回呼 |
| 修改 | `frontend/src/components/BigScreen.tsx` | `showStats` state、keydown toggle、poseUpdateCount 優化、傳入 `onStats` |

---

## Task 1：建立 `StatsPanel` 元件與 `StatsSnapshot` 型別

**Files:**
- Create: `frontend/src/components/StatsPanel.tsx`

- [ ] **Step 1：建立檔案**

建立 `frontend/src/components/StatsPanel.tsx`，完整內容如下：

```tsx
export interface StatsSnapshot {
  frameMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  avatarCount: number;
  avgPoseIntervals: Record<string, number>;
}

interface StatsPanelProps {
  data: StatsSnapshot;
}

export default function StatsPanel({ data }: StatsPanelProps) {
  const style: React.CSSProperties = {
    position: 'absolute',
    bottom: 10,
    left: 10,
    background: 'rgba(0,0,0,0.75)',
    color: '#0f0',
    padding: '6px 10px',
    borderRadius: '4px',
    fontFamily: 'monospace',
    fontSize: '12px',
    zIndex: 9999,
    pointerEvents: 'none',
    lineHeight: '1.6',
    whiteSpace: 'pre',
  };

  const fmt = (n: number) => n.toLocaleString();
  const fmtMs = (n: number) => n.toFixed(1);

  const intervalLines = Object.entries(data.avgPoseIntervals)
    .map(([id, ms]) => `  ${id.slice(0, 16).padEnd(16)} ${fmtMs(ms)} ms`)
    .join('\n');

  const text = [
    `[perf] Frame:   ${fmtMs(data.frameMs)} ms`,
    `       Draw:    ${fmt(data.drawCalls)}`,
    `       Tris:    ${fmt(data.triangles)}`,
    `       Geo:     ${fmt(data.geometries)}   Tex: ${fmt(data.textures)}`,
    `       Avatars: ${data.avatarCount}`,
    intervalLines ? `       Pose intervals:\n${intervalLines}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return <div style={style}>{text}</div>;
}
```

- [ ] **Step 2：確認 TypeScript 編譯無錯**

```bash
cd C:/Project/Live_MR/frontend
npx tsc --noEmit 2>&1 | head -30
```

Expected: 無錯誤（或只有與此次修改無關的既有警告）

- [ ] **Step 3：Commit**

```bash
cd C:/Project/Live_MR
git add frontend/src/components/StatsPanel.tsx
git commit -m "feat: add StatsPanel component and StatsSnapshot type"
```

---

## Task 2：在 `useBigScreenScene` 加入 `onStats` 支援與 pixelRatio 上限

**Files:**
- Modify: `frontend/src/hooks/useBigScreenScene.ts`

- [ ] **Step 1：import `StatsSnapshot`**

在 `useBigScreenScene.ts` 頂端加入 import（放在現有 import 群末尾）：

```ts
import type { StatsSnapshot } from '../components/StatsPanel';
```

- [ ] **Step 2：在 `UseBigScreenSceneOptions` 介面新增 `onStats`**

找到：
```ts
interface UseBigScreenSceneOptions {
  /** Scene preset ID (default: 'classroom') */
  sceneId?: string;
  /** VRM source ID used for all avatars (default: 'default') */
  vrmSourceId?: string;
  /** Slot assignments from HostSession: slotId → participant identity */
  slotAssignments?: Record<string, string>;
  /** Currently active task ID — tracked for Phase 2 interaction triggers */
  currentTaskId?: string;
}
```

改為：
```ts
interface UseBigScreenSceneOptions {
  /** Scene preset ID (default: 'classroom') */
  sceneId?: string;
  /** VRM source ID used for all avatars (default: 'default') */
  vrmSourceId?: string;
  /** Slot assignments from HostSession: slotId → participant identity */
  slotAssignments?: Record<string, string>;
  /** Currently active task ID — tracked for Phase 2 interaction triggers */
  currentTaskId?: string;
  /** Called once per frame with renderer stats. Only passed when stats panel is visible. */
  onStats?: (s: StatsSnapshot) => void;
}
```

- [ ] **Step 3：在 hook 函式內解構 `onStats` 並建立 ref**

找到：
```ts
  const { sceneId = DEFAULT_SCENE_ID, vrmSourceId = DEFAULT_VRM_SOURCE_ID, slotAssignments, currentTaskId } = options;
```

改為：
```ts
  const { sceneId = DEFAULT_SCENE_ID, vrmSourceId = DEFAULT_VRM_SOURCE_ID, slotAssignments, currentTaskId, onStats } = options;
```

然後在緊接著的 `sceneRef`, `rendererRef` ... 宣告群組末尾（`currentTaskIdRef` 那行之後）加入：

```ts
  const onStatsRef = useRef<((s: StatsSnapshot) => void) | undefined>(undefined);
  onStatsRef.current = onStats;
```

- [ ] **Step 4：設定 pixelRatio 上限**

在 `useBigScreenScene.ts` 場景初始化區塊，找到：
```ts
    renderer.setPixelRatio(window.devicePixelRatio);
```

改為：
```ts
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
```

- [ ] **Step 5：在 RAF loop 末尾（`renderer.render()` 之後）加入 onStats 回呼**

找到：
```ts
      if (cameraRef.current) {
        renderer.render(scene, cameraRef.current);
      }
    };
```

改為：
```ts
      if (cameraRef.current) {
        renderer.render(scene, cameraRef.current);
      }

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
    };
```

- [ ] **Step 6：確認 TypeScript 編譯無錯**

```bash
cd C:/Project/Live_MR/frontend
npx tsc --noEmit 2>&1 | head -30
```

Expected: 無錯誤

- [ ] **Step 7：Commit**

```bash
cd C:/Project/Live_MR
git add frontend/src/hooks/useBigScreenScene.ts
git commit -m "feat: expose onStats callback and cap pixelRatio to 2 in useBigScreenScene"
```

---

## Task 3：更新 `BigScreen.tsx`——poseUpdateCount 優化 + showStats + StatsPanel

**Files:**
- Modify: `frontend/src/components/BigScreen.tsx`

- [ ] **Step 1：新增 import**

在 `BigScreen.tsx` 現有 import 列表末尾加入：

```ts
import StatsPanel, { type StatsSnapshot } from './StatsPanel.tsx';
```

- [ ] **Step 2：以 ref + interval 取代每 pose 幀的 `setPoseUpdateCount`**

找到：
```ts
  const [poseUpdateCount, setPoseUpdateCount] = useState(0);
```

改為：
```ts
  const poseCountRef = useRef(0);
  const [poseUpdateCount, setPoseUpdateCount] = useState(0);
```

然後加入以下 `useEffect`（放在 `poseCountRef` 宣告後方）：

```ts
  useEffect(() => {
    const id = setInterval(() => {
      setPoseUpdateCount(poseCountRef.current);
    }, 1000);
    return () => clearInterval(id);
  }, []);
```

> `poseUpdateCount` 仍是**單調遞增累積值**（`poseCountRef.current` 的快照），每秒同步一次給 React state；`PerformanceMonitor count` mode 內部計算 delta，可正確算出 FPS。

- [ ] **Step 3：移除 pose handler 中的 `setPoseUpdateCount`**

找到 BroadcastChannel `onmessage` 內：
```ts
        applyPoseRef.current(msg.identity, msg.poseData);
        setPoseUpdateCount(c => c + 1);
```

改為：
```ts
        applyPoseRef.current(msg.identity, msg.poseData);
        poseCountRef.current++;
```

- [ ] **Step 4：新增 `showStats` / `statsData` state**

在 `poseUpdateCount` state 宣告後方加入：

```ts
  const [showStats, setShowStats] = useState(false);
  const [statsData, setStatsData] = useState<StatsSnapshot | null>(null);
```

- [ ] **Step 5：新增 keydown listener useEffect**

在現有 useEffect 群組末尾（錄影 restore effect 之後，snapshot effect 之前）加入：

```ts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '`') setShowStats(v => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
```

- [ ] **Step 6：把 `onStats` 傳入 `useBigScreenScene`，並修正 `PerformanceMonitor` 的 prop**

找到：
```ts
  const { applyPose, removeAvatar, swapAvatar, setVrmOverride, ensureAvatar } = useBigScreenScene(canvasRef, { sceneId, vrmSourceId, slotAssignments, currentTaskId });
```

改為：
```ts
  const { applyPose, removeAvatar, swapAvatar, setVrmOverride, ensureAvatar } = useBigScreenScene(canvasRef, {
    sceneId,
    vrmSourceId,
    slotAssignments,
    currentTaskId,
    onStats: showStats ? setStatsData : undefined,
  });
```

找到：
```tsx
      <PerformanceMonitor label="Pose Rx FPS" trigger={poseUpdateCount} position="bottom-right" />
```

改為：
```tsx
      <PerformanceMonitor label="Pose Rx FPS" count={poseUpdateCount} position="bottom-right" />
```

- [ ] **Step 7：在 JSX 中加入 `StatsPanel`**

找到：
```tsx
      <PerformanceMonitor label="Render FPS" position="top-right" />
      <PerformanceMonitor label="Pose Rx FPS" count={poseUpdateCount} position="bottom-right" />
```

改為：
```tsx
      <PerformanceMonitor label="Render FPS" position="top-right" />
      <PerformanceMonitor label="Pose Rx FPS" count={poseUpdateCount} position="bottom-right" />
      {showStats && statsData && <StatsPanel data={statsData} />}
```

- [ ] **Step 8：確認 TypeScript 編譯無錯**

```bash
cd C:/Project/Live_MR/frontend
npx tsc --noEmit 2>&1 | head -30
```

Expected: 無錯誤

- [ ] **Step 9：Commit**

```bash
cd C:/Project/Live_MR
git add frontend/src/components/BigScreen.tsx
git commit -m "feat: add StatsPanel toggle (backtick key) and optimize poseUpdateCount re-renders"
```

---

## Task 4：手動驗收

- [ ] **Step 1：啟動開發伺服器**

```bash
cd C:/Project/Live_MR/frontend
npm run dev
```

- [ ] **Step 2：開啟大屏視窗**

在 Host Session 頁面開啟 BigScreen（`/?screen=bigscreen`）。

- [ ] **Step 3：驗收條件 1 — 切換**

按 `` ` ``（backtick）應出現 StatsPanel；再按應隱藏。現有 Render FPS / Pose Rx FPS 顯示應不受影響。

- [ ] **Step 4：驗收條件 2 — 指標正確**

StatsPanel 顯示時應可見：
- `Frame: X.X ms`（合理值：10–30 ms）
- `Draw: N`（有場景時 > 0）
- `Tris: N,NNN`（有 VRM 時應為數萬以上）
- `Geo: N  Tex: N`（應 > 0）
- `Avatars: N`（與當前 avatar 數一致）
- 有 avatar 時出現 `Pose intervals:` 區塊，每 identity 一行

- [ ] **Step 5：驗收條件 3 — panel 隱藏時無 overhead**

隱藏 panel 後，在 DevTools Performance 錄製 2 秒，確認無因 `setStatsData` 觸發的 React 更新。

- [ ] **Step 6：驗收條件 4 — pixelRatio**

DevTools Console 執行：
```js
document.querySelector('#bigscreen-canvas').__three_renderer?.getPixelRatio()
```
或在場景初始化後於 console 觀察：HiDPI 螢幕上應不超過 2。

- [ ] **Step 7：驗收條件 5 — Pose Rx FPS re-render 頻率**

DevTools React Profiler 錄製，確認 `BigScreen` 因 `poseRxFps` 的 re-render 約每秒 1 次（而非每 pose 幀一次）。
