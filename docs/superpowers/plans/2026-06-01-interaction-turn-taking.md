# 互動腳本改為開放式輪流對話 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「開始互動」從固定計時改為開放式輪流對話 — 老師按下即開始錄、按「換學生」結束本輪、按「結束錄製」整段結束；學生收到提示與「說完了」按鈕，按下即把控制權交回老師。

**Architecture:** 相位機 `idle → teacher → generating → student`（無計時器），由按鈕事件與 LiveKit `publishData` 控制台 ↔ 學生雙向訊息共同推進。「換學生」沿用既有 `autoScriptTriggerRef` 立即送 AI 的 transcript effect 路徑（不重寫送出邏輯）。Phase 變化用既有雙路廣播（BroadcastChannel 給 BigScreen + LiveKit publishData 給學生）。

**Tech Stack:** React 19 + TypeScript + LiveKit Client + Web Speech API + Vite。專案無自動化測試 framework — 每個 task 結尾以 `npx tsc -b --noEmit` + `npm run lint` + 手動瀏覽器驗證取代自動化測試。所有指令在 `frontend/` 目錄執行。

設計文件：`docs/superpowers/specs/2026-06-01-interaction-turn-taking-design.md`

---

## File Structure

**Modify (2):**
- `frontend/src/components/HostSession.tsx` — 相位機改名 / 移除計時器 / 新增 `handleTeacherDone` + `handleTeacherTakeover` + `endInteraction` / UI 按鈕重整 / phase publishData / DataReceived 加 student-done 分支
- `frontend/src/components/StudentSession.tsx` — 新增 `interactionPhase` state / DataReceived 加 `'interaction-phase'` 分支 / 新增「輪到你說話」置中卡 + 「說完了」按鈕 / publishData student-done

無新檔。CSS 沿用既有 `.hs-ai-start-btn` / `.hs-ai-start-cancel` 與 hint card 樣式（如需新樣式，加到 `frontend/src/App.css` 檔尾）。

**Total**: 0 new files, 2 modified files (+1 optional CSS append).

---

## Task 1: HostSession 相位重整與計時器移除

把 phase 的 `'recording'` 改名為 `'teacher'`（精確反映新意義：「老師回合，持續錄音」）。移除所有計時器相關 state / refs / 倒數 UI / 8 秒 student→idle 自動 reset。`startInteractionScript` 重命名為 `startInteraction`，只保留 idle→teacher 轉移。`cancelInteractionScript` 重命名為 `endInteraction`，仍負責 「任何 phase → idle」的清理。

**Files:**
- Modify: `frontend/src/components/HostSession.tsx`

- [ ] **Step 1: 改名相位型別**

把 `frontend/src/components/HostSession.tsx:38` 從：
```ts
type InteractionPhase = 'idle' | 'recording' | 'generating' | 'student';
```
改為：
```ts
type InteractionPhase = 'idle' | 'teacher' | 'generating' | 'student';
```

- [ ] **Step 2: 移除計時器相關常數 / state / refs**

刪除 `frontend/src/components/HostSession.tsx:37`：
```ts
const SCRIPT_RECORD_SECONDS = 10;
```

刪除元件內三行（約 303-305）：
```tsx
  const scriptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scriptTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [scriptCountdown, setScriptCountdown] = useState<number | null>(null);
```

> `autoScriptTriggerRef`（約第 302 行）**保留**，仍由 `handleTeacherDone` 設為 true 觸發 transcript effect 的立即送出路徑。

- [ ] **Step 3: 移除 8 秒 student→idle 自動 reset useEffect**

找到並刪除整段：
```tsx
  useEffect(() => {
    if (interactionPhase !== 'student') return;
    const t = setTimeout(() => setInteractionPhase('idle'), 8000);
    return () => clearTimeout(t);
  }, [interactionPhase]);
```

- [ ] **Step 4: 重寫 `startInteractionScript` 為 `startInteraction`（去除計時器邏輯，把 'recording' 改 'teacher'）**

把整個 `startInteractionScript` 替換為：

```tsx
  const startInteraction = useCallback(() => {
    if (!sttSupported || !SCENE_CONSTRAINTS[selectedSceneId]) return;
    if (sttRecording || aiBusy || interactionPhaseRef.current !== 'idle') return;

    cancelAutoCountdown();
    resetChatHistory();
    resetCachedReplies();
    clearTranscript();
    setAiError(null);
    setInteractionPhase('teacher');
    startRec();
  }, [sttSupported, selectedSceneId, sttRecording, aiBusy, cancelAutoCountdown, resetChatHistory, resetCachedReplies, clearTranscript, startRec]);
```

- [ ] **Step 5: 重寫 `cancelInteractionScript` 為 `endInteraction`**

把整個 `cancelInteractionScript` 替換為：

```tsx
  const endInteraction = useCallback(() => {
    autoScriptTriggerRef.current = false;
    if (sttRecording) {
      try { stopRec(); } catch { /* ignore */ }
    }
    setInteractionPhase('idle');
  }, [sttRecording, stopRec]);
```

- [ ] **Step 6: 更新「unmount 清理」useEffect 名稱引用**

找到（約 828 行）：
```tsx
  useEffect(() => () => cancelInteractionScript(), [cancelInteractionScript]);
```
改為：
```tsx
  useEffect(() => () => endInteraction(), [endInteraction]);
```

- [ ] **Step 7: 更新 `handleSceneChange` 內的呼叫**

於 `handleSceneChange` 內找到既有的 `cancelInteractionScript();`（約 914 行），改為 `endInteraction();`。同樣把該 useCallback 的依賴陣列中 `cancelInteractionScript` 改成 `endInteraction`（約 966 行那個依賴陣列）。

- [ ] **Step 8: 更新 AI panel 內按鈕區 UI**

找到既有「開始互動」按鈕區塊（約 2110-2128 行，含 `className={\`hs-ai-start-btn phase-${interactionPhase}\`}` 那段）。**整段**替換為：

```tsx
                      {/* ── 開始互動（開放式輪流）─────────────────────── */}
                      <div className="hs-ai-section">
                        {interactionPhase === 'idle' && (
                          <button
                            className={`hs-ai-start-btn phase-${interactionPhase}`}
                            disabled={!sttSupported || !hasConstraint || sttRecording || aiBusy}
                            onClick={startInteraction}
                          >
                            <span className="material-symbols-outlined">smart_toy</span>
                            開始互動
                          </button>
                        )}
                        {interactionPhase === 'teacher' && (
                          <button
                            className={`hs-ai-start-btn phase-${interactionPhase}`}
                            onClick={handleTeacherDone}
                          >
                            <span className="material-symbols-outlined">swap_horiz</span>
                            換學生
                          </button>
                        )}
                        {interactionPhase === 'generating' && (
                          <button className={`hs-ai-start-btn phase-${interactionPhase}`} disabled>
                            AI 生成中…
                          </button>
                        )}
                        {interactionPhase === 'student' && (
                          <button
                            className={`hs-ai-start-btn phase-${interactionPhase}`}
                            onClick={handleTeacherTakeover}
                          >
                            <span className="material-symbols-outlined">undo</span>
                            輪到自己
                          </button>
                        )}
                        {interactionPhase !== 'idle' && (
                          <button className="hs-ai-start-cancel" onClick={endInteraction}>
                            結束錄製
                          </button>
                        )}
                      </div>
```

> Task 2 會新增 `handleTeacherDone` 與 `handleTeacherTakeover`。本步驟先放入名稱，預期下一步 type-check 會報「unresolved name」— 在執行 Task 2 之前**不**單獨型別檢查 / commit Task 1。

- [ ] **Step 9: Commit 暫緩**

> 因為按鈕 UI 引用了 Task 2 才會新增的 callbacks，本任務的 commit 與 Task 2 合併進行（見 Task 2 結尾）。如果你需要中途 commit，先暫時把 `onClick={handleTeacherDone}` / `onClick={handleTeacherTakeover}` 替成 `onClick={() => {}}` placeholder，跑 tsc 過後 commit，再於 Task 2 還原。

---

## Task 2: 新增 `handleTeacherDone` 與 `handleTeacherTakeover`

兩個 callback：「換學生」標記 auto-script flag + 切 generating + 停 rec（既有 transcript effect 處理後續），「輪到自己」搶回 teacher 相位 + 清 transcript + 重啟錄音。

**Files:**
- Modify: `frontend/src/components/HostSession.tsx`

- [ ] **Step 1: 加入 `handleTeacherDone`**

在 `endInteraction`（Task 1 Step 5 新建的）之後，加：

```tsx
  const handleTeacherDone = useCallback(() => {
    if (interactionPhaseRef.current !== 'teacher') return;
    autoScriptTriggerRef.current = true;
    setInteractionPhase('generating');
    if (sttRecording) {
      try { stopRec(); } catch { /* ignore */ }
    }
  }, [sttRecording, stopRec]);
```

- [ ] **Step 2: 加入 `handleTeacherTakeover`**

在 `handleTeacherDone` 之後，加：

```tsx
  const handleTeacherTakeover = useCallback(() => {
    if (interactionPhaseRef.current !== 'student') return;
    cancelAutoCountdown();
    clearTranscript();
    setAiError(null);
    setInteractionPhase('teacher');
    if (!sttRecording) {
      try { startRec(); } catch { /* ignore */ }
    }
  }, [cancelAutoCountdown, clearTranscript, sttRecording, startRec]);
```

- [ ] **Step 3: 型別檢查 + Lint**

Run: `cd frontend && npx tsc -b --noEmit && npm run lint`
Expected: PASS。`startInteraction` / `endInteraction` / `handleTeacherDone` / `handleTeacherTakeover` 都已宣告並使用；`scriptTimerRef` / `scriptTickRef` / `scriptCountdown` / `SCRIPT_RECORD_SECONDS` 已刪除；`InteractionPhase` 改名後 BigScreen 仍以 string 形式讀取（contract 寬鬆，無破壞）。

- [ ] **Step 4: 合併 Task 1+2 提交**

```bash
git add frontend/src/components/HostSession.tsx
git commit -m "feat: 互動相位改為開放式輪流（換學生/輪到自己/結束錄製）"
```

---

## Task 3: HostSession 雙路廣播 phase + 接收 student-done

**Files:**
- Modify: `frontend/src/components/HostSession.tsx`

- [ ] **Step 1: phase 變化時同時 LiveKit publishData**

找到（約 296-300 行）：
```tsx
  useEffect(() => {
    const msg: BigScreenMsg = { type: 'interaction-phase', interactionPhase };
    channelRef.current?.postMessage(msg);
  }, [interactionPhase]);
```
**整段**替換為：
```tsx
  useEffect(() => {
    const msg: BigScreenMsg = { type: 'interaction-phase', interactionPhase };
    channelRef.current?.postMessage(msg);
    const room = roomRef.current;
    if (room && room.state === 'connected') {
      try {
        const bytes = new TextEncoder().encode(
          JSON.stringify({ type: 'interaction-phase', phase: interactionPhase }),
        );
        room.localParticipant.publishData(bytes, { reliable: true });
      } catch { /* ignore */ }
    }
  }, [interactionPhase]);
```

- [ ] **Step 2: 在 `handleDataReceived` 內加入控制訊息分支**

找到 `handleDataReceived`（約 1308-1341 行）。函式開頭目前是：
```tsx
    const handleDataReceived = (
      payload: Uint8Array,
      participant?: RemoteParticipant,
    ) => {
      if (!participant) return;
      try {
        let pool = studentPoolsRef.current.get(participant.identity);
        ...
      }
```
在 `if (!participant) return;` **之後**、`try { let pool = ...` **之前**，插入：
```tsx
      // 先嘗試把 payload 當控制訊息（JSON）解析；解析失敗（如 binary pose 資料）則沉默落到 pose 解碼。
      try {
        const text = new TextDecoder().decode(payload);
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
          if (parsed.type === 'student-done') {
            if (interactionPhaseRef.current === 'student') {
              cancelAutoCountdown();
              clearTranscript();
              setAiError(null);
              setInteractionPhase('teacher');
              if (!sttRecordingRef.current) {
                try { startRec(); } catch { /* ignore */ }
              }
            }
            return;
          }
          // 其他可能的控制訊息可在此擴充
        }
      } catch { /* fall through to pose decode */ }
```

> 注意 `cancelAutoCountdown` / `clearTranscript` / `setAiError` / `setInteractionPhase` / `startRec` / `sttRecordingRef` / `interactionPhaseRef` 都是元件 body scope 內的識別字，會被閉包擷取。`handleDataReceived` 在既有 `useEffect`（LiveKit room 建立 useEffect）內宣告，目前該 effect 依賴陣列可能不含這些 — **不要**改動該依賴陣列以避免 reconnect 風暴。閉包讀到的 setter 是穩定的（React 保證），refs 也是穩定的；`cancelAutoCountdown` / `clearTranscript` / `setAiError` / `startRec` 視為穩定（既有使用上都未列入該 effect 依賴）。

- [ ] **Step 3: 型別檢查 + Lint**

Run: `cd frontend && npx tsc -b --noEmit && npm run lint`
Expected: PASS。`react-hooks/exhaustive-deps` 可能對該 LiveKit useEffect 出現警告 — 若是先前就有的警告（檢查 lint baseline），維持即可；若是本次新增的警告，加 `// eslint-disable-next-line react-hooks/exhaustive-deps` 在該 effect 的 useEffect 結尾 dependency array 行上方一行。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/HostSession.tsx
git commit -m "feat: HostSession 雙路廣播 phase 並接收 student-done"
```

---

## Task 4: StudentSession 接收 phase + 輪到你說話卡 + 說完了

**Files:**
- Modify: `frontend/src/components/StudentSession.tsx`

- [ ] **Step 1: 加入 `interactionPhase` state**

在元件 body 內（與其他 state 一起，如 `aiHint` 旁邊，約 47 行附近）加：
```tsx
  const [interactionPhase, setInteractionPhase] = useState<
    'idle' | 'teacher' | 'generating' | 'student'
  >('idle');
```

- [ ] **Step 2: 在既有 `DataReceived` listener 內加 `'interaction-phase'` 分支**

找到 `frontend/src/components/StudentSession.tsx:211-225` 既有的：
```tsx
    room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant) => {
      if (!participant?.identity.startsWith('host-')) return;
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload)) as { type?: string; payload?: AIHintPayload };
        if (msg.type === 'ai-hint') {
          const p = msg.payload ?? null;
          if (isMounted) {
            setAiHint(p && p.content ? p : null);
            // New hint arrived from teacher — drop any stale student-side extension
            setExtension(null);
            setExtendError(null);
          }
        }
      } catch { /* pose / other messages */ }
    });
```
**整段**替換為（加 `'interaction-phase'` 分支，並擴展 msg 型別）：
```tsx
    room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant) => {
      if (!participant?.identity.startsWith('host-')) return;
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload)) as {
          type?: string;
          payload?: AIHintPayload;
          phase?: 'idle' | 'teacher' | 'generating' | 'student';
        };
        if (msg.type === 'ai-hint') {
          const p = msg.payload ?? null;
          if (isMounted) {
            setAiHint(p && p.content ? p : null);
            // New hint arrived from teacher — drop any stale student-side extension
            setExtension(null);
            setExtendError(null);
          }
        } else if (msg.type === 'interaction-phase' && msg.phase) {
          if (isMounted) setInteractionPhase(msg.phase);
        }
      } catch { /* pose / other messages */ }
    });
```

- [ ] **Step 3: 加入 publishData helper 與 onClick handler**

在元件 body 內（callbacks 區塊；可放在現有的 callback 附近，例如 `handleCardDragStart` 之前），加：

```tsx
  const sendStudentDone = useCallback(() => {
    const room = roomRef.current;
    if (!room || room.state !== 'connected') return;
    try {
      const bytes = new TextEncoder().encode(JSON.stringify({ type: 'student-done' }));
      room.localParticipant.publishData(bytes, { reliable: true });
    } catch { /* ignore */ }
  }, []);

  const handleStudentDoneClick = useCallback(() => {
    // 樂觀本地切回 teacher（隱藏卡）；老師端會用權威 phase 廣播確認
    setInteractionPhase('teacher');
    sendStudentDone();
  }, [sendStudentDone]);
```

- [ ] **Step 4: 渲染「輪到你說話」置中卡**

在元件 return 內、現有 `aiHint` 提示卡渲染附近，加（建議放在主視訊區同層，z-index 高於背景；不要嵌入既有 aiHint 卡，避免被既有最小化/拖曳邏輯吃掉）：

```tsx
      {interactionPhase === 'student' && (
        <div className="ss-turn-overlay" role="dialog" aria-modal="false">
          <div className="ss-turn-card">
            <div className="ss-turn-title">🎤 輪到你說話了</div>
            {aiHint && aiHint.content ? (
              <div className="ss-turn-hint">
                {aiHint.mode === 'rearrange'
                  ? aiHint.content.split(' ').map((w, i) => (
                      <span key={i} className="ai-chip">{w}</span>
                    ))
                  : aiHint.content}
              </div>
            ) : (
              <div className="ss-turn-hint ss-turn-hint--empty">（尚無提示）</div>
            )}
            <button className="ss-turn-done-btn" onClick={handleStudentDoneClick}>
              ✓ 說完了
            </button>
          </div>
        </div>
      )}
```

放置位置：尋找 return 的 root JSX；找一個與既有提示小卡（`ss-ai-card` 一類）平行的層級，加在那附近。如果不確定，加在 root 最外層 `<>...</>` 內、靠近結尾、其他主視訊容器之後即可。

- [ ] **Step 5: 加入 CSS（App.css 檔尾）**

於 `frontend/src/App.css` 最末加：

```css
/* ── 學生端「輪到你說話」置中卡 ───────────────────────────── */
.ss-turn-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 50;
}
.ss-turn-card {
  pointer-events: auto;
  background: rgba(255, 255, 255, 0.96);
  border: 2px solid #00a99d;
  border-radius: 16px;
  padding: 24px 28px;
  min-width: 320px;
  max-width: 80vw;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
  gap: 18px;
  align-items: center;
}
.ss-turn-title {
  font-size: 22px;
  font-weight: 700;
  color: #00897b;
}
.ss-turn-hint {
  font-size: 18px;
  line-height: 1.5;
  color: #222;
  text-align: center;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}
.ss-turn-hint--empty { color: #999; }
.ss-turn-done-btn {
  margin-top: 4px;
  padding: 12px 32px;
  font-size: 17px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #00a99d, #00897b);
  border: none;
  border-radius: 999px;
  cursor: pointer;
  transition: filter 0.15s, transform 0.1s;
}
.ss-turn-done-btn:hover { filter: brightness(1.06); }
.ss-turn-done-btn:active { transform: translateY(1px); }
```

- [ ] **Step 6: 型別檢查 + Lint**

Run: `cd frontend && npx tsc -b --noEmit && npm run lint`
Expected: PASS（無新增 error）。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/StudentSession.tsx frontend/src/App.css
git commit -m "feat: 學生端輪到你說話卡 + 說完了 回送"
```

---

## Task 5: 整合驗證

**Files:** 無（驗證用）

- [ ] **Step 1: 完整建置**

Run: `cd frontend && npm run build`
Expected: `tsc -b` 與 `vite build` 皆成功。

- [ ] **Step 2: Lint**

Run: `cd frontend && npm run lint`
Expected: 無新增 error vs baseline。

- [ ] **Step 3: 啟動 dev server 並手動端到端驗證**

開教師控制台 + 大屏（`/?screen=bigscreen`）+ 一個學生視窗（或手機）。在有 AI 約束的場景下（如 `clothingStore_cashier`）：

1. 老師按「開始互動」→ 立刻錄音（無倒數）。按鈕變「換學生」（主）+「結束錄製」（副）。
2. 老師說一句後按「換學生」→ 短暫「AI 生成中…」→ 大屏出現提示氣泡 + 學生視窗中央跳出「🎤 輪到你說話了」+ 提示內容（重組 chips）+「✓ 說完了」按鈕。老師端按鈕變「輪到自己」+「結束錄製」。
3. 學生按「說完了」→ 卡片立刻消失（樂觀更新）；老師端按鈕變回「換學生」+「結束錄製」；老師 mic 重新錄音。
4. 老師再說一句 → 換學生 → AI 看到上一輪 history（價格、商品保持一致）。
5. 學生回合中老師按「輪到自己」→ 學生卡片消失（因為老師端廣播了新 phase）；老師繼續錄。
6. 老師按「結束錄製」→ 一切回 idle；學生卡片消失；可再點「開始互動」開新一輪（history reset）。
7. 講太短就「換學生」→ 顯示「未偵測到語音…」+ 回 idle；學生卡片不出現。
8. 老師端切場景 → phase 同步 idle；學生卡片消失。

Expected: 全部通過。

- [ ] **Step 4: 最終 commit（若有零散調整）**

```bash
git add -A
git commit -m "chore: 互動輪流對話整合驗證"
```

---

## Self-Review 對照（規格 → 任務）

- 相位 `idle → teacher → generating → student`、移除計時器 → Task 1 ✅
- 「換學生」/「輪到自己」/「結束錄製」三個新動作 → Task 1（按鈕 UI）+ Task 2（handlers）✅
- LiveKit 雙路廣播 phase → Task 3 Step 1 ✅
- `student-done` 訊息接收與 phase 轉移 → Task 3 Step 2 ✅
- 學生端接收 phase + 「輪到你說話」卡 + 「說完了」按鈕 + publishData → Task 4 ✅
- AI 失敗 / transcript 太短 → idle + aiError：既有 transcript effect 已含此邏輯（Task 1 不更動該分支，仍有效）✅
- 多輪歷史不變（沿用既有 transcript effect 路徑 + cache）→ 無需新任務 ✅
- 切場景 / unmount 路徑沿用既有 `handleSceneChange` 與 unmount cleanup（已在 Task 1 Step 6-7 改名引用）✅
- 空白鍵 / 手動三模式 / 3 秒倒數於 phase !== idle 時 guard：既有 keydown/keyup + 3 秒倒數對 `interactionPhaseRef.current !== 'idle'` 的 guard 保持不變 ✅

型別一致性：
- `InteractionPhase` 4 值（Task 1 Step 1）= StudentSession 內 inline union（Task 4 Step 1）一致。
- `'student-done'` 訊息形狀 `{type:'student-done'}`（學生 publish，Task 4 Step 3；老師 receive，Task 3 Step 2）一致。
- `'interaction-phase'` 訊息形狀 `{type:'interaction-phase', phase}`（老師 publish，Task 3 Step 1；學生 receive，Task 4 Step 2；BigScreen 不受影響因為走 BroadcastChannel 不同 codepath）一致。
- 新 callbacks 命名（`startInteraction` / `endInteraction` / `handleTeacherDone` / `handleTeacherTakeover`）在按鈕 onClick（Task 1 Step 8）與宣告（Task 1 Step 4-5、Task 2 Step 1-2）一致。
