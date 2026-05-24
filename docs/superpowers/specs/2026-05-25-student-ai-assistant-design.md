# 學生 AI 助理（Student AI Assistant）設計

**日期**：2026-05-25
**範圍**：`frontend/`
- 新增：`config/aiAssistant.ts`、`hooks/useSpeechTranscript.ts`、`utils/ollamaClient.ts`
- 修改：`components/HostSession.tsx`、`components/StudentSession.tsx`、`components/BigScreen.tsx`、`App.css`

---

## 目標

在情境對話中，老師可主動觸發 AI 為學生即時生成「回應老師」的英語範例，分三種模式：

1. **完整（complete）** — 一句最簡單、可直接照念的完整英語回答
2. **重組（rearrange）** — 一句完整英語答句但單字順序打亂，學生需重新排序
3. **延伸（extend）** — 較完整的回答，加上修飾語、補充資訊或反問

AI 推論在老師端進行（本地 Ollama），結果同時廣播到所有 StudentSession（學生個人裝置）和 BigScreen（投影大屏）。提示時機完全由老師控制。

---

## 使用者流程

1. 老師在 HostSession 切到「🤖 AI 助理」分頁 → 開啟麥克風開關
2. Web Speech API 開始將老師說話轉文字 → AI 面板即時顯示「最近 30 秒」滾動文字緩衝
3. 老師判斷學生卡住、想給提示 → 按「① 完整」/「② 重組」/「③ 延伸」其中一顆
4. HostSession 把「當前緩衝文字 + 當前 scene 的約束文件 + 模式指令」組成 prompt → fetch Ollama
5. Ollama 回應 → HostSession 同時：
   - 在「最新提示」區顯示給老師看
   - 透過 LiveKit `publishData` 廣播給所有 StudentSession
   - 透過 BroadcastChannel 廣播給 BigScreen
6. StudentSession 個人畫面右上角 overlay 卡片即時顯示提示；BigScreen 底部橫條同步顯示
7. 老師按「✕ 清除」→ 廣播清空訊息 → 學生卡片淡出 / 大屏橫條消失
8. 場景切換 → 自動清空緩衝與提示，新場景才有對應約束文件

---

## 架構

```
┌─────────────────── HostSession（老師端） ───────────────────┐
│  [麥克風] ─► Web Speech API ─► 滾動文字緩衝（最近 N 秒）       │
│                                          │                  │
│  [老師按 ① / ② / ③] ─► buildPrompt(transcript, scene, mode) │
│                                          │                  │
│                                          ▼                  │
│            fetch http://localhost:11434/api/generate         │
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

### STT 層 — `frontend/src/hooks/useSpeechTranscript.ts`（新檔）

```ts
export interface UseSpeechTranscriptResult {
  transcript: string         // 最近 N 秒滾動緩衝
  listening: boolean
  supported: boolean         // 瀏覽器是否支援
  error: string | null
}

/** 預設 30 秒視窗。內部維護 [text, ts][]，每次 result 推入並修剪過期 */
export function useSpeechTranscript(
  enabled: boolean,
  windowSeconds = 30,
): UseSpeechTranscriptResult
```

實作要點：
- 使用 `window.webkitSpeechRecognition`（Chrome / Edge）— `SpeechRecognition` 也加 fallback。
- `recognition.continuous = true; recognition.interimResults = false; recognition.lang = 'en-US'`。
- `onresult` 推入 buffer，並把超過 `windowSeconds` 的句子移除。
- 過濾規則：trim 後 `< 3` 字元或為 filler-only（`uh`, `um`, `ah`）的 transcript 不計入。
- `enabled` 切 OFF → `recognition.stop()` 並清空 buffer。
- `supported = false` 時 transcript 永遠空字串，error 訊息「This browser does not support Web Speech API. Please use Chrome or Edge.」。

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
const [aiEnabled, setAiEnabled] = useState(false)
const [aiBusy, setAiBusy] = useState(false)
const [aiError, setAiError] = useState<string | null>(null)
const [latestHint, setLatestHint] = useState<AIHintPayload | null>(null)
const { transcript, supported: sttSupported, error: sttError } =
  useSpeechTranscript(aiEnabled)
```

新增 callback：

```ts
// currentSceneId 沿用 HostSession 既有的場景 state（與 task-hints 取 currentTask 同一處）
const handleHint = async (mode: AIHintMode) => {
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
  const payload: AIHintPayload = { mode: null, content: null, sourceText: null, ts: Date.now() }
  setLatestHint(null)
  broadcastAIHint(payload)
}
```

`broadcastAIHint` 在既有 BroadcastChannel sync 處抽出（與 `task-change`、`hint-change` 同位置），並另呼叫 LiveKit `publishData`。

**場景切換重置**：在既有監看 `currentSceneId` 的 `useEffect` 中，發現變化 → `setLatestHint(null); handleClear()`。

**UI — `.hs-ai-panel`**：放在 `hs-video-area` 右側，與既有 `.hs-hint-panel` 共用位置，**做成 tab 切換**（任務提示 / AI 助理），避免兩個欄並排佔太寬。

```
┌──── 🤖 AI 助理 ────┐
│ [○ 麥克風]  狀態     │
│ 最近說的話：…        │
│ [①完整][②重組][③延伸] │
│ 最新提示：…          │
│ [✕ 清除學生畫面]     │
└────────────────────┘
```

互動規則：
- 麥克風 OFF / `transcript.length < 3` / scene 無約束文件 → 三顆按鈕 disabled
- `aiBusy` → 三顆按鈕 disabled + spinner
- `aiError` → 紅字訊息（不廣播）
- 切換 tab 不影響後台狀態（STT 持續、訊息持續廣播）

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
- `.hs-ai-transcript`：等寬字、固定高度、上下捲動
- `.hs-ai-mode-btn`：三顆按鈕並排
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
| `useSpeechTranscript` | 封裝 Web Speech API，提供 N 秒滾動 transcript | `(enabled, windowSeconds) => { transcript, listening, supported, error }` | 瀏覽器 `webkitSpeechRecognition` |
| `ollamaClient.ts` | 對 Ollama 發 POST | `generateHint(prompt, signal) => Promise<string>` | fetch |
| HostSession `.hs-ai-panel` | UI + 觸發 + 廣播協調 | `setAiEnabled` / 三顆按鈕 callback / clear | `useSpeechTranscript`、`ollamaClient`、`aiAssistant`、LiveKit room、BroadcastChannel |
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
| 瀏覽器不支援 Web Speech API（如 Firefox） | AI 面板顯示警示 + STT 開關 disabled |
| STT 緩衝為空 / 太短（< 3 字元） | 三顆按鈕 disabled，hover tooltip「請先說一句話」 |
| STT 偵測到 filler-only（uh, um） | 過濾掉，不計入緩衝 |
| 學生中途加入 room | 沒有歷史 AI 提示可看；只接收按下後的廣播 |
| 老師快速連按同一按鈕 | 第二次在 disabled 狀態下無效；解鎖後再按會重新呼叫 AI（允許拿不同變體） |
| AI 回應截斷（達 80 token） | 取已輸出文字直接廣播，不視為錯誤 |
| AI 回應為空 | 視為失敗，紅字「AI 未能生成提示，請重試」 |
| 重組模式回應沒有空格分隔 | 後備：補打一次 complete prompt → 前端 `shuffleWords` |
| 場景切換 | 清空 STT 緩衝 + 最新提示 + 廣播清除訊息 |
| `SCENE_CONSTRAINTS[currentSceneId]` 不存在 | 三顆按鈕 disabled，面板顯示「此場景尚無 AI 助理約束文件」 |
| LiveKit room 斷線 | 老師端 UI 仍顯示「最新提示」但加註「⚠ 學生端未收到」；BroadcastChannel 仍可送 BigScreen |

---

## 不在範圍內（YAGNI）

- 串流 token-by-token UI — 句子短，不需要
- 歷史 AI 提示列表 / 學生回看 — 即時即用
- 自動觸發（偵測老師停頓自動 fire） — 違反「老師主動控制」需求
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
2. 開 HostSession → AI 助理 tab 出現，開麥克風開關。
3. 講一句英文 → 「最近說的話」即時更新。
4. 按「① 完整」→ spinner → 1~3 秒 → 「最新提示」區出現一句英文。
5. 開一個 StudentSession（手機 / 同網段另一瀏覽器）加入同 room → 老師再按按鈕 → 學生 overlay 卡片即時出現。
6. 點學生卡片「老師原話」→ 展開 sourceText。
7. 開 BigScreen 視窗（`/?screen=bigscreen`）→ 底部 `.bs-ai-bar` 同步顯示。
8. 按「② 重組」→ 學生 / 大屏顯示 chip 化亂序單字。
9. 按「③ 延伸」→ 顯示較長的延伸句（可能含追問）。
10. 按 ✕ 清除 → 學生卡片淡出 + 大屏橫條消失。
11. 切換場景 → 上次提示自動消失、緩衝清空。
12. 故意停掉 ollama → 按按鈕看連線錯誤訊息。
13. 用 Firefox 開 HostSession → 看 STT 警示訊息。
14. `cd frontend && npx tsc --noEmit` 通過。
