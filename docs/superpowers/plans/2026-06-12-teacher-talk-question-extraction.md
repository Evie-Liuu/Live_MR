# 老師長話主問句抽取 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 AI 從一段較長的老師談話 transcript 中抽出最關鍵、針對學生的那一句提問，並針對該句產生學生回應；開發階段以 `Teacher_chat_test.mp3` 為老師段落測試。

**Architecture:** 沿用現有「老師說話 → 麥克風 STT → 按換學生 → `/api/ai/hints` → 學生 hint card」流程，不改觸發模型。唯一新增能力是 Gemini 單次呼叫多回一個 `question` 欄位（抽出的主問句），前端用它做 chat history / BigScreen 氣泡 / dev 顯示。另加一顆 dev-only 測試音檔播放鈕。

**Tech Stack:** TypeScript、Express 5（backend）、React + Vite（frontend）、`@google/genai`（Gemini）、vitest（前後端皆有）。

設計來源：`docs/superpowers/specs/2026-06-12-teacher-talk-question-extraction-design.md`

---

## 檔案結構

會修改 / 新增的檔案與職責：

- `backend/src/ai.ts`（修改）— `generateHints` 的 `responseSchema` 與解析增加 `question`；`HintsResult` 增 `question`。
- `backend/src/ai.test.ts`（新增）— mock `@google/genai`，驗證 `generateHints` 解析出 `question`。
- `backend/src/routes.ts`（修改）— `/api/ai/hints` 回應帶 `question`。
- `frontend/src/utils/geminiClient.ts`（修改）— `HintsResult` 增 `question`，讀取 `data.question`。
- `frontend/src/config/aiAssistant.ts`（修改）— `buildHintsSystemInstruction` 加入抽取指令與 `question` JSON 欄位。
- `frontend/src/config/aiAssistant.test.ts`（新增）— 驗證 system instruction 含抽取指令與 `question` 欄位。
- `frontend/src/components/HostSession.tsx`（修改）— `handleHint` 冷路徑串接 `question`（chat history user turn、sourceText、console.log、dev hint card 小字）；新增 dev-only 測試音檔播放鈕。

> 註：`generateHints` 走真實 Gemini API，前端 glue（geminiClient / HostSession）無既有 mock 測試基礎；依設計文件，前端 glue 與 UI 以 `tsc -b --noEmit` + `eslint` + 手動驗證為閘門，僅對純函式（後端解析、system instruction 建構）寫自動化單元測試。

---

### Task 1: 後端 `generateHints` 回傳 `question`

**Files:**
- Modify: `backend/src/ai.ts`（`HintsResult` 介面約 48-52 行；`generateHints` 約 54-116 行）
- Test: `backend/src/ai.test.ts`（新增）

- [ ] **Step 1: 寫失敗測試**

新增 `backend/src/ai.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const generateContentMock = vi.fn()

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContent: generateContentMock },
  })),
}))

describe('generateHints', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.GEMINI_API_KEY = 'test-key'
    generateContentMock.mockReset()
  })

  it('parses the question field from the model JSON', async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({
        question: 'How much is this blue shirt?',
        complete: 'It is 200 dollars.',
        extend: 'Would you like to try it on?',
      }),
    })
    const { generateHints } = await import('./ai.js')
    const result = await generateHints('teacher long monologue ...')
    expect(result.question).toBe('How much is this blue shirt?')
    expect(result.complete).toBe('It is 200 dollars.')
    expect(result.extend).toBe('Would you like to try it on?')
  })

  it('defaults question to empty string when model returns non-JSON', async () => {
    generateContentMock.mockResolvedValue({ text: 'It is 200 dollars.' })
    const { generateHints } = await import('./ai.js')
    const result = await generateHints('teacher long monologue ...')
    expect(result.question).toBe('')
    expect(result.complete).toBe('It is 200 dollars.')
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd backend && npx vitest run src/ai.test.ts`
Expected: FAIL — `result.question` 為 `undefined`（`HintsResult` 尚無 `question`）。

- [ ] **Step 3: 實作 — `HintsResult` 增 `question`**

`backend/src/ai.ts`，把介面（約 48-52 行）改為：

```ts
export interface HintsResult {
  question: string
  complete: string
  extend: string
  model: string
}
```

- [ ] **Step 4: 實作 — schema 與解析增加 `question`**

`backend/src/ai.ts` `generateHints` 內，`responseSchema`（約 79-86 行）改為：

```ts
          responseSchema: {
            type: 'OBJECT',
            properties: {
              question: { type: 'STRING' },
              complete: { type: 'STRING' },
              extend: { type: 'STRING' },
            },
            required: ['question', 'complete', 'extend'],
          },
```

解析區塊（約 98-104 行）改為：

```ts
        let parsed: { question?: unknown; complete?: unknown; extend?: unknown }
        try { parsed = JSON.parse(raw) }
        catch { parsed = { question: '', complete: raw, extend: '' } } // fallback: 純文字視為 complete
        const question = typeof parsed.question === 'string' ? parsed.question.trim() : ''
        const complete = typeof parsed.complete === 'string' ? parsed.complete.trim() : ''
        const extend = typeof parsed.extend === 'string' ? parsed.extend.trim() : ''
        if (!complete) throw new Error('Empty complete field')
        return { question, complete, extend, model }
```

- [ ] **Step 5: 跑測試確認通過**

Run: `cd backend && npx vitest run src/ai.test.ts`
Expected: PASS（2 個測試）。

- [ ] **Step 6: Commit**

```bash
git add backend/src/ai.ts backend/src/ai.test.ts
git commit -m "feat(ai): generateHints 多回傳抽取的 question 欄位"
```

---

### Task 2: 路由 `/api/ai/hints` 回傳 `question`

**Files:**
- Modify: `backend/src/routes.ts:504-510`

- [ ] **Step 1: 實作**

`backend/src/routes.ts` 的 hints 路由（約 504-510 行）改為：

```ts
      const { question, complete, extend, model } = await generateAIHints(prompt, {
        history: safeHistory && safeHistory.length > 0 ? safeHistory : undefined,
        systemInstruction: typeof systemInstruction === 'string' && systemInstruction.trim()
          ? systemInstruction
          : undefined,
      })
      res.json({ question, complete, extend, model })
```

- [ ] **Step 2: 型別檢查**

Run: `cd backend && npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 3: 跑既有後端測試確認無回歸**

Run: `cd backend && npx vitest run`
Expected: 全部 PASS（含 Task 1 新增測試）。

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes.ts
git commit -m "feat(api): /ai/hints 回應帶 question 欄位"
```

---

### Task 3: 前端 `geminiClient.generateHints` 帶 `question`

**Files:**
- Modify: `frontend/src/utils/geminiClient.ts`（`HintsResult` 約 89-93 行；`generateHints` 約 97-129 行）

- [ ] **Step 1: 實作 — `HintsResult` 增 `question`**

`frontend/src/utils/geminiClient.ts`（約 89-93 行）：

```ts
export interface HintsResult {
  question: string
  complete: string
  extend: string
  model: string
}
```

- [ ] **Step 2: 實作 — 讀取 `data.question`**

同檔 `generateHints` 內解析回應處（約 118-126 行）改為：

```ts
    const data = await res.json() as { question?: string; complete?: string; extend?: string; model?: string }
    const complete = (data.complete ?? '').trim()
    if (!complete) throw new Error('Empty response')
    return {
      question: (data.question ?? '').trim(),
      complete,
      extend: (data.extend ?? '').trim(),
      model: data.model ?? 'unknown',
    }
```

- [ ] **Step 3: 型別檢查**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: 無錯誤（HostSession 尚未使用 `question`，僅型別擴充，相容）。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/utils/geminiClient.ts
git commit -m "feat(ai-client): HintsResult 帶 question 欄位"
```

---

### Task 4: system instruction 加入主問句抽取

**Files:**
- Modify: `frontend/src/config/aiAssistant.ts`（`buildHintsSystemInstruction` 約 128-147 行）
- Test: `frontend/src/config/aiAssistant.test.ts`（新增）

- [ ] **Step 1: 寫失敗測試**

新增 `frontend/src/config/aiAssistant.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { buildHintsSystemInstruction } from './aiAssistant'

describe('buildHintsSystemInstruction', () => {
  const constraint = 'Setting: A clothing store checkout.'

  it('instructs the model to extract the single student-directed question', () => {
    const out = buildHintsSystemInstruction(constraint)
    expect(out).toContain(constraint)
    // 過濾長獨白、鎖定單一針對學生的提問
    expect(out.toLowerCase()).toContain('monologue')
    expect(out.toLowerCase()).toContain('question')
  })

  it('asks for a JSON object with question, complete and extend fields', () => {
    const out = buildHintsSystemInstruction(constraint)
    expect(out).toContain('"question"')
    expect(out).toContain('"complete"')
    expect(out).toContain('"extend"')
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd frontend && npx vitest run src/config/aiAssistant.test.ts`
Expected: FAIL — 目前輸出不含 `monologue` 與 `"question"`。

- [ ] **Step 3: 實作**

`frontend/src/config/aiAssistant.ts` 的 `buildHintsSystemInstruction`（約 128-147 行）整段 return 改為：

```ts
  return `You are an English conversation teaching assistant. The student is learning conversation in the following setting:

${sceneConstraint}

The user messages in this conversation will contain things the TEACHER says. A single user turn may be a LONG teacher monologue mixing greetings, classroom instructions, asides, and several sentences. Before answering, SILENTLY identify the ONE sentence in that turn that is a question DIRECTED AT THE STUDENT and that the student is expected to answer. Base the student's reply on that one question and ignore the rest. If the turn contains no explicit question, pick the single sentence most directed at the student.

Maintain continuity with earlier turns — if you already invented specific values (price, size, color, brand, stock), reuse them consistently and let the story progress naturally.

IMPORTANT — Handling missing information:
If the teacher refers to details that have NOT been provided, INVENT a reasonable, realistic value and commit to it. Never produce a vague answer like "It is." Always commit to a concrete value (a specific dollar amount, a specific size, etc.).${focusBlock}

Output a JSON object with exactly three string fields:
  - "question": the ONE teacher sentence you identified as the question directed at the student, copied as the teacher actually said it (English). If there was no explicit question, the sentence most directed at the student.
  - "complete": ONE grammatically complete English sentence the student can say in reply to "question". Simple present tense, everyday spoken English. No ellipsis, no Chinese, no preamble.
  - "extend":   ONE additional sentence the student can say RIGHT AFTER "complete" — a polite follow-up question, an extra relevant detail, or a natural conversational expansion. Same tone and vocabulary level as "complete".

Do not output anything outside the JSON object. Do not wrap it in markdown.`
```

（`focusBlock` 變數沿用函式上方既有的 `const focusBlock = taskContext ? buildTaskFocusBlock(taskContext) : ''`，不動。）

- [ ] **Step 4: 跑測試確認通過**

Run: `cd frontend && npx vitest run src/config/aiAssistant.test.ts`
Expected: PASS（2 個測試）。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/config/aiAssistant.ts frontend/src/config/aiAssistant.test.ts
git commit -m "feat(ai): 系統指令從長獨白抽取主問句並回 question 欄位"
```

---

### Task 5: HostSession 冷路徑串接 `question`

**Files:**
- Modify: `frontend/src/components/HostSession.tsx`（`handleHint` 冷路徑約 749-771 行）

- [ ] **Step 1: 實作 — 取 question、log、chat history user turn 改記抽取句、sourceText 用抽取句**

`frontend/src/components/HostSession.tsx`，`handleHint` 冷路徑中 `generateHints` 之後（約 749-771 行）改為：

```ts
      const result = await generateHints(txt, { history, systemInstruction });
      setAiModel(result.model);
      // 開發驗證：印出 AI 從長獨白抽取的主問句。
      console.log('[hint] extracted question:', result.question);
      // BigScreen 氣泡 / 後續 sourceText 顯示「老師實際問的那句」而非整段長獨白。
      const sourceText = result.question || txt;
      const cached: CachedReplies = {
        complete: result.complete,
        rearrange: shuffleWords(result.complete),
        extend: result.extend || result.complete,
      };
      cachedRepliesRef.current = cached;
      cachedSourceTextRef.current = sourceText;
      // chat history 的 user turn 記「抽取問句」(question 空則 fallback 原長 txt)，
      // 讓多輪續寫上下文乾淨、token 更省。
      chatHistoryRef.current = [
        ...history,
        { role: 'user' as const, text: result.question || txt },
        { role: 'model' as const, text: result.complete },
      ].slice(-MAX_CHAT_TURNS);
      const content = mode === 'complete' ? cached.complete
        : mode === 'extend' ? cached.extend
          : cached.rearrange;
      const payload: AIHintPayload = { mode, content, sourceText, ts: Date.now() };
      setLatestHint(payload);
      broadcastAIHint(payload);
```

- [ ] **Step 2: 暫存抽取問句供 dev UI 使用（Task 6 會用到）**

在 `handleHint` 同檔元件頂層 state 區（與 `cachedRepliesRef` 等相鄰，約 302 行附近）新增 state：

```ts
  const [detectedQuestion, setDetectedQuestion] = useState<string>('');
```

並在 Step 1 的 `console.log` 之後加一行：

```ts
      setDetectedQuestion(result.question || '');
```

- [ ] **Step 3: 型別檢查**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: 無錯誤。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/HostSession.tsx
git commit -m "feat(host): handleHint 串接抽取問句 (history/sourceText/log/state)"
```

---

### Task 6: HostSession dev hint card「偵測問句」小字

**Files:**
- Modify: `frontend/src/components/HostSession.tsx`（AI panel hint 顯示區）

- [ ] **Step 1: 找到 hint card 顯示區**

Run: `cd frontend && npx vite --version >/dev/null 2>&1; grep -n "latestHint\|hs-ai-hint\|hint-card" src/components/HostSession.tsx | head -20`
Expected: 列出顯示 `latestHint` 的 JSX 區塊（教師端 AI panel 內 hint 卡）。確認插入點：顯示 hint 內容之後、卡片容器內。

- [ ] **Step 2: 實作 — 插入 dev 小字**

在 hint 內容顯示節點之後，加入只在開發模式且有抽取句時顯示的一行（沿用該處既有卡片容器；className 可沿用既有 dev/debug 風格，無則用內聯樣式）：

```tsx
{import.meta.env.DEV && detectedQuestion && (
  <div className="hs-ai-detected-question" style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>
    偵測問句：{detectedQuestion}
  </div>
)}
```

- [ ] **Step 3: 型別檢查 + lint**

Run: `cd frontend && npx tsc -b --noEmit && npx eslint src/components/HostSession.tsx`
Expected: 無錯誤、lint 無新增警告。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/HostSession.tsx
git commit -m "feat(host): dev 模式 hint card 顯示偵測問句"
```

---

### Task 7: HostSession dev-only 測試音檔播放鈕

**Files:**
- Modify: `frontend/src/components/HostSession.tsx`（AI panel 按鈕區）

- [ ] **Step 1: 新增播放 ref 與 toggle handler**

在 HostSession 元件頂層（refs 區附近）新增：

```ts
  const testAudioRef = useRef<HTMLAudioElement | null>(null);
  const handleToggleTestAudio = useCallback(() => {
    let el = testAudioRef.current;
    if (!el) {
      el = new Audio('/voice/Teacher_chat_test.mp3');
      el.onended = () => { /* 自然播畢，保留 ref 供重播 */ };
      testAudioRef.current = el;
    }
    if (el.paused) {
      el.currentTime = 0;
      void el.play();
    } else {
      el.pause();
    }
  }, []);
```

- [ ] **Step 2: 在 AI panel idle 區加入 dev-only 按鈕**

在 AI panel 內（例如「開始互動」按鈕附近，約 2360 行 `interactionPhase === 'idle'` 區塊旁）加入：

```tsx
{import.meta.env.DEV && (
  <button
    type="button"
    className="hs-ai-test-audio-btn"
    onClick={handleToggleTestAudio}
    style={{ fontSize: 12 }}
  >
    ▶ 測試音檔
  </button>
)}
```

- [ ] **Step 3: unmount 清理（避免音檔殘留播放）**

在元件既有的 unmount cleanup useEffect 內（或新增一個）加入：

```ts
  useEffect(() => () => {
    try { testAudioRef.current?.pause(); } catch { /* ignore */ }
    testAudioRef.current = null;
  }, []);
```

- [ ] **Step 4: 型別檢查 + lint**

Run: `cd frontend && npx tsc -b --noEmit && npx eslint src/components/HostSession.tsx`
Expected: 無錯誤、lint 無新增警告。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/HostSession.tsx
git commit -m "feat(host): dev-only 測試音檔播放鈕"
```

---

### Task 8: 整合驗證（tsc + lint + 手動）

**Files:** 無（驗證任務）

- [ ] **Step 1: 後端型別 + 測試**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: 型別無錯；測試全 PASS。

- [ ] **Step 2: 前端型別 + 測試 + lint**

Run: `cd frontend && npx tsc -b --noEmit && npx vitest run && npx eslint .`
Expected: 型別無錯；測試全 PASS；lint 維持 baseline（無新增錯誤）。

- [ ] **Step 3: 手動驗證（需 GEMINI_API_KEY 已設定、前後端 dev 啟動）**

依序確認：
1. 開發模式 host 畫面 AI panel 出現「▶ 測試音檔」鈕。
2. 按「▶ 測試音檔」播 `Teacher_chat_test.mp3`，同時按「開始互動」由麥克風收音。
3. 音檔播完／按「換學生」→ 瀏覽器 console 出現 `[hint] extracted question:` 為其中一句提問。
4. hint card 下方出現「偵測問句：…」小字；學生 hint card 是針對該問句的回應。
5. BigScreen 機器人氣泡顯示該問句（非整段長獨白）。
6. 連跑兩輪 → 第二輪行為延續（價格/商品等一致），且 history 帶的是抽取問句。
7. 播一段沒有提問的內容 → 仍回一個合理 `complete`，不崩潰、卡片不空白。

- [ ] **Step 4: 最終提交（若手動驗證有微調）**

```bash
git add -A
git commit -m "chore: 老師長話主問句抽取整合驗證調整"
```

---

## Self-Review 紀錄

- **Spec coverage：** 設計文件 6 個改動點 → Task 1-2（後端 ai/routes）、Task 3（geminiClient）、Task 4（system instruction）、Task 5（handleHint 串接：history/sourceText/log）、Task 6（dev 偵測問句小字，spec 正式需求）、Task 7（dev 測試音檔鈕）。測試計畫 → Task 8。皆有對應。
- **型別一致：** `HintsResult` 在 ai.ts(Task 1)、geminiClient.ts(Task 3) 皆為 `{ question, complete, extend, model }`；`result.question` 在 HostSession(Task 5) 與 `detectedQuestion` state(Task 5/6) 一致使用。
- **無 placeholder：** 各 code step 均含實際程式碼與確切指令。
- **既有行為相容：** `responseSchema` 加 `question` 為新欄位；fallback 路徑與 `question` 缺漏皆設空字串並 fallback 原 `txt`，不破壞舊行為。
