# Student AI Assistant Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 HostSession 增加「🤖 AI 助理」分頁，讓老師按錄音後 3 秒自動（或手動選模式）觸發 Ollama 生成英語範例，廣播至所有 StudentSession 及 BigScreen。

**Architecture:** HostSession 持有 Web Speech API 錄音狀態機（useSpeechRecording hook）與 3 秒倒數邏輯；生成透過本機 Ollama（qwen2.5:3b）；結果同時走 LiveKit publishData(reliable:true) → StudentSession overlay 和 BroadcastChannel → BigScreen 底部橫條。

**Tech Stack:** React + TypeScript, LiveKit Client, BroadcastChannel, Web Speech API, Ollama REST API (localhost:11434)

---

## Task 1: 新增 config/aiAssistant.ts（型別 + prompt 邏輯）

**Files:**
- Create: `frontend/src/config/aiAssistant.ts`

**Step 1: 建立檔案**

Content of `frontend/src/config/aiAssistant.ts`:

```typescript
export type AIHintMode = 'complete' | 'rearrange' | 'extend'

export interface AIHintPayload {
  mode: AIHintMode | null
  content: string | null
  sourceText: string | null
  ts: number
}

export const SCENE_CONSTRAINTS: Record<string, string> = {
  clothingStore_cashier: `
Setting: A clothing store checkout. The student plays a customer, the teacher plays a shop assistant.
Language: English, everyday shopping conversation.
Grammar: Use simple present tense primarily. Avoid past tense and complex constructions.
Vocabulary: prices (dollars, cost, price), sizes (small, medium, large), colors,
payment methods (cash, card), polite expressions (please, thank you).
Response style: short, conversational, natural — 1 to 2 sentences.
`.trim(),
}

const MODE_INSTRUCTIONS: Record<AIHintMode, string> = {
  complete:
    'Output ONE simple, complete English sentence that the student can read aloud directly. Example: "It is 200 dollars."',
  rearrange:
    'Output ONE complete English sentence answer, but shuffle the word order. Separate words with single spaces. The student will reorder them. Example: "dollars It 200 is"',
  extend:
    'Output ONE more complete English sentence with additional details, modifiers, or a follow-up question. Example: "It is 200 dollars, but we have a 10% discount today. Would you like to try it on?"',
}

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

export function shuffleWords(sentence: string): string {
  const words = sentence.split(' ').filter(w => w.length > 0)
  for (let i = words.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [words[i], words[j]] = [words[j], words[i]]
  }
  return words.join(' ')
}
```

**Step 2: TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

**Step 3: Commit**

```bash
git add frontend/src/config/aiAssistant.ts
git commit -m "feat: add aiAssistant config (types, SCENE_CONSTRAINTS, buildPrompt, shuffleWords)"
```

---

## Task 2: 新增 hooks/useSpeechRecording.ts

**Files:**
- Create: `frontend/src/hooks/useSpeechRecording.ts`

**Step 1: 建立 hook**

Content of `frontend/src/hooks/useSpeechRecording.ts`:

```typescript
import { useRef, useState, useCallback, useEffect } from 'react'

export interface UseSpeechRecordingResult {
  recording: boolean
  interim: string
  transcript: string
  supported: boolean
  error: string | null
  start: () => void
  stop: () => void
  clear: () => void
}

const FILLER_ONLY_RE = /^(uh+|um+|ah+|er+|hmm+|\s)+$/i

function isTooShortOrFiller(text: string): boolean {
  const t = text.trim()
  return t.length < 3 || FILLER_ONLY_RE.test(t)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySpeechRecognition = any

export function useSpeechRecording(): UseSpeechRecordingResult {
  const SpeechRecognitionCtor =
    (typeof window !== 'undefined' &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition))
    || null

  const supported = SpeechRecognitionCtor !== null

  const [recording, setRecording] = useState(false)
  const [interim, setInterim] = useState('')
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)

  const recogRef = useRef<AnySpeechRecognition>(null)
  const finalBufferRef = useRef('')

  const stop = useCallback(() => {
    recogRef.current?.stop()
  }, [])

  const start = useCallback(() => {
    if (!SpeechRecognitionCtor) return
    if (recogRef.current) {
      try { recogRef.current.abort() } catch { /* ignore */ }
    }
    setInterim('')
    setTranscript('')
    setError(null)
    finalBufferRef.current = ''

    const recog = new SpeechRecognitionCtor()
    recog.continuous = true
    recog.interimResults = true
    recog.lang = 'en-US'

    recog.onresult = (e: AnySpeechRecognition) => {
      let interimText = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]
        if (result.isFinal) {
          finalBufferRef.current += result[0].transcript
        } else {
          interimText += result[0].transcript
        }
      }
      setInterim(interimText)
    }

    recog.onerror = (e: AnySpeechRecognition) => {
      if (e.error === 'aborted' || e.error === 'no-speech') return
      setError(`STT error: ${e.error ?? 'unknown'}`)
    }

    recog.onend = () => {
      const final = finalBufferRef.current.trim()
      setTranscript(isTooShortOrFiller(final) ? '' : final)
      setInterim('')
      setRecording(false)
      finalBufferRef.current = ''
    }

    recogRef.current = recog
    recog.start()
    setRecording(true)
  }, [SpeechRecognitionCtor])

  const clear = useCallback(() => {
    setTranscript('')
    setInterim('')
    finalBufferRef.current = ''
  }, [])

  useEffect(() => {
    return () => {
      try { recogRef.current?.abort() } catch { /* ignore */ }
    }
  }, [])

  if (!supported) {
    return {
      recording: false, interim: '', transcript: '', supported: false,
      error: null, start: () => {}, stop: () => {}, clear: () => {},
    }
  }

  return { recording, interim, transcript, supported, error, start, stop, clear }
}
```

**Step 2: TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```

**Step 3: Commit**

```bash
git add frontend/src/hooks/useSpeechRecording.ts
git commit -m "feat: add useSpeechRecording hook (Web Speech API push-to-talk)"
```

---

## Task 3: 新增 utils/ollamaClient.ts

**Files:**
- Create: `frontend/src/utils/ollamaClient.ts`

**Step 1: 建立 client**

Content of `frontend/src/utils/ollamaClient.ts`:

```typescript
const OLLAMA_URL = 'http://localhost:11434/api/generate'
const MODEL = 'qwen2.5:3b'
const TIMEOUT_MS = 10_000

export function toFriendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ECONNREFUSED')) {
    return '無法連線 Ollama，請確認本機已啟動 `ollama serve`'
  }
  if (msg.includes('404')) {
    return `模型 ${MODEL} 未安裝，請執行 \`ollama pull ${MODEL}\``
  }
  if (msg.includes('AbortError') || msg.includes('aborted')) {
    return 'AI 回應逾時，請重試'
  }
  if (msg.includes('Empty response')) {
    return 'AI 未能生成提示，請重試'
  }
  return `AI 生成失敗：${msg}`
}

export async function generateHint(
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
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

**Step 2: TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```

**Step 3: Commit**

```bash
git add frontend/src/utils/ollamaClient.ts
git commit -m "feat: add ollamaClient (generateHint + toFriendlyError)"
```

---

## Task 4: 修改 BigScreen.tsx (ai-hint 訊息 + bs-ai-bar)

**Files:**
- Modify: `frontend/src/components/BigScreen.tsx`

**Changes:**

A) In the `BigScreenMsg` interface (line ~19), add `'ai-hint'` to the type union and a new `aiHint` field:
```typescript
type: '...' | 'hint-change' | 'ai-hint';
aiHint?: import('../config/aiAssistant').AIHintPayload;
```

B) In the BigScreen() component state section (after hintLevel state, ~line 176), add:
```typescript
const [aiHint, setAiHint] = useState<import('../config/aiAssistant').AIHintPayload | null>(null)
```

C) In the overlayVersionRef effect deps array (line ~218), add `aiHint`.

D) In the BroadcastChannel `channel.onmessage` handler (after the `recording-stop` case, ~line 1500), add:
```typescript
} else if (msg.type === 'ai-hint') {
  const payload = msg.aiHint ?? null
  setAiHint(payload?.content ? payload : null)
}
```

E) In the BigScreen JSX, after the bigscreen-tasks-container closing tag (~line 1693) and before the settlement overlay, add:
```tsx
{aiHint && aiHint.content && (
  <div className={`bs-ai-bar ai-mode--${aiHint.mode}`}>
    <span className="bs-ai-bar-icon">🤖</span>
    <span className={`bs-ai-bar-mode-tag ai-mode--${aiHint.mode}`}>
      {aiHint.mode === 'complete' ? '完整' : aiHint.mode === 'rearrange' ? '重組' : '延伸'}
    </span>
    <span className="bs-ai-bar-content">
      {aiHint.mode === 'rearrange'
        ? aiHint.content.split(' ').map((w, i) => (
            <span key={i} className="ai-chip">{w}</span>
          ))
        : aiHint.content}
    </span>
  </div>
)}
```

**Step 1: Apply changes**

**Step 2: TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -50
```

**Step 3: Commit**

```bash
git add frontend/src/components/BigScreen.tsx
git commit -m "feat(BigScreen): add ai-hint message type + bs-ai-bar UI"
```

---

## Task 5: 修改 StudentSession.tsx (AI 提示 overlay)

**Files:**
- Modify: `frontend/src/components/StudentSession.tsx`

**Changes:**

A) Add import at the top:
```typescript
import type { AIHintPayload } from '../config/aiAssistant'
```

B) Add state after existing state declarations:
```typescript
const [aiHint, setAiHint] = useState<AIHintPayload | null>(null)
const [showSource, setShowSource] = useState(false)
```

C) Add DataReceived listener inside the LiveKit `useEffect` (after the `room.on(RoomEvent.Disconnected, ...)` block, before the `connectPromise`):
```typescript
room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant) => {
  if (!participant?.identity.startsWith('host-')) return
  try {
    const msg = JSON.parse(new TextDecoder().decode(payload)) as { type: string; payload?: AIHintPayload }
    if (msg.type === 'ai-hint') {
      setAiHint(msg.payload?.content ? (msg.payload ?? null) : null)
    }
  } catch { /* pose / other messages */ }
})
```
Also add to the cleanup: `room.off(RoomEvent.DataReceived, ...)` (use the same pattern as other `.off` calls in StudentSession - since there's no named handler, inline DataReceived may need to be extracted to a named variable first).

D) Add the AI card JSX before the closing `</div>` of `student-session-container`:
```tsx
{aiHint && aiHint.content && (
  <div className="ss-ai-card">
    <div className={`ss-ai-card-header ai-mode--${aiHint.mode}`}>
      <span className="ss-ai-card-icon">🤖</span>
      <span className="ss-ai-card-title">老師提示</span>
      <span className={`ss-ai-mode-badge ai-mode--${aiHint.mode}`}>
        {aiHint.mode === 'complete' ? '完整' : aiHint.mode === 'rearrange' ? '重組' : '延伸'}
      </span>
      <button className="ss-ai-card-close" onClick={() => setAiHint(null)}>✕</button>
    </div>
    <div className="ss-ai-card-body">
      {aiHint.mode === 'rearrange'
        ? <div className="ss-ai-chips">{aiHint.content.split(' ').map((w, i) => <span key={i} className="ai-chip">{w}</span>)}</div>
        : <div className="ss-ai-content">{aiHint.content}</div>
      }
    </div>
    {aiHint.sourceText && (
      <div className="ss-ai-source">
        <button className="ss-ai-source-toggle" onClick={() => setShowSource(v => !v)}>
          {showSource ? '▴' : '▾'} 老師原話
        </button>
        {showSource && <div className="ss-ai-source-text">"{aiHint.sourceText}"</div>}
      </div>
    )}
  </div>
)}
```

**Step 1: Apply changes**

**Step 2: TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -50
```

**Step 3: Commit**

```bash
git add frontend/src/components/StudentSession.tsx
git commit -m "feat(StudentSession): add ai-hint LiveKit listener + ss-ai-card overlay"
```

---

## Task 6: 修改 HostSession.tsx (AI 助理 tab + 狀態機 + 廣播)

**Files:**
- Modify: `frontend/src/components/HostSession.tsx`

**Changes:**

A) Add imports (after existing imports):
```typescript
import { SCENE_CONSTRAINTS, buildPrompt, shuffleWords } from '../config/aiAssistant.ts'
import type { AIHintMode, AIHintPayload } from '../config/aiAssistant.ts'
import { generateHint, toFriendlyError } from '../utils/ollamaClient.ts'
import { useSpeechRecording } from '../hooks/useSpeechRecording.ts'
```

B) Add tab state in state declaration area:
```typescript
const [rightPanelTab, setRightPanelTab] = useState<'task-hints' | 'ai-assistant'>('task-hints')
```

C) Add all AI state + callbacks + effects after `toggleHintEnabled` (see plan body for full code block).

D) In the JSX render, find the existing `{hintEnabled && (() => { ... })()}` block (~lines 1432-1498) that renders `.hs-hint-panel`, and replace the entire `<div className="hs-hint-panel">` block with the tabbed `.hs-right-panel` wrapper that contains both the task-hints tab and the ai-assistant tab.

Key: the `.hs-right-panel` div wraps both tabs; show/hide each tab's content based on `rightPanelTab` state. The existing hint panel logic is preserved unchanged inside the task-hints tab.

**Important details:**
- `broadcastAIHint` sends to both `channelRef.current` (BroadcastChannel→BigScreen) and `roomRef.current` (LiveKit→students).
- The 3-second countdown effect depends ONLY on `[sttTranscript]` to prevent re-triggering.
- `handleHintRef` is used inside the `setTimeout` closure to avoid stale closure issues.
- Scene change effect: `cancelAutoCountdown(); clearTranscript(); setLatestHint(null); broadcastAIHint({mode:null,...})`.

**Step 1: Apply changes**

**Step 2: TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -50
```

**Step 3: Commit**

```bash
git add frontend/src/components/HostSession.tsx
git commit -m "feat(HostSession): add AI assistant tab with STT, countdown, Ollama broadcast"
```

---

## Task 7: 修改 App.css (AI 助理樣式)

**Files:**
- Modify: `frontend/src/App.css`

Append the following CSS sections to the end of `frontend/src/App.css`:

1. Shared mode colors (`.ai-mode--complete/rearrange/extend`, `.ai-chip`)
2. Right panel tabs (`.hs-right-panel`, `.hs-right-panel-tabs`, `.hs-right-tab`)
3. AI panel (`.hs-ai-panel`, `.hs-ai-record-btn` with pulse animation, `.hs-ai-transcript`, `.hs-ai-countdown` with progress bar, `.hs-ai-mode-btn`, `.hs-ai-busy`, `.hs-ai-error`, `.hs-ai-latest`, `.hs-ai-clear-btn`)
4. StudentSession overlay (`.ss-ai-card` with slide-in animation, `.ss-ai-card-header`, `.ss-ai-mode-badge`, `.ss-ai-card-body`, `.ss-ai-chips`, `.ss-ai-source`, `.ss-ai-source-text`)
5. BigScreen bar (`.bs-ai-bar` with slide-up animation, `.bs-ai-bar-icon`, `.bs-ai-bar-mode-tag`, `.bs-ai-bar-content`)

Color scheme:
- complete = green (#4caf50)
- rearrange = orange (#ff9800)
- extend = blue (#2196f3)

**Step 1: Append CSS to App.css**

**Step 2: Dev server check**

```bash
cd frontend && npm run dev
```

Visually confirm no layout breakage.

**Step 3: Commit**

```bash
git add frontend/src/App.css
git commit -m "feat: add AI assistant CSS (mode colors, record btn, countdown, ss-ai-card, bs-ai-bar)"
```

---

## Task 8: Final TypeScript Verification

**Step 1:**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 0 errors.

**Step 2: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve TypeScript errors from AI assistant integration"
```

---

## Verification Checklist

1. `ollama pull qwen2.5:3b && ollama serve` → `curl http://localhost:11434/api/tags` 確認可連
2. HostSession → AI 助理 tab 出現
3. 按「● 錄音」→ 紅色脈動 + 即時 interim 文字
4. 說英文後按「■ 停止」→ transcript 凍結 + 3 秒倒數出現
5. 等 3 秒 → rearrange chip 提示自動出現
6. StudentSession 加入 → 學生 overlay 卡片即時出現
7. BigScreen → bs-ai-bar 底部橫條同步顯示
8. 倒數中按「① 完整」→ 倒數消失、生成完整句
9. 倒數中按「③ 延伸」→ 生成延伸句
10. 倒數中按「● 錄音」→ 倒數消失、清空 transcript
11. 學生卡片「老師原話」→ 展開 sourceText
12. 按「✕ 清除學生畫面」→ 卡片消失、大屏橫條消失
13. 切換場景 → 倒數取消、提示清空
14. 講太短（如「hi」）→ 不啟動倒數、按鈕 disabled
15. 停掉 ollama → 看連線錯誤訊息
16. Firefox → STT 警示 + 錄音鈕 disabled
17. `npx tsc --noEmit` 通過
