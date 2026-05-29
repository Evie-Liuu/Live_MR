# AI 互動腳本 + 大屏說話浮動 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 為教師控制台加入「開始互動」固定 15 秒自動腳本（錄老師 → 自動送 AI 出提示），並在大屏加入常駐中央機器人環狀波動 + 各角色 VRM 頭上說話標記；同時預留規則引擎過濾接口。

**Architecture:** 說話狀態以 HostSession 既有 `speakingSet`（LiveKit `ActiveSpeakersChanged`）為單一來源，透過 BroadcastChannel 新訊息 `'speaking'` 推給大屏。大屏依此驅動常駐機器人 CSS 環狀波動，並由 `useBigScreenScene` 每幀（節流）將說話中 avatar 的頭部骨骼投影成 UV 座標回呼，渲染 DOM 頭上標記。「開始互動」沿用既有 transcript effect 的「立即送出」機制（與空白鍵相同），固定 15 秒倒數。規則引擎僅加純函式介面 `transcriptGate`，預設 passthrough。

**Tech Stack:** React 19 + TypeScript + Three.js + @pixiv/three-vrm + Vite。專案無測試 framework — 每個 task 結尾用 `npx tsc -b --noEmit`（型別檢查）+ `npm run lint` + 手動瀏覽器驗證取代自動化測試。所有指令在 `frontend/` 目錄執行。

設計文件：`docs/superpowers/specs/2026-05-29-ai-interaction-script-speaking-ui-design.md`

---

## File Structure

**Create:**
- `frontend/src/config/transcriptGate.ts` — 純函式：transcript → AI 送出前的過濾介面 + 預設 passthrough（規則引擎接口）

**Modify:**
- `frontend/src/components/BigScreen.tsx` — `BigScreenMsg` 加 `'speaking'` 類型與 `speakingIdentities` 欄位；新增 `speakingIdentities`/`speakerAnchors` state；message handler；傳 `speakingIdentities` + `onSpeakerAnchors` 給 hook；渲染常駐機器人（重構 `bs-ai-bar`）+ 頭上標記
- `frontend/src/hooks/useBigScreenScene.ts` — 新增 `speakingIdentities` option 與 `onSpeakerAnchors` 回呼；RAF 迴圈節流投影說話中 avatar 頭部骨骼
- `frontend/src/components/HostSession.tsx` — 廣播 `'speaking'`；新增「開始互動」按鈕 + `interactionPhase` 狀態機 + 15 秒腳本（`autoScriptTriggerRef`）；transcript effect 整合；`handleHint` 串接 `transcriptGate`
- `frontend/src/App.css` — 常駐機器人 + 環狀波動、頭上標記、開始互動按鈕/相位的樣式（檔尾新增）

**Total:** 1 new file, 4 modified files

---

## Task 1: BigScreenMsg 加入 `'speaking'` 訊息型別

**Files:**
- Modify: `frontend/src/components/BigScreen.tsx:24-54`

- [ ] **Step 1: 在 `BigScreenMsg.type` 聯合型別加入 `'speaking'`**

把 `frontend/src/components/BigScreen.tsx` 第 25 行的型別聯合（結尾 `'bg-type-override'`）改成同時包含 `'speaking'`：

```ts
  type: 'pose' | 'leave' | 'scene-change' | 'vrm-change' | 'vrm-identity-change' | 'slot-assign' | 'task-change' | 'recording-start' | 'recording-stop' | 'settlement-done' | 'hint-change' | 'ai-hint' | 'group-transform' | 'camera-bg-device' | 'bg-type-override' | 'speaking';
```

- [ ] **Step 2: 在 `BigScreenMsg` interface 末尾（`bgTypeOverride?` 之後、`}` 之前）加入欄位**

```ts
  /** For 'speaking': 目前正在說話的 participant identity 清單 */
  speakingIdentities?: string[];
```

- [ ] **Step 3: 型別檢查**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: PASS（無新錯誤）

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/BigScreen.tsx
git commit -m "feat: BigScreenMsg 加入 speaking 訊息型別"
```

---

## Task 2: HostSession 廣播說話狀態

**Files:**
- Modify: `frontend/src/components/HostSession.tsx`（`speakingSet` 宣告於 299 行；`channelRef` 於 310 行；在元件 body 內既有 useEffect 區段新增）

- [ ] **Step 1: 新增廣播 useEffect**

在 `frontend/src/components/HostSession.tsx` 的 BroadcastChannel setup useEffect（`1044-1052` 區塊）之後，緊接著插入一個新的 useEffect，依 `speakingSet` 變化把說話清單廣播給大屏：

```tsx
  // 廣播「正在說話」清單給大屏（單一來源 = LiveKit ActiveSpeakers）
  useEffect(() => {
    const msg: BigScreenMsg = {
      type: 'speaking',
      speakingIdentities: Array.from(speakingSet),
    };
    channelRef.current?.postMessage(msg);
  }, [speakingSet]);
```

- [ ] **Step 2: 型別檢查**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: PASS

- [ ] **Step 3: Lint**

Run: `cd frontend && npm run lint`
Expected: PASS（無新增 error）

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/HostSession.tsx
git commit -m "feat: HostSession 廣播 speaking 狀態給大屏"
```

---

## Task 3: BigScreen 接收說話狀態並推導老師/學生

**Files:**
- Modify: `frontend/src/components/BigScreen.tsx`（state 區，約 347 行附近；message handler 約 1671-1693；）

- [ ] **Step 1: 新增 state 與 ref**

在 `frontend/src/components/BigScreen.tsx` 的 `const canvasRef = useRef<HTMLCanvasElement | null>(null);`（347 行）之後新增：

```tsx
  // 正在說話的 identity 集合（由 HostSession 'speaking' 訊息驅動）
  const [speakingIdentities, setSpeakingIdentities] = useState<Set<string>>(new Set());
  const speakingIdentitiesRef = useRef<Set<string>>(speakingIdentities);
  speakingIdentitiesRef.current = speakingIdentities;
```

- [ ] **Step 2: 在 message handler 加入 `'speaking'` 分支**

在 `frontend/src/components/BigScreen.tsx` message handler 的 `} else if (msg.type === 'bg-type-override') {` 區塊結束後（1693 行 `}` 之後、`};` 之前）新增分支：

```tsx
      } else if (msg.type === 'speaking') {
        setSpeakingIdentities(new Set(msg.speakingIdentities ?? []));
      }
```

- [ ] **Step 3: 推導老師/學生說話旗標**

在 `frontend/src/components/BigScreen.tsx` 的 `return (` 之前（`effectiveBgType` 計算之後，約 1710 行）新增：

```tsx
  const teacherSpeaking = useMemo(
    () => Array.from(speakingIdentities).some(id => id.startsWith('host-')),
    [speakingIdentities],
  );
  const studentSpeaking = useMemo(
    () => Array.from(speakingIdentities).some(id => !id.startsWith('host-')),
    [speakingIdentities],
  );
```

- [ ] **Step 4: 型別檢查**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: PASS（`teacherSpeaking`/`studentSpeaking` 暫時未使用會觸發 TS6133 未使用變數）。若報未使用錯誤，本 task 先在兩個變數前各加 `// eslint-disable-next-line @typescript-eslint/no-unused-vars` 並改用 `void teacherSpeaking; void studentSpeaking;` 暫時引用；Task 5 會正式使用後移除。

> 為避免暫時引用的反覆，建議與 Task 5 連續執行。若連續執行，可跳過暫時引用，直接在 Task 5 用到它們。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/BigScreen.tsx
git commit -m "feat: BigScreen 接收 speaking 狀態並推導老師/學生旗標"
```

---

## Task 4: useBigScreenScene 投影說話中 avatar 頭部座標

**Files:**
- Modify: `frontend/src/hooks/useBigScreenScene.ts`（options interface 約 115-145；hook 解構約 151；RAF 迴圈約 399-655）
- 既有可重用：`projectToUV`（`utils/propInteraction.ts:142`，輸出 UV 0..1）；`vrm.humanoid.getNormalizedBoneNode('head')`

- [ ] **Step 1: 在 `UseBigScreenSceneOptions` 加入新欄位**

在 `frontend/src/hooks/useBigScreenScene.ts` 的 `UseBigScreenSceneOptions` interface 末尾（`groupTransforms?` 欄位之後、`}` 之前）新增：

```ts
  /** 目前正在說話的 identity 清單（驅動頭上標記投影）。 */
  speakingIdentities?: string[];
  /**
   * 每幀（節流）回呼說話中 avatar 的頭部 UV 座標（0..1，左上為原點）。
   * 無人說話時回呼空物件一次以清除標記。
   */
  onSpeakerAnchors?: (anchors: Record<string, { x: number; y: number }>) => void;
```

- [ ] **Step 2: 解構新 option 並建立 refs**

把 `frontend/src/hooks/useBigScreenScene.ts:151` 的解構行末尾補上兩個新欄位：

```ts
  const { sceneId = DEFAULT_SCENE_ID, vrmSourceId = DEFAULT_VRM_SOURCE_ID, slotAssignments, currentTaskId, onStats, onScenePropsReady, renderFpsLimit, isRecording, onPostRenderRef, groupTransforms, speakingIdentities, onSpeakerAnchors } = options;
```

接著在 `import * as THREE from 'three';` 之下、hook 外層 module scope（約第 18 行附近，與其他 module 常數一起）新增可重用向量：

```ts
/** Reusable vectors for per-frame head projection — avoids allocation. */
const _headWorld = new THREE.Vector3();
const _headUV = { x: 0, y: 0 };
```

然後在 hook body 內（與其他 `useRef` 一起，約 222 行 `avgPoseIntervalsRef` 之後）新增 refs：

```ts
  const speakingIdentitiesRef = useRef<string[]>([]);
  speakingIdentitiesRef.current = speakingIdentities ?? [];
  const onSpeakerAnchorsRef = useRef<UseBigScreenSceneOptions['onSpeakerAnchors']>(undefined);
  onSpeakerAnchorsRef.current = onSpeakerAnchors;
  /** 上次回呼頭部座標的時間（節流） */
  const lastAnchorAtRef = useRef(0);
  /** 上次是否回報過非空 anchors（用來只在「轉為空」時清一次） */
  const hadAnchorsRef = useRef(false);
```

- [ ] **Step 3: 在 RAF 迴圈末段加入頭部投影（節流）**

在 `frontend/src/hooks/useBigScreenScene.ts` RAF `animate` 內，`renderer.render(scene, cameraRef.current)`（約 619-621 行）之後、`onPostRenderRef?.current?.(timestamp)`（632 行）之前插入：

```ts
      // ── 說話中 avatar 頭上標記投影（節流 ~100ms）───────────────────────
      {
        const cb = onSpeakerAnchorsRef.current;
        const cam = cameraRef.current;
        if (cb && cam && timestamp - lastAnchorAtRef.current >= 100) {
          lastAnchorAtRef.current = timestamp;
          const speaking = speakingIdentitiesRef.current;
          if (speaking.length === 0) {
            if (hadAnchorsRef.current) {
              hadAnchorsRef.current = false;
              cb({});
            }
          } else {
            const anchors: Record<string, { x: number; y: number }> = {};
            for (const id of speaking) {
              const slot = avatarsRef.current.get(id);
              if (!slot) continue;
              const head = slot.vrm.humanoid?.getNormalizedBoneNode('head');
              if (!head) continue;
              head.getWorldPosition(_headWorld);
              _headWorld.y += 0.22; // 抬到頭頂上方
              projectToUV(_headWorld, cam, _headUV);
              anchors[id] = { x: _headUV.x, y: _headUV.y };
            }
            hadAnchorsRef.current = Object.keys(anchors).length > 0;
            cb(anchors);
          }
        }
      }
```

- [ ] **Step 4: 匯入 `projectToUV`**

確認 `frontend/src/hooks/useBigScreenScene.ts` 頂部既有的 `propInteraction` import（約 41-46 行）已包含 `projectToUV`。目前該 import 已包含 `projectToUV`（用於 prop 抓取），無需改動。若沒有，補進該 import block：

```ts
import {
  highlightProp,
  projectToUV,
  attachPropToHand,
  returnPropToDisplay,
} from '../utils/propInteraction';
```

- [ ] **Step 5: 型別檢查**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useBigScreenScene.ts
git commit -m "feat: useBigScreenScene 投影說話中 avatar 頭部座標"
```

---

## Task 5: 大屏渲染常駐機器人環狀波動 + 頭上標記

**Files:**
- Modify: `frontend/src/components/BigScreen.tsx`（hook 呼叫 481-492；message-handler 之後加 speakerAnchors state；render 區 1712-1758、AI bar 1865-1884）
- Modify: `frontend/src/App.css`（檔尾新增樣式）

- [ ] **Step 1: 新增 `speakerAnchors` state**

在 `frontend/src/components/BigScreen.tsx` 的 `speakingIdentitiesRef` 宣告（Task 3 Step 1 新增處）之後新增：

```tsx
  // 說話中 avatar 頭部 UV 座標（由 useBigScreenScene 回呼）
  const [speakerAnchors, setSpeakerAnchors] = useState<Record<string, { x: number; y: number }>>({});
```

- [ ] **Step 2: 把 `speakingIdentities` 與 `onSpeakerAnchors` 傳給 hook**

把 `frontend/src/components/BigScreen.tsx:481-492` 的 `useBigScreenScene` options 物件加入兩個欄位（在 `groupTransforms,` 之後）：

```tsx
    groupTransforms,
    speakingIdentities: useMemo(() => Array.from(speakingIdentities), [speakingIdentities]),
    onSpeakerAnchors: setSpeakerAnchors,
  });
```

> 注意：`speakingIdentities`（Set）需轉成陣列傳入。上面用 `useMemo` 包住避免每次 render 產生新陣列造成 hook 內 ref 抖動（ref 寫入無妨，但保持穩定較佳）。

- [ ] **Step 3: 重構 AI 提示氣泡為「常駐機器人 + 環狀波動 + 氣泡」**

把 `frontend/src/components/BigScreen.tsx:1865-1884`（`{/* AI 助理提示 (機器人說話框呈現) */}` 整段 `{aiHint && aiHint.content && ( ... )}`）替換為：

```tsx
            {/* 常駐中央機器人 + 環狀波動（有人說話時啟動，依老師/學生著色） */}
            <div
              className={`bs-robot-zone${teacherSpeaking ? ' is-teacher-speaking' : ''}${studentSpeaking ? ' is-student-speaking' : ''}`}
            >
              <div className="bs-robot-rings" aria-hidden="true">
                <span className="bs-robot-ring" />
                <span className="bs-robot-ring" />
                <span className="bs-robot-ring" />
              </div>
              <img src="/images/UI/robot_avatar.png" alt="🤖" className="bs-robot-avatar" />
              {aiHint && aiHint.content && (
                <div className={`bs-ai-bubble-wrap ai-mode--${aiHint.mode}`}>
                  <span className={`bs-ai-bar-mode-tag ai-mode--${aiHint.mode}`}>
                    {aiHint.mode === 'complete' ? '完整' : aiHint.mode === 'rearrange' ? '重組' : '延伸'}
                  </span>
                  <div className="bs-ai-bubble">
                    <span className="bs-ai-bar-content">
                      {aiHint.mode === 'rearrange'
                        ? aiHint.content.split(' ').map((w, i) => (
                          <span key={i} className="ai-chip">{w}</span>
                        ))
                        : aiHint.content}
                    </span>
                  </div>
                </div>
              )}
            </div>
```

- [ ] **Step 4: 新增頭上標記 overlay（在 `bigscreen-overlay` 之後）**

在 `frontend/src/components/BigScreen.tsx` 的 `{/* 3. Overlay UI Layer */}` 區塊（`1754-1758`）之後新增說話標記層：

```tsx
      {/* 3b. 各角色 VRM 頭上說話標記 */}
      <div className="bs-speaker-anchors" aria-hidden={Object.keys(speakerAnchors).length === 0}>
        {Object.entries(speakerAnchors).map(([id, p]) => (
          <div
            key={id}
            className={`bs-speaker-badge${id.startsWith('host-') ? ' is-teacher' : ' is-student'}`}
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
          >
            <span className="bs-speaker-badge-dot" />
            <span className="bs-speaker-badge-wave" />
          </div>
        ))}
      </div>
```

- [ ] **Step 5: 新增 CSS（App.css 檔尾）**

在 `frontend/src/App.css` 最末端附加：

```css
/* ── 大屏常駐機器人 + 環狀波動 ───────────────────────────────── */
.bs-robot-zone {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 14px;
}
.bs-robot-avatar {
  width: 96px;
  height: 96px;
  object-fit: contain;
  position: relative;
  z-index: 2;
  filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.35));
}
.bs-robot-rings {
  position: absolute;
  left: 48px;     /* 機器人水平中心 */
  bottom: 48px;   /* 機器人垂直中心 */
  width: 0;
  height: 0;
  z-index: 1;
  pointer-events: none;
}
.bs-robot-ring {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 96px;
  height: 96px;
  margin-left: -48px;
  margin-top: -48px;
  border-radius: 50%;
  border: 3px solid rgba(0, 169, 157, 0.0);
  transform: scale(0.6);
  opacity: 0;
}
/* 只有在說話時才播放波動 */
.bs-robot-zone.is-teacher-speaking .bs-robot-ring,
.bs-robot-zone.is-student-speaking .bs-robot-ring {
  animation: bs-ring-pulse 1.8s ease-out infinite;
}
.bs-robot-zone.is-teacher-speaking .bs-robot-ring { border-color: rgba(0, 169, 157, 0.7); }
.bs-robot-zone.is-student-speaking .bs-robot-ring { border-color: rgba(247, 110, 18, 0.7); }
.bs-robot-ring:nth-child(2) { animation-delay: 0.6s; }
.bs-robot-ring:nth-child(3) { animation-delay: 1.2s; }
@keyframes bs-ring-pulse {
  0%   { transform: scale(0.6); opacity: 0.8; }
  100% { transform: scale(2.2); opacity: 0; }
}

/* 機器人說話氣泡（取代舊 bs-ai-bar 內的 avatar 結構） */
.bs-ai-bubble-wrap {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  z-index: 2;
  max-width: 46vw;
}

/* ── 各角色 VRM 頭上說話標記 ───────────────────────────────── */
.bs-speaker-anchors {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 6;
}
.bs-speaker-badge {
  position: absolute;
  transform: translate(-50%, -120%);
  width: 26px;
  height: 26px;
}
.bs-speaker-badge-dot,
.bs-speaker-badge-wave {
  position: absolute;
  left: 50%;
  top: 50%;
  border-radius: 50%;
  transform: translate(-50%, -50%);
}
.bs-speaker-badge-dot { width: 12px; height: 12px; }
.bs-speaker-badge-wave { width: 12px; height: 12px; }
.bs-speaker-badge.is-teacher .bs-speaker-badge-dot { background: #00a99d; }
.bs-speaker-badge.is-student .bs-speaker-badge-dot { background: #f76e12; }
.bs-speaker-badge.is-teacher .bs-speaker-badge-wave { border: 2px solid rgba(0, 169, 157, 0.6); }
.bs-speaker-badge.is-student .bs-speaker-badge-wave { border: 2px solid rgba(247, 110, 18, 0.6); }
.bs-speaker-badge-wave { animation: bs-badge-wave 1.2s ease-out infinite; }
@keyframes bs-badge-wave {
  0%   { width: 12px; height: 12px; opacity: 0.8; }
  100% { width: 40px; height: 40px; opacity: 0; }
}
```

> 若 App.css 仍有殘留的舊 `.bs-ai-bar`、`.bs-ai-bar-avatar`、`.bs-ai-bar-avatar-container` 規則，保留即可（已無 DOM 使用，不影響畫面）；本次不刪以縮小 diff。

- [ ] **Step 6: 型別檢查 + Lint**

Run: `cd frontend && npx tsc -b --noEmit && npm run lint`
Expected: PASS（Task 3 的 `teacherSpeaking`/`studentSpeaking` 現已使用，不再有未使用警告；若 Task 3 加過暫時引用，於此移除 `void ...` 兩行）

- [ ] **Step 7: 手動驗證**

啟動 `cd frontend && npm run dev`，開教師控制台與大屏（`/?screen=bigscreen`）兩視窗，指派至少一個 slot：
- 老師對麥克風說話 → 大屏中央機器人出現 **teal** 環狀波動，老師 VRM 頭上出現 teal 標記。
- 學生說話 → 機器人波動轉 **橘**，學生 VRM 頭上出現橘色標記。
- 無人說話 → 波動與標記消失。
Expected: 行為如上；頭上標記大致對齊頭頂（容許微小偏移）。

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/BigScreen.tsx frontend/src/App.css
git commit -m "feat: 大屏常駐機器人環狀波動與角色頭上說話標記"
```

---

## Task 6: 教師控制台「開始互動」固定 15 秒自動腳本

**Files:**
- Modify: `frontend/src/components/HostSession.tsx`（AI state 區 267-281；空白鍵 refs 608-615；transcript effect 681-712；AI panel render 1976 附近）
- Modify: `frontend/src/App.css`（檔尾新增按鈕/相位樣式）

- [ ] **Step 1: 新增相位狀態與腳本 refs**

在 `frontend/src/components/HostSession.tsx` 的 `const [recordDuration, setRecordDuration] = useState(0);`（274 行）之後新增：

```tsx
  // ── 開始互動自動腳本（固定 15 秒）─────────────────────────────
  type InteractionPhase = 'idle' | 'recording' | 'generating' | 'student';
  const [interactionPhase, setInteractionPhase] = useState<InteractionPhase>('idle');
  const interactionPhaseRef = useRef<InteractionPhase>('idle');
  useEffect(() => { interactionPhaseRef.current = interactionPhase; }, [interactionPhase]);
  // 標記「此次 stop 由開始互動腳本觸發」→ transcript effect 立即送出（不倒數）
  const autoScriptTriggerRef = useRef(false);
  const scriptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scriptTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [scriptCountdown, setScriptCountdown] = useState<number | null>(null);
```

常數 15 秒：在檔案上方既有常數區或本元件內合適處宣告（放在元件 body 開頭即可）：

```tsx
  const SCRIPT_RECORD_SECONDS = 15;
```

- [ ] **Step 2: 新增 `startInteractionScript` 與 `cancelInteractionScript` callbacks**

在 `frontend/src/components/HostSession.tsx` 的 `handleToggleRecord`（624-633 行）之後新增：

```tsx
  const cancelInteractionScript = useCallback(() => {
    if (scriptTimerRef.current) { clearTimeout(scriptTimerRef.current); scriptTimerRef.current = null; }
    if (scriptTickRef.current) { clearInterval(scriptTickRef.current); scriptTickRef.current = null; }
    autoScriptTriggerRef.current = false;
    setScriptCountdown(null);
    setInteractionPhase('idle');
  }, []);

  const startInteractionScript = useCallback(() => {
    // 守門：場景需有 AI 約束、STT 支援、且非錄音/非忙碌/非進行中
    if (!sttSupported || !SCENE_CONSTRAINTS[selectedSceneId]) return;
    if (sttRecording || aiBusy || interactionPhaseRef.current !== 'idle') return;

    cancelAutoCountdown();
    clearTranscript();
    setAiError(null);
    setInteractionPhase('recording');
    startRec();

    setScriptCountdown(SCRIPT_RECORD_SECONDS);
    scriptTickRef.current = setInterval(() => {
      setScriptCountdown((c) => (c !== null && c > 1 ? c - 1 : c));
    }, 1000);
    scriptTimerRef.current = setTimeout(() => {
      if (scriptTickRef.current) { clearInterval(scriptTickRef.current); scriptTickRef.current = null; }
      scriptTimerRef.current = null;
      setScriptCountdown(null);
      // 標記由腳本觸發停止 → transcript effect 立即送 AI
      autoScriptTriggerRef.current = true;
      setInteractionPhase('generating');
      stopRec();
    }, SCRIPT_RECORD_SECONDS * 1000);
  }, [sttSupported, selectedSceneId, sttRecording, aiBusy, cancelAutoCountdown, clearTranscript, startRec, stopRec]);
```

- [ ] **Step 3: transcript effect 整合腳本旗標**

在 `frontend/src/components/HostSession.tsx` 的 transcript effect（682 行起）開頭，既有：

```tsx
    const isSpacebarTrigger = spacebarTriggerRef.current;
    spacebarTriggerRef.current = false;
```

之下新增腳本旗標消耗，並把「立即送出」條件擴充為兩者皆可：

```tsx
    const isAutoScript = autoScriptTriggerRef.current;
    autoScriptTriggerRef.current = false;
```

接著把既有：

```tsx
    if (isSpacebarTrigger) {
      // 空白鍵放開：跳過倒數，直接呼叫 AI 並推播提示給學生
      handleHintRef.current('rearrange');
      return;
    }
```

改為：

```tsx
    if (isSpacebarTrigger || isAutoScript) {
      // 空白鍵放開 / 開始互動腳本：跳過倒數，直接呼叫 AI 並推播提示
      handleHintRef.current('rearrange');
      if (isAutoScript) setInteractionPhase('student');
      return;
    }
```

> 說明：`handleHint` 為 async，呼叫後 `aiBusy` 會在內部處理；此處在送出當下即切到 `'student'` 相位作為「輪到學生」提示。AI 失敗時相位仍會停在 student，下次點「開始互動」會經 `cancelInteractionScript`/守門重置（見 Step 5 按鈕 onClick）。

- [ ] **Step 4: 場景切換時清理腳本**

在 `frontend/src/components/HostSession.tsx` 的 `handleSceneChange`（779 行起）內，既有 `cancelAutoCountdown();`（793 行）之後新增一行：

```tsx
      cancelInteractionScript();
```

並把 `cancelInteractionScript` 加入 `handleSceneChange` 的 useCallback 依賴陣列（843 行附近的依賴清單末端）：

```tsx
    [broadcastSceneChange, broadcastTeacherVrmChange, broadcastVrmChange, cancelAutoCountdown, sttRecording, stopRec, clearTranscript, broadcastAIHint, cancelInteractionScript],
```

- [ ] **Step 5: 在 AI panel 加「開始互動」按鈕與相位提示**

在 `frontend/src/components/HostSession.tsx` 的 AI panel 內、`{/* ── 音錄 ── */}` section 之前（1976 行 `<div className="hs-ai-section">` 之前）插入：

```tsx
                      {/* ── 開始互動（自動腳本）──────────────────────── */}
                      <div className="hs-ai-section">
                        <button
                          className={`hs-ai-start-btn phase-${interactionPhase}`}
                          disabled={!sttSupported || !hasConstraint || sttRecording || aiBusy || interactionPhase !== 'idle'}
                          onClick={startInteractionScript}
                        >
                          <span className="material-symbols-outlined">smart_toy</span>
                          {interactionPhase === 'recording'
                            ? `老師說話中… ${scriptCountdown ?? ''}s`
                            : interactionPhase === 'generating'
                              ? 'AI 生成中…'
                              : interactionPhase === 'student'
                                ? '輪到學生回答'
                                : '開始互動'}
                        </button>
                        {interactionPhase !== 'idle' && (
                          <button className="hs-ai-start-cancel" onClick={cancelInteractionScript}>
                            取消互動
                          </button>
                        )}
                      </div>
```

- [ ] **Step 6: unmount 清理**

在 `frontend/src/components/HostSession.tsx` 既有 `useEffect(() => () => cancelAutoCountdown(), [cancelAutoCountdown]);`（715 行）之後新增：

```tsx
  useEffect(() => () => cancelInteractionScript(), [cancelInteractionScript]);
```

- [ ] **Step 7: 新增 CSS（App.css 檔尾）**

在 `frontend/src/App.css` 末端附加：

```css
/* ── 開始互動按鈕 ──────────────────────────────────────────── */
.hs-ai-start-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 16px;
  font-size: 15px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #00a99d, #00897b);
  border: none;
  border-radius: 10px;
  cursor: pointer;
  transition: filter 0.15s, transform 0.1s;
}
.hs-ai-start-btn:hover:not(:disabled) { filter: brightness(1.06); }
.hs-ai-start-btn:active:not(:disabled) { transform: translateY(1px); }
.hs-ai-start-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.hs-ai-start-btn.phase-recording { background: linear-gradient(135deg, #f76e12, #e25a00); }
.hs-ai-start-btn.phase-generating { background: linear-gradient(135deg, #6b7280, #4b5563); }
.hs-ai-start-btn.phase-student { background: linear-gradient(135deg, #2563eb, #1d4ed8); }
.hs-ai-start-cancel {
  width: 100%;
  margin-top: 6px;
  padding: 6px 12px;
  font-size: 13px;
  color: #b91c1c;
  background: transparent;
  border: 1px solid rgba(185, 28, 28, 0.4);
  border-radius: 8px;
  cursor: pointer;
}
```

- [ ] **Step 8: 型別檢查 + Lint**

Run: `cd frontend && npx tsc -b --noEmit && npm run lint`
Expected: PASS

- [ ] **Step 9: 手動驗證**

`npm run dev`，教師控制台選用有 AI 約束的場景（clothingStore_cashier）：
- 點「開始互動」→ 按鈕轉橘並倒數 15s，期間錄老師說話 → 倒數結束顯示「AI 生成中…」→ 完成後顯示「輪到學生回答」，大屏出現重組提示氣泡。
- 期間「取消互動」可中止並回「開始互動」。
- 既有空白鍵長按、手動按鈕、3 秒倒數仍正常。
- 切換場景時互動腳本被正確清理（按鈕回 idle）。
Expected: 行為如上。

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/HostSession.tsx frontend/src/App.css
git commit -m "feat: 教師控制台開始互動 15 秒自動腳本"
```

---

## Task 7: 規則引擎接口（transcriptGate，預設 passthrough）

**Files:**
- Create: `frontend/src/config/transcriptGate.ts`
- Modify: `frontend/src/components/HostSession.tsx`（`handleHint` 579-603）

- [ ] **Step 1: 建立 `transcriptGate.ts`**

建立 `frontend/src/config/transcriptGate.ts`：

```ts
/**
 * Transcript → AI 送出前的過濾接口（規則引擎預留點）。
 *
 * 目前預設 passThroughGate 永遠通過，行為與既有一致。
 * 未來「背景持續 STT + 規則引擎過濾」可實作此介面，在 accept() 內以規則
 * （最短長度、填詞、教學語句偵測、停頓碎句等）回傳 false 來攔截，
 * 無需改動 handleHint 的送出管線。
 */
export interface TranscriptGateCtx {
  /** 目前場景 ID */
  sceneId: string;
  /** 觸發來源 */
  source: 'spacebar' | 'button' | 'auto-script';
}

export interface TranscriptGate {
  /** 回傳 true 才會把 transcript 送去 AI */
  accept(text: string, ctx: TranscriptGateCtx): boolean;
}

/** 預設閘門：永遠通過（不改變現有行為）。 */
export const passThroughGate: TranscriptGate = {
  accept: () => true,
};
```

- [ ] **Step 2: 在 HostSession 匯入並於 `handleHint` 串接**

在 `frontend/src/components/HostSession.tsx` 既有 aiAssistant import（23-24 行）之後新增：

```tsx
import { passThroughGate } from '../config/transcriptGate.ts';
import type { TranscriptGate } from '../config/transcriptGate.ts';
```

在元件 body 內（AI state 區附近，如 269 行 `latestHint` 之後）新增目前使用的 gate ref（之後替換實作只改這一行）：

```tsx
  const transcriptGateRef = useRef<TranscriptGate>(passThroughGate);
```

在 `handleHint`（579 行）內，既有：

```tsx
    const txt = sttTranscript.trim();
    if (txt.length < 3) return;
    const constraint = SCENE_CONSTRAINTS[selectedSceneId];
    if (!constraint) { setAiError('此場景尚無 AI 助理約束文件'); return; }
```

在 `if (txt.length < 3) return;` 之後插入 gate 檢查：

```tsx
    if (!transcriptGateRef.current.accept(txt, { sceneId: selectedSceneId, source: 'button' })) return;
```

> 說明：`source` 暫以 `'button'` 表示；本次未細分來源（passthrough 不使用該值）。未來要分流再依 `interactionPhaseRef`/`spacebarTriggerRef` 帶入正確來源。

- [ ] **Step 3: 型別檢查 + Lint**

Run: `cd frontend && npx tsc -b --noEmit && npm run lint`
Expected: PASS

- [ ] **Step 4: 手動驗證（行為不變）**

`npm run dev`，確認空白鍵、按鈕、開始互動三條路徑仍能正常送出並廣播提示（passthrough 不攔截）。
Expected: 與 Task 6 結束時一致。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/config/transcriptGate.ts frontend/src/components/HostSession.tsx
git commit -m "feat: 新增 transcriptGate 規則引擎接口（預設 passthrough）"
```

---

## Task 8: 整合驗證

**Files:** 無（驗證用）

- [ ] **Step 1: 完整建置**

Run: `cd frontend && npm run build`
Expected: `tsc -b` 與 `vite build` 皆成功，無型別錯誤。

- [ ] **Step 2: Lint**

Run: `cd frontend && npm run lint`
Expected: 無新增 error。

- [ ] **Step 3: 端到端手動驗證**

開教師控制台 + 大屏兩視窗，逐項確認：
1. 「開始互動」→ 15s 倒數 → 自動送 AI → 大屏提示氣泡出現（重組 chips）。
2. 老師說話：大屏機器人 teal 環狀波動 + 老師 VRM 頭上 teal 標記。
3. 學生說話：機器人橘色波動 + 學生 VRM 頭上橘色標記。
4. 無人說話：波動 / 標記消失。
5. 既有功能無回歸：空白鍵長按送出、手動三模式按鈕、3 秒自動倒數、清除學生畫面、場景切換清理。
Expected: 全部通過。

- [ ] **Step 4: 最終 commit（若有零散調整）**

```bash
git add -A
git commit -m "chore: AI 互動腳本與大屏說話 UI 整合驗證"
```

---

## Self-Review 對照（規格 → 任務）

- 開始互動固定 15s 腳本 → Task 6 ✅
- 大屏常駐中央機器人 + 環狀波動（老師/學生著色）→ Task 5 ✅
- 各角色 VRM 頭上標記（投影）→ Task 4（投影）+ Task 5（渲染）✅
- 說話狀態管線（speakingSet → 廣播 → 大屏）→ Task 1/2/3 ✅
- 規則引擎接口（僅預留）→ Task 7 ✅
- 保留既有功能 → Task 6 Step 9 / Task 8 Step 3 驗證 ✅

型別一致性：`'speaking'` 訊息與 `speakingIdentities` 欄位（Task 1）於 Task 2 廣播、Task 3 接收一致；`onSpeakerAnchors` 回呼簽章（Task 4）與 Task 5 `setSpeakerAnchors` 型別 `Record<string,{x:number;y:number}>` 一致；`autoScriptTriggerRef`（Task 6 Step 1）於 Step 3 消耗一致；`TranscriptGate`/`passThroughGate`（Task 7）命名一致。
