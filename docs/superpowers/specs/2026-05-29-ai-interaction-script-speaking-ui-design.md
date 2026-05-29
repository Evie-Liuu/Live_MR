# AI 助理自動腳本 + 大屏說話浮動 UI 設計

日期：2026-05-29
狀態：草稿（待使用者審閱）

## 背景與目標

目前 AI 助理流程：老師以「空白鍵長按」或按鈕觸發 STT → Gemini 生成 →
`AIHintPayload` 透過 BroadcastChannel + LiveKit publishData 廣播給大屏與學生。
大屏的「機器人」（`robot_avatar.png`）目前只在有 AI 提示內容時才出現在說話氣泡內。
LiveKit `ActiveSpeakersChanged` 已在 HostSession 維護成 `speakingSet`，但目前僅用於
教師控制台視訊卡片邊框高亮，**未**傳給大屏。

本次要做（測試展示用）：

1. **教師控制台「開始互動」按鈕**：按下即錄老師說話 15 秒（固定計時）→ 自動停止 →
   送 AI 生成提示給學生。
2. **大屏說話浮動 UI**：常駐的中央機器人，周圍呈現環狀波動；有人說話時啟動，
   並依老師/學生著色。各自角色 VRM 頭上也顯示個別說話標記。
3. **可擴充接口**：未來要能背景持續接收老師說話 + 規則引擎過濾（避免老師講述
   教學內容、停頓語句也被送去 AI 判斷）。本次**只預留架構接口**，不實作規則引擎。
4. **保留現有功能**：空白鍵長按、手動模式按鈕、3 秒自動倒數，全部不變。

非目標（本次不做）：背景連續 STT、實際規則引擎、學生端說話 UI。

## 架構決策

- **說話狀態單一來源 = HostSession 的 `speakingSet`**（已由 LiveKit
  `ActiveSpeakersChanged` 維護）。大屏無 LiveKit 連線，僅靠 BroadcastChannel 驅動，
  因此說話狀態必須由 HostSession 廣播給大屏。不在大屏端另做音量分析。
- 老師 vs 學生由 identity 前綴 `host-` 判斷（沿用全專案既有慣例）。

## 元件設計

### 1. 說話狀態管線（HostSession → BigScreen）

- `BigScreenMsg` 新增類型 `'speaking'`，欄位 `speakingIdentities?: string[]`。
- HostSession：新增 `useEffect`，依 `speakingSet` 變化廣播
  `{ type: 'speaking', speakingIdentities: [...speakingSet] }`。
  （`speakingSet` 已存在，無需新增偵測邏輯。）
- BigScreen：新增 state `speakingIdentities: Set<string>`，於訊息處理迴圈
  （`BigScreen.tsx:1509` 既有 `onmessage`）解析 `'speaking'` 訊息更新。
- 衍生值：`teacherSpeaking = 任一 speaking identity 以 'host-' 開頭`；
  `studentSpeaking = 任一非 'host-' 的 speaking identity`。

### 2. 大屏視覺

**2a. 常駐中央機器人 + 環狀波動**

- 將機器人提升為大屏常駐 DOM 元素（固定位置，建議底部中央區），整個互動期間皆顯示。
- 機器人外圈以 CSS 動畫呈現環狀波動（pulsing ring）：
  - 無人說話：靜止 / 低調 idle 態。
  - 老師說話：teal 色系波動。
  - 學生說話：第二色系波動。
- 既有 AI 提示氣泡（`bs-ai-bar`）改為從此常駐機器人「延伸」呈現，
  維持目前 `ai-mode--*` 樣式與重組 chip 行為。當無提示內容時，只顯示機器人本體與波動。

**2b. 各角色 VRM 頭上個別標記**

- `useBigScreenScene` 新增節流回呼 `onSpeakerAnchors?(anchors: Record<identity, {x:number;y:number}>)`：
  在 RAF render 迴圈末段，對「目前說話中的 identity」取其 VRM 頭部骨骼世界座標，
  用既有 `projectToUV`（或等價 camera 投影）轉成畫布 2D 座標後回呼。
  - 為效能，僅投影 speaking 中的 avatar，且節流（例如每 ~100ms 或每數幀）。
  - 投影需考慮 canvas client 尺寸換算為 CSS px。
- BigScreen：依 `onSpeakerAnchors` 在對應位置渲染 DOM 「說話中」小標記（CSS 浮動標記）。
  identity 離開或停止說話即移除。
- HostSession 需把「目前說話清單」傳入 BigScreen 場景；BigScreen 已持有
  `speakingIdentities`，將其傳給 `useBigScreenScene` 以決定要投影哪些 avatar。

### 3. 「開始互動」自動腳本（HostSession，固定 15 秒）

- 在 ai-assistant 面板新增「開始互動」按鈕。
- 新增相位狀態：`interactionPhase: 'idle' | 'recording' | 'generating' | 'student'`。
- 點擊（守門：場景有 `SCENE_CONSTRAINTS`、STT 支援、且非錄音/非 aiBusy）：
  1. `phase = 'recording'`，`clearTranscript()`、`setAiError(null)`、`startRec()`，
     啟動 15 秒倒數（沿用既有 `countdown` UI 顯示）。
  2. 15 秒到：設定新旗標 `autoScriptTriggerRef.current = true`，呼叫 `stopRec()`。
  3. transcript effect（`HostSession.tsx:682`）偵測到 `autoScriptTriggerRef`：
     **立即**呼叫 `handleHintRef.current('rearrange')`（跳過 3 秒按鈕倒數），
     與現有空白鍵 `spacebarTriggerRef` 路徑同樣機制。`phase = 'generating'`。
  4. AI 回覆並廣播後 `phase = 'student'`，UI 顯示「輪到學生」；數秒後或下次點擊時
     重置回 `idle`。
- 不更動既有空白鍵、手動模式按鈕、3 秒自動倒數流程。
- 邊界：腳本進行中切換場景 / 重複點擊 → 取消倒數、清旗標、回 idle（沿用
  `handleSceneChange` 既有清理；新增旗標一併清除）。

### 4. 規則引擎接口（僅預留，不實作）

- 新增 `frontend/src/config/transcriptGate.ts`：
  ```ts
  export interface TranscriptGateCtx { sceneId: string; source: 'spacebar' | 'button' | 'auto-script' }
  export interface TranscriptGate { accept(text: string, ctx: TranscriptGateCtx): boolean }
  export const passThroughGate: TranscriptGate = { accept: () => true }
  ```
- transcript → AI 送出前呼叫 `gate.accept(text, ctx)`，預設用 `passThroughGate`
  （永遠通過，行為不變）。
- 文件註記：未來「背景持續 STT + 規則引擎過濾」實作此介面，
  在 `accept` 內以規則（最短長度、填詞、教學語句偵測等）回傳 false 即可攔截，
  無需改動送出管線。

## 資料流

```
老師麥克風 ─LiveKit→ ActiveSpeakersChanged ─→ HostSession.speakingSet
   │                                               │
   │ (STT 文字)                                     │ broadcast 'speaking'
   ▼                                               ▼
handleHint → gate.accept? → Gemini → AIHintPayload   BigScreen.speakingIdentities
   │ broadcast 'ai-hint'                                  │
   ▼                                                       ▼
BigScreen 機器人氣泡 + 學生端                    中央機器人環狀波動 + VRM 頭上標記
```

## 測試計畫

- 手動：開兩個視窗（教師 + 大屏），驗證：
  - 按「開始互動」→ 倒數 15 秒 → 自動送 AI → 大屏出現提示。
  - 老師說話時大屏機器人 teal 波動 + 老師 VRM 頭上標記；學生說話換色 + 學生 VRM 頭上標記。
  - 空白鍵長按、手動按鈕、3 秒倒數仍照舊運作。
  - 切換場景時腳本與波動正確清理。
- 型別檢查 / lint 通過。

## 風險

- VRM 頭部投影座標與 DOM 疊加對位可能需微調（canvas 縮放、DPR）。先以 speaking-only +
  節流降低成本。
- LiveKit `ActiveSpeakers` 是否含本地老師：需驗證；若不含則改用 `localParticipant`
  audio level 補上（屬既有 speakingSet 行為範圍，本次沿用）。
