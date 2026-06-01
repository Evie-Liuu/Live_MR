# 互動腳本改為開放式輪流對話設計

日期：2026-06-01
狀態：草稿（待使用者審閱）

## 背景與目標

現行「開始互動」是固定計時（目前 10 秒）：老師開始說話 → 計時到自動停 →
送 AI 生成提示 → 學生看到提示 → 8 秒後自動回 idle。

要改成**開放式輪流**：

- 老師按「開始互動」即開始錄音，**無自動計時**。
- 老師說完，按「**換學生**」結束本輪 → 送 AI 生成提示 → 進入學生回合。
- 老師也可隨時按「**結束錄製**」整個結束本次互動回到 idle。
- 學生端在輪到他時看到提示卡 + 大按鈕「**說完了**」；按下 → 切回老師回合。
- 老師也可主動按「**輪到自己**」搶回控制權。

非目標：
- 學生端 STT（不做語音辨識；學生語音僅透過 LiveKit 麥克風傳遞 + 大屏說話指示器呈現）
- 增量 AI（不在老師講話途中就送 AI）
- 對話流程的自動結束邏輯（必須明確由老師「結束錄製」或切場景結束）

## 相位狀態機

```
idle ──[開始互動]──→ teacher ──[換學生]──→ generating ──[hint OK]──→ student
                       │                       │ (hint fail/太短)        │
                       │                       └──→ idle (顯示 error)    │
                       ├──[結束錄製]──→ idle                              │
                       │                                                │
                       └◄──[輪到自己 (老師) / 說完了 (學生 data msg)]──────┘

student ──[結束錄製]──→ idle
任何 phase ──[切場景 / unmount]──→ idle
```

### 相位定義

| Phase | 意義 | 老師 mic | 是否 broadcast hint | 老師看到的主按鈕 / 副按鈕 |
|---|---|---|---|---|
| `idle` | 未進入互動 | 停 | — | 「開始互動」/ — |
| `teacher` | 老師正在說、累積 transcript | 開（持續錄音） | — | 「換學生」/「結束錄製」 |
| `generating` | 已送 AI、等回覆 | 停 | 即將 broadcast | 「AI 生成中…」(disabled) /「結束錄製」 |
| `student` | 學生回合，hint 已顯示 | 停 | 已 broadcast | 「輪到自己」/「結束錄製」 |

### 轉移細節

- **idle → teacher**（按「開始互動」）：`resetChatHistory()` + `resetCachedReplies()` + `clearTranscript()` + `setAiError(null)` + `setInteractionPhase('teacher')` + `startRec()`。
- **teacher → generating**（按「換學生」）：標記 `autoScriptTriggerRef.current = true` + `setInteractionPhase('generating')` + `stopRec()`。transcript effect 偵測到 trigger flag 後立刻呼叫 `handleHintRef.current('rearrange')`（沿用既有 immediate-send 路徑）。
- **generating → student**：`handleHint` 成功完成 broadcast 後，`setInteractionPhase('student')`。
- **generating → idle**：transcript 過短或 AI 失敗。設 `aiError` 並 `setInteractionPhase('idle')`。
- **student → teacher**：
  - 老師按「輪到自己」直接呼叫 `setInteractionPhase('teacher')` + `clearTranscript()` + `startRec()`。
  - 學生按「說完了」→ LiveKit `publishData({type:'student-done'})` → 老師端 `DataReceived` handler 觸發同樣轉移。
- **任何非 idle → idle**：「結束錄製」按下 → `cancelInteractionScript()`（既有 cleanup 函式擴充）：stop rec、清 flags、phase=idle。
- **切場景 / unmount → idle**：沿用既有 `handleSceneChange` / unmount cleanup。

## 教師端（HostSession）變動

### 移除

- `SCRIPT_RECORD_SECONDS` 常數
- `scriptTimerRef`（setTimeout）、`scriptTickRef`（setInterval）
- `scriptCountdown` state 與其倒數 UI
- student→idle 的 8 秒自動 reset useEffect

### 修改

- `startInteractionScript`（重新命名為 `startInteraction` 或保留命名）：移除倒數，只執行 idle→teacher 轉移。
- 新增 `handleTeacherDone`：teacher → generating（送 AI）。
- 新增 `handleTeacherTakeover`：student → teacher（搶回）。
- `cancelInteractionScript` 改名為 `endInteraction` 或保留：所有 phase → idle，清 timer/flag/transcript。
- transcript effect 內 `isAutoScript` 旁路維持（按「換學生」後此 flag 為 true → 立刻 `handleHintRef.current('rearrange')`）。
- AI 成功 → `setInteractionPhase('student')`（已存在於 transcript effect）。**新增**：AI 失敗（catch 內）或 transcript 太短早退 → 若 `isAutoScript` 則 `setInteractionPhase('idle')`。
- transcript 太短的判斷已在 transcript effect 既有路徑處理；確保 `isAutoScript` 為 true 時走 idle reset（既有實作已含此邏輯）。

### LiveKit data 廣播 phase

目前 `'interaction-phase'` 只走 BroadcastChannel 給 BigScreen。改成：phase 變動的 useEffect 同時也 `publishData({type:'interaction-phase', phase})` 給所有 remote participants（學生）。模式對齊既有 `broadcastAIHint` 的雙路廣播（BroadcastChannel + publishData）。

### 監聽學生 `student-done`

`handleDataReceived`（既有處理 pose）內加分支：解析 JSON，`type:'student-done'` 時若 phase=student → `setInteractionPhase('teacher')` + `clearTranscript()` + `startRec()`。

### 按鈕 UI（AI panel 內）

主按鈕顯示根據 phase：

```tsx
{phase === 'idle' && <button onClick={startInteraction}>開始互動</button>}
{phase === 'teacher' && <button onClick={handleTeacherDone}>換學生</button>}
{phase === 'generating' && <button disabled>AI 生成中…</button>}
{phase === 'student' && <button onClick={handleTeacherTakeover}>輪到自己</button>}

{phase !== 'idle' && (
  <button className="hs-ai-start-cancel" onClick={endInteraction}>結束錄製</button>
)}
```

樣式沿用既有 `hs-ai-start-btn` + `phase-${phase}` 類別。

## 學生端（StudentSession）變動

### 新增 state

```ts
const [interactionPhase, setInteractionPhase] = useState<
  'idle' | 'teacher' | 'generating' | 'student'
>('idle');
```

從老師端 `publishData` 收到 `'interaction-phase'` 後同步。

### UI

當 `interactionPhase === 'student'` 時，在學生螢幕中央顯示一張**置中提示卡**：

- 標題：`🎤 輪到你說話了`
- 中段：當前 `aiHint`（既有 hint card 邏輯重用，包含 rearrange chips / complete / extend 三種型態）
- 大按鈕：`✓ 說完了`

按「說完了」時：
- 樂觀更新：本地 `setInteractionPhase('teacher')`（卡片立刻收起）
- `roomRef.current.localParticipant.publishData(JSON.stringify({type:'student-done'}), {reliable:true})`

當 `interactionPhase` 是其他值時，不顯示這張提示卡（不影響既有 hint 小卡的顯示）。

老師相位是 `teacher`、`generating` 時學生端不顯示額外提示（避免干擾），但既有的 BigScreen 說話指示器仍會自然顯示誰在說話。

### LiveKit Data 監聽

`RoomEvent.DataReceived` 增加 `'interaction-phase'` 分支：

```ts
if (parsed.type === 'interaction-phase') {
  setInteractionPhase(parsed.phase);
}
```

既有的 `'ai-hint'` 分支不動。

## 資料流（完整一輪）

```
老師按「開始互動」
  → HostSession setPhase('teacher') + startRec
  → broadcast 'interaction-phase' (BroadcastChannel + LiveKit data)
  → BigScreen 收到（label/UI 可選）
  → StudentSession 收到（無顯示，僅同步 state）

老師說話… (mic 連續錄音 transcript 累積)

老師按「換學生」
  → HostSession autoScriptTriggerRef=true + setPhase('generating') + stopRec
  → STT onend → setTranscript(...) → transcript effect 偵測 isAutoScript=true
  → 立刻 handleHintRef.current('rearrange')
    → handleHint 走 cache cold path
      → generateHints(txt, {history, systemInstruction})
      → 成功：cache 填、history append、broadcastAIHint
        → BigScreen 機器人氣泡顯示
        → StudentSession 收到 ai-hint → 既有 hint card 渲染
      → setPhase('student')
        → broadcast phase → StudentSession 顯示「輪到你說話」卡 + 說完了 按鈕

學生按「說完了」
  → 樂觀本地 setPhase('teacher') (隱藏卡)
  → publishData {type:'student-done'}
  → HostSession DataReceived handler
    → setPhase('teacher') + clearTranscript + startRec
    → broadcast phase → 學生端覆寫為 'teacher'（一致）

(回到 teacher 相位；老師可繼續說、再按「換學生」進入下一輪)

任何時刻：
老師按「結束錄製」 → endInteraction → phase='idle' + stop rec + 清 flags
  → broadcast phase → 學生端 setPhase('idle')，移除任何 student 卡
```

## 邊界處理

- **AI 失敗 / transcript 太短**：phase 回 idle、`setAiError(...)`，老師端按鈕回「開始互動」。
- **多個學生**：hint reliable broadcast 給所有人；任一學生按「說完了」即把 phase 切回 teacher（先到先得）。
- **學生中途離開**：phase=student 無意義但無害；老師仍可「輪到自己」或「結束錄製」恢復。
- **空白鍵 / 手動三模式按鈕 / 3 秒按鈕倒數**：phase !== idle 時 keydown/keyup 都早退（沿用既有 guard）。手動按 3 模式按鈕仍可在 idle 相位下使用。
- **切場景 / unmount**：cancel/end interaction → idle（沿用既有路徑，需加 broadcast phase 給學生端）。
- **「結束錄製」在 generating 相位按下**：取消後續送出、phase=idle；若 AI 已在飛行中其回覆抵達時忽略（因為 phase 已 idle，broadcastAIHint 可選擇仍 broadcast 但行為無害，或檢查 phase 略過 — 保守起見保留 broadcast 一致性）。

## 介面契約變更

`BigScreenMsg`：
- 既有 `'interaction-phase'` 訊息不變（已存在）。
- 不新增訊息。

LiveKit `publishData` JSON 訊息（既有 + 新增）：
```ts
// 既有
{ type: 'ai-hint', payload: AIHintPayload }
// 新增
{ type: 'interaction-phase', phase: 'idle' | 'teacher' | 'generating' | 'student' }
{ type: 'student-done' }
```

## 測試計畫

無自動測試 framework — 沿用 tsc + lint + 手動。

- `npx tsc -b --noEmit` 通過。
- `npm run lint` 維持 baseline。
- 手動：
  1. 老師點「開始互動」→ 立刻錄音（無倒數）。BigScreen 機器人 ring teal 波動。
  2. 講一句後點「換學生」→ 短暫「AI 生成中」→ 學生畫面跳出「輪到你說話」+ 提示卡 + 說完了。
  3. 學生按「說完了」→ 卡消失；老師端按鈕變回「換學生」+ 「結束錄製」；老師端 mic 又開始錄。
  4. 老師再講一句 → 換學生 → AI 看到上一輪 history（價格、商品等保持一致）。
  5. 學生回合中老師按「輪到自己」→ 立刻收卡；老師繼續錄。
  6. 老師按「結束錄製」→ 一切清空回 idle；可再點「開始互動」開新一輪（history reset）。
  7. 講太短就「換學生」→ 顯示「未偵測到語音…」+ 回 idle。
  8. 老師端切場景 → 學生端的 student 卡正確收起、phase 同步 idle。

## 風險

- LiveKit data publish 的 reliable delivery 在斷網恢復可能 race。本次相位機制以最新到達訊息為準，無歷史重播，可接受。
- 學生「說完了」樂觀更新與老師端覆寫的時序：若 publish 失敗，phase 會在學生端永遠停在 'teacher' 而老師端仍是 'student' — 不致命，老師端可手動「輪到自己」修正。
