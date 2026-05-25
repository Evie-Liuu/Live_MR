# 學生 AI 助理（Student AI Assistant）設計

**日期**：2026-05-25
**範圍**：`frontend/`
- 新增：`config/aiAssistant.ts`、`hooks/useSpeechRecording.ts`、`utils/ollamaClient.ts`
- 修改：`components/HostSession.tsx`、`components/StudentSession.tsx`、`components/BigScreen.tsx`、`App.css`

---

## 目標

在情境對話中，AI 為學生即時生成「回應老師」的英語範例，分三種模式：

1. **完整（complete）** — 一句最簡單、可直接照念的完整英語回答
2. **重組（rearrange）** — 一句完整英語答句但單字順序打亂，學生需重新排序
3. **延伸（extend）** — 較完整的回答，加上修飾語、補充資訊或反問

AI 推論在老師端進行（本地 Ollama），結果同時廣播到所有 StudentSession（學生個人裝置）和 BigScreen（投影大屏）。

**觸發策略**：
- 老師說話採「按錄音」模式 — 按下開始錄音，再按一次停止；STT 在停止那刻產出該段 transcript。
- **預設自動行為**：停止錄音後 **3 秒倒數** → 自動以該段 transcript 觸發**重組（rearrange）**模式提示並廣播。
- **手動備援**：3 秒倒數期間或結束後，老師可按「①完整」/「③延伸」覆寫 — 按下會取消倒數，改以該模式重新生成。

---

## 使用者流程

1. 老師在 HostSession 切到「🤖 AI 助理」分頁。
2. 老師按下「● 錄音」按鈕 → Web Speech API 開始辨識；面板顯示「錄音中…」即時 transcript。
3. 老師說完一句話 → 再按一次按鈕停止錄音 → transcript 凍結為該段內容；面板開始顯示「3 秒後自動廣播重組提示」倒數。
4. **路徑 A（預設自動）**：3 秒倒數結束 → 自動以 `mode='rearrange'` 觸發 → 組 prompt → fetch Ollama → 廣播。
5. **路徑 B（手動覆寫）**：倒數期間或結束後，老師按「① 完整」或「③ 延伸」→ 取消尚未啟動的自動倒數 → 改以該模式觸發。
6. Ollama 回應 → HostSession 同時：
   - 在「最新提示」區顯示給老師看
   - 透過 LiveKit `publishData` 廣播給所有 StudentSession
   - 透過 BroadcastChannel 廣播給 BigScreen
7. StudentSession 個人畫面右上角 overlay 卡片即時顯示提示；BigScreen 底部橫條同步顯示。
8. 老師按「✕ 清除」→ 廣播清空訊息 → 學生卡片淡出 / 大屏橫條消失。
9. 老師再次按「● 錄音」開始下一段 → 取消任何未完成倒數 + 清空舊 transcript，回到步驟 2。
10. 場景切換 → 自動取消倒數、清空 transcript 與最新提示，新場景才有對應約束文件。

---

## 架構

```
┌─────────────────── HostSession（老師端） ───────────────────┐
│  [●錄音] 按下開始 / 再按停止 ─► Web Speech API                │
│                                          │                  │
│                                  停止那刻凍結 transcript      │
│                                          │                  │
│                                  ┌───────┴────────┐         │
│                                  ▼                ▼         │
│                       3 秒倒數→ rearrange   老師按 ①/③ 覆寫 │
│                                  │                │         │
│                                  └───────┬────────┘         │
│                                          ▼                  │
│         buildPrompt(transcript, scene, mode) → Ollama        │
│                          │                                   │
│                ┌─────────┴──────────┐                        │
│                ▼                    ▼                        │
│      LiveKit publishData    BroadcastChannel.postMessage     │
└────────────────│────────────────────│────────────────────────┘
                 ▼                    ▼
   ┌──────────────────────┐   ┌──────────────────────┐
   │ StudentSession (n)    │   │ BigScreen (同機器)    │
   │ .ss-ai-card overlay   │   │ .bs-ai-bar 底部橫條   │
   └──────────────────────┘   └──────────────────────┘
```

### 資料層 — `frontend/src/config/aiAssistant.ts`（新檔）

```ts
export type AIHintMode = 'complete' | 'rearrange' | 'extend'

/** AI 廣播訊息 payload（沿用 LiveKit + BroadcastChannel 雙通道） */
export interface AIHintPayload {
  mode: AIHintMode | null   // null = 清除
  content: string | null    // AI 回應；null = 清除
  sourceText: string | null // 觸發當下的老師原話（最近 N 秒），給學生對照
  ts: number                // Date.now()
}

/** key = scene id（對應 scenes.ts 裡的場景 id） */
export const SCENE_CONSTRAINTS: Record<string, string> = {
  clothing_store: `
Setting: A clothing store checkout. The student plays a customer, the teacher plays a shop assistant.
Language: English, everyday shopping conversation.
Grammar: Use simple present tense primarily. Avoid past tense and complex constructions.
Vocabulary: prices (dollars, cost, price), sizes (small, medium, large), colors,
payment methods (cash, card), polite expressions (please, thank you).
Response style: short, conversational, natural — 1 to 2 sentences.
`.trim(),
  // 其他 scene 之後補
}

const MODE_INSTRUCTIONS: Record<AIHintMode, string> = {
  complete:
    'Output ONE simple, complete English sentence that the student can read aloud directly. Example: "It is 200 dollars."',
  rearrange:
    'Output ONE complete English sentence answer, but shuffle the word order. Separate words with single spaces. The student will reorder them. Example: "dollars It 200 is"',
  extend:
    'Output ONE more complete English sentence with additional details, modifiers, or a follow-up question. Example: "It is 200 dollars, but we have a 10% discount today. Would you like to try it on?"',
}

/** Pure function. Easily testable. No React deps. */
export function buildPrompt(
  transcript: string,
  sceneConstraint: string,
  mode: AIHintMode,
): string {
  return `You are an English conversation teaching assistant. The student is learning conversation in the following setting:

${sceneConstraint}

The teacher just said to the student:
"""
${transcript}
"""

Generate a sample reply for the STUDENT to respond to the teacher.
Requirements:
${MODE_INSTRUCTIONS[mode]}

Output ONLY the final answer. No explanation, no preamble, no Chinese.`
}
```

### STT 層 — `frontend/src/hooks/useSpeechRecording.ts`（新檔）

```ts
export interface UseSpeechRecordingResult {
  recording: boolean           // 是否正在錄音
  interim: string              // 錄音中的即時文字（顯示「錄音中…」用）
  transcript: string           // 上次停止錄音時凍結的最終 transcript
  supported: boolean           // 瀏覽器是否支援
  error: string | null
  start: () => void            // 開始新一段錄音（會清空 interim + transcript）
  stop: () => void             // 停止當前錄音；停止後 transcript 才會更新
  clear: () => void            // 清空 transcript（場景切換用）
}

export function useSpeechRecording(): UseSpeechRecordingResult
```

實作要點：
- 使用 `window.webkitSpeechRecognition`（Chrome / Edge）— `SpeechRecognition` 也加 fallback。
- `recognition.continuous = true; recognition.interimResults = true; recognition.lang = 'en-US'`。
- `start()`：若已 `recording` 則先 `stop()`；清空內部 buffer 和 `transcript`、`interim`；呼叫 `recognition.start()`；`setRecording(true)`。
- `onresult`：分 final / interim 兩類；final 結果累加到內部 buffer，interim 結果即時更新 `interim` state。
- `stop()`：呼叫 `recognition.stop()`；在 `onend` 中把累計 buffer 寫入 `transcript`、清空 `interim`、`setRecording(false)`。停止那刻是「老師完成會話」的觸發點 — `transcript` 由空 / 舊值 → 新值，HostSession 用 effect 監聽變化以啟動 3 秒倒數。
- 過濾規則：寫入 `transcript` 前 trim；若 < 3 字元或全為 filler（`uh`, `um`, `ah`）則保留為空字串（後續 HostSession 不會觸發倒數）。
- `clear()`：清空 `transcript` 和 `interim`（不影響錄音中狀態）。
- `supported = false` 時 `start()` 直接 no-op；error 訊息「This browser does not support Web Speech API. Please use Chrome or Edge.」。

### Ollama 客戶端 — `frontend/src/utils/ollamaClient.ts`（新檔）

```ts
const OLLAMA_URL = 'http://localhost:11434/api/generate'
const MODEL = 'qwen2.5:3b'
const TIMEOUT_MS = 10_000

export async function generateHint(
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  // 如果外部也給 signal，兩邊都會中止
  signal?.addEventListener('abort', () => controller.abort())
  try {
    const res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.6, num_predict: 80 },
      }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
    const data = await res.json() as { response?: string }
    const text = (data.response ?? '').trim()
    if (!text) throw new Error('Empty response')
    return text
  } finally {
    clearTimeout(timer)
  }
}
```

錯誤分類（給 UI 顯示中文訊息）：
- `TypeError: Failed to fetch` → 「無法連線 Ollama，請確認本機已啟動 `ollama serve`」
- `Ollama HTTP 404` → 「模型 qwen2.5:3b 未安裝，請執行 `ollama pull qwen2.5:3b`」
- `AbortError` 且超過 timeout → 「AI 回應逾時，請重試」
- 其他 → 「AI 生成失敗：{message}」

### 訊息層 — `BigScreenMsg`（`BigScreen.tsx`）

新增一個 type case：

```ts
export interface BigScreenMsg {
  type: ... | 'ai-hint'
  // 既有欄位 ...
  aiHint?: AIHintPayload  // 仅在 type === 'ai-hint' 时设置
}
```

### LiveKit 訊息封包

沿用既有 `room.localParticipant.publishData(Uint8Array, { reliable: true })`：

```ts
const json = JSON.stringify({ type: 'ai-hint', payload: aiHintPayload })
const bytes = new TextEncoder().encode(json)
room.localParticipant.publishData(bytes, { reliable: true })
```

學生端 LiveKit `DataReceived` listener 中新增 case `'ai-hint'`。pose 資料用 `reliable: false`，但 AI 提示須保證送達 → 用 `reliable: true`。

### HostSession (`components/HostSession.tsx`)

新增 state：

```ts
const [aiBusy, setAiBusy] = useState(false)
const [aiError, setAiError] = useState<string | null>(null)
const [latestHint, setLatestHint] = useState<AIHintPayload | null>(null)
const [countdown, setCountdown] = useState<number | null>(null) // 3 → 2 → 1 → null
const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
const {
  recording, interim, transcript, supported: sttSupported, error: sttError,
  start: startRec, stop: stopRec, clear: clearTranscript,
} = useSpeechRecording()
```

新增 callback：

```ts
// currentSceneId 沿用 HostSession 既有的場景 state（與 task-hints 取 currentTask 同一處）

const cancelAutoCountdown = () => {
  if (autoTimerRef.current) { clearTimeout(autoTimerRef.current); autoTimerRef.current = null }
  if (tickTimerRef.current) { clearInterval(tickTimerRef.current); tickTimerRef.current = null }
  setCountdown(null)
}

const handleHint = async (mode: AIHintMode) => {
  cancelAutoCountdown()                                    // 手動覆寫一定取消倒數
  if (aiBusy || transcript.length < 3) return
  const constraint = SCENE_CONSTRAINTS[currentSceneId]
  if (!constraint) { setAiError('此場景尚無 AI 助理約束文件'); return }
  setAiBusy(true); setAiError(null)
  try {
    let content = await generateHint(buildPrompt(transcript, constraint, mode))
    // 重組模式後備：若沒有空格分隔，補打一次 complete 再 shuffle
    // shuffleWords: 把字串 split(' ')、Fisher-Yates 洗牌、join(' ')；放在 utils 或 inline
    if (mode === 'rearrange' && !content.includes(' ')) {
      const complete = await generateHint(buildPrompt(transcript, constraint, 'complete'))
      content = shuffleWords(complete)
    }
    const payload: AIHintPayload = { mode, content, sourceText: transcript, ts: Date.now() }
    setLatestHint(payload)
    broadcastAIHint(payload)  // 同時走 BroadcastChannel + LiveKit
  } catch (e) {
    setAiError(toFriendlyError(e))
  } finally {
    setAiBusy(false)
  }
}

const handleClear = () => {
  cancelAutoCountdown()
  const payload: AIHintPayload = { mode: null, content: null, sourceText: null, ts: Date.now() }
  setLatestHint(null)
  broadcastAIHint(payload)
}

const handleToggleRecord = () => {
  if (recording) {
    stopRec()           // 停止錄音 → useSpeechRecording 會在 onend 更新 transcript → 下方 effect 啟動倒數
  } else {
    cancelAutoCountdown()
    clearTranscript()
    startRec()
  }
}
```

**3 秒自動倒數 effect**：監看 `transcript` 變化（由 useSpeechRecording 在停止錄音時更新）：

```ts
useEffect(() => {
  if (!transcript || transcript.length < 3) return
  if (!SCENE_CONSTRAINTS[currentSceneId]) return        // 場景無約束文件就不自動
  // 啟動 3 秒倒數 — 期間若使用者再次按錄音 / 按手動模式 / 切場景，都會在那邊呼叫 cancelAutoCountdown
  setCountdown(3)
  tickTimerRef.current = setInterval(() => {
    setCountdown((c) => (c !== null && c > 1 ? c - 1 : c))
  }, 1000)
  autoTimerRef.current = setTimeout(() => {
    cancelAutoCountdown()
    handleHint('rearrange')                              // 預設自動走重組
  }, 3000)
  return () => cancelAutoCountdown()
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [transcript])
```

`broadcastAIHint` 在既有 BroadcastChannel sync 處抽出（與 `task-change`、`hint-change` 同位置），並另呼叫 LiveKit `publishData`。

**場景切換重置**：在既有監看 `currentSceneId` 的 `useEffect` 中，發現變化 → `cancelAutoCountdown(); if (recording) stopRec(); clearTranscript(); setLatestHint(null); handleClear()`。

**unmount 清理**：`useEffect(() => () => cancelAutoCountdown(), [])`。

**UI — `.hs-ai-panel`**：放在 `hs-video-area` 右側，與既有 `.hs-hint-panel` 共用位置，**做成 tab 切換**（任務提示 / AI 助理），避免兩個欄並排佔太寬。

```
┌────── 🤖 AI 助理 ──────┐
│ [● 錄音 / ■ 停止]  狀態  │
│ 錄音中… "It is two..."  │   ← interim（錄音中即時顯示）
│ 上次說的：…              │   ← transcript（停止後凍結）
│                         │
│ ⏱ 3 秒後自動廣播重組…    │   ← countdown != null 時顯示
│ [①完整] [②重組] [③延伸] │   ← ②重組標「自動 / 手動」雙用；①③為手動覆寫
│ 最新提示：…              │
│ [✕ 清除學生畫面]         │
└────────────────────────┘
```

互動規則：
- STT 不支援 → 整個面板顯示警示，錄音鈕 disabled
- 未錄過音 / `transcript.length < 3` / scene 無約束文件 → 三顆模式按鈕 disabled（也不會啟動自動倒數）
- 錄音中 → 模式按鈕 disabled；倒數狀態被清空
- `countdown !== null` → 按鈕顯示「（將自動觸發 ②）」hint；按 ①/③ 取消倒數改走該模式；按 ② 等同直接觸發（取消剩餘秒數立即生成）
- `aiBusy` → 三顆按鈕 disabled + spinner
- `aiError` → 紅字訊息（不廣播）
- 切換 tab 不影響後台狀態（錄音 / 倒數 / 廣播持續）

### StudentSession (`components/StudentSession.tsx`)

新增 state：

```ts
const [aiHint, setAiHint] = useState<AIHintPayload | null>(null)
const [showSource, setShowSource] = useState(false)  // sourceText 預設摺疊
```

LiveKit `DataReceived` listener 加 case：

```ts
room.on(RoomEvent.DataReceived, (payload, participant) => {
  if (!participant?.identity.startsWith('host-')) return
  try {
    const msg = JSON.parse(new TextDecoder().decode(payload))
    if (msg.type === 'ai-hint') {
      setAiHint(msg.payload.content ? msg.payload : null)
    }
  } catch { /* pose / 其他類型訊息 */ }
})
```

**UI — `.ss-ai-card`**：右上角 overlay 卡片，`aiHint && aiHint.content` 時 render：

```
┌─ 🤖 老師提示 ─┐
│ 模式：完整     │   ← 三種模式用不同色標題 (complete=綠/rearrange=橘/extend=藍)
│               │
│ "It is 200..."│   ← rearrange 模式渲染成 chip 陣列
│               │
│ ▾ 老師原話     │   ← 點開展開 sourceText
│ [關閉]         │   ← 觸發 setAiHint(null)
└───────────────┘
```

重組模式渲染：把 `content.split(' ')` 各個 token 用虛線框 chip 顯示。

### BigScreen (`components/BigScreen.tsx`)

BroadcastChannel listener 新增 case `'ai-hint'` → `setAiHint(payload)`。

**UI — `.bs-ai-bar`**：底部橫條，疊在既有 `.bs-hint-bar`（task-hints）上方 — 兩條可同時存在。重組模式同樣 chip 渲染、不同色標題。

### 樣式 — `App.css`

- `.hs-ai-panel`：與 `.hs-hint-panel` 共用 tab 容器；tab header 兩顆按鈕（任務提示 / AI 助理）
- `.hs-ai-record-btn`：圓形大按鈕，錄音中為紅色脈動；停止為灰
- `.hs-ai-transcript`：等寬字、固定高度、上下捲動；錄音中以較淡顏色顯示 interim
- `.hs-ai-countdown`：3 秒倒數顯示（大字 + 進度條）
- `.hs-ai-mode-btn`：三顆按鈕並排；倒數中時 `.hs-ai-mode-btn--auto-target`（②重組）加亮邊框
- `.hs-ai-latest`：最新提示卡片，類似 `.hs-hint-content`
- `.ss-ai-card`：固定右上、半透明深色背景、可摺疊區
- `.bs-ai-bar`：絕對定位 `bottom: <bs-hint-bar 高度>`，半透明深色、字大
- `.ai-mode--complete` / `--rearrange` / `--extend`：三種模式對應色（綠橘藍）
- `.ai-chip`：重組模式單字 chip，虛線框

---

## 元件邊界

| 單元 | 職責 | 對外介面 | 依賴 |
|---|---|---|---|
| `aiAssistant.ts` | 約束文件、prompt 模板、型別 | `SCENE_CONSTRAINTS`、`buildPrompt`、`AIHintMode`、`AIHintPayload`、`MODE_INSTRUCTIONS` | 無 |
| `useSpeechRecording` | 封裝 Web Speech API 的按錄音模式，停止時凍結 transcript | `() => { recording, interim, transcript, supported, error, start, stop, clear }` | 瀏覽器 `webkitSpeechRecognition` |
| `ollamaClient.ts` | 對 Ollama 發 POST | `generateHint(prompt, signal) => Promise<string>` | fetch |
| HostSession `.hs-ai-panel` | UI + 錄音/倒數狀態機 + 廣播協調 | 錄音 toggle / 三顆模式按鈕 callback / clear；內部維護 `autoTimerRef` / `countdown` | `useSpeechRecording`、`ollamaClient`、`aiAssistant`、LiveKit room、BroadcastChannel |
| StudentSession `.ss-ai-card` | 顯示收到的 AI 提示 | LiveKit `DataReceived` listener | `aiAssistant`（型別）、既有 room |
| BigScreen `.bs-ai-bar` | 投影大屏底部顯示 | BroadcastChannel listener | `aiAssistant`（型別）、既有 channel |
| LiveKit `ai-hint` 訊息 | 老師 → 學生跨裝置同步 | `{ type:'ai-hint', payload }` JSON，`reliable: true` | 既有 Room |
| BroadcastChannel `ai-hint` 訊息 | 老師 → BigScreen 同機器同步 | 同上 | 既有 channel |

---

## 邊界情況

| 情境 | 行為 |
|---|---|
| Ollama 沒裝 / 11434 拒絕連線 | 紅字「無法連線 Ollama，請確認本機已啟動 `ollama serve`」+ 解鎖按鈕 |
| Ollama 模型未下載 | 紅字「模型 qwen2.5:3b 未安裝，請執行 `ollama pull qwen2.5:3b`」 |
| 瀏覽器不支援 Web Speech API（如 Firefox） | AI 面板顯示警示 + 錄音鈕 disabled |
| 錄完音 transcript 為空 / 太短（< 3 字元） | 不啟動 3 秒倒數；三顆按鈕保持 disabled；面板提示「太短，請再錄一次」 |
| STT 停止後判定全為 filler（uh, um） | 同上：不啟動倒數 |
| 老師在倒數中再按錄音 | 取消倒數 + 清空 transcript + 開始新一段錄音 |
| 老師在倒數中按 ①完整 / ③延伸 | 取消倒數，立即以該模式生成廣播 |
| 老師在倒數中按 ②重組 | 取消倒數的剩餘秒數，立即以重組模式生成廣播（不必等滿 3 秒）|
| 老師在倒數中切場景 | 取消倒數 + 清空 transcript + 廣播清除訊息 |
| AI 生成中（aiBusy）使用者再按錄音 | 允許 — 開始新錄音不會中斷 in-flight 的 fetch；fetch 回來時若已有更新的 transcript，仍以當時抓取的 transcript 廣播（不會回頭重打）|
| 學生中途加入 room | 沒有歷史 AI 提示可看；只接收按下後的廣播 |
| AI 回應截斷（達 80 token） | 取已輸出文字直接廣播，不視為錯誤 |
| AI 回應為空 | 視為失敗，紅字「AI 未能生成提示，請重試」 |
| 重組模式回應沒有空格分隔 | 後備：補打一次 complete prompt → 前端 `shuffleWords` |
| `SCENE_CONSTRAINTS[currentSceneId]` 不存在 | 三顆按鈕 disabled、不啟動倒數，面板顯示「此場景尚無 AI 助理約束文件」 |
| LiveKit room 斷線 | 老師端 UI 仍顯示「最新提示」但加註「⚠ 學生端未收到」；BroadcastChannel 仍可送 BigScreen |
| 元件 unmount（HostSession 解除掛載） | 清掉 `autoTimerRef` / `tickTimerRef`，避免 setState on unmounted |

---

## 不在範圍內（YAGNI）

- 串流 token-by-token UI — 句子短，不需要
- 歷史 AI 提示列表 / 學生回看 — 即時即用
- 由 STT 靜音偵測自動結束錄音 — 改用「按錄音」明確控制，不再做沉默結束推斷
- 可調的自動倒數秒數 / 開關 — 本次寫死 3 秒、預設開啟（沒提示需求就拉 config）
- 多模型切換 UI — 在 config 寫死 `qwen2.5:3b`
- 學生發起請求 — 控制權核心需求
- AI 提示效果統計 / 後台分析 — 之後再說
- AI 提示寫進 BigScreen canvas 錄影 — DOM overlay 即可
- 跨 scene 共用約束（base + override） — 本次每 scene 寫獨立完整文字
- task 粒度約束文件 — 本次只到 scene 粒度
- 老師端 Ollama 走後端代理 — 本次直接 fetch `localhost:11434`

---

## 測試方式

純手動驗證（前端 UI + 本機模型）：

1. `ollama pull qwen2.5:3b && ollama serve` → `curl http://localhost:11434/api/tags` 確認可連。
2. 開 HostSession → AI 助理 tab 出現。
3. 按「● 錄音」→ 紅色脈動 + 「錄音中…」即時 interim 文字。
4. 講一句英文後按「■ 停止」→ interim 消失、「上次說的」凍結為剛剛那句、面板出現「⏱ 3 秒後自動廣播重組提示」倒數。
5. **等 3 秒不動** → 自動觸發 → spinner → 1~3 秒 → 「最新提示」區出現 chip 化亂序單字（mode=rearrange）。
6. 開一個 StudentSession 加入同 room → 重做第 4 步等自動觸發 → 學生 overlay chip 卡片即時出現。
7. 開 BigScreen 視窗（`/?screen=bigscreen`）→ 底部 `.bs-ai-bar` 同步顯示。
8. 重做第 4 步，但在倒數中按「① 完整」→ 倒數消失，立即生成一句完整英文廣播。
9. 重做第 4 步，但在倒數中按「③ 延伸」→ 倒數消失，立即生成延伸句廣播。
10. 重做第 4 步，但在倒數中按「● 錄音」→ 倒數消失、transcript 清空、開始新一段。
11. 點學生卡片「老師原話」→ 展開 sourceText。
12. 按 ✕ 清除 → 學生卡片淡出 + 大屏橫條消失。
13. 切換場景 → 倒數取消、上次提示消失、transcript 清空。
14. 講一句太短（如「hi」）→ 不啟動倒數，面板顯示「太短，請再錄一次」。
15. 故意停掉 ollama → 等自動觸發或手動按按鈕 → 看連線錯誤訊息。
16. 用 Firefox 開 HostSession → 看 STT 警示訊息、錄音鈕 disabled。
17. `cd frontend && npx tsc --noEmit` 通過。
