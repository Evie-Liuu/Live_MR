# AI 老師備課模組 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 老師登入後可在「備課」畫面選場景、輸入主題與 CEFR 等級，一鍵生成 15 分鐘微教案（學習目標、逐字腳本、語法說明、教學注意點）與課堂可直接執行的任務包，存進本機 SQLite，並在開始上課時帶進 HostSession。

**Architecture:** 後端把 `ai.ts` 拆成 `ai/client.ts`（唯一碰 `@google/genai` 的地方）、`ai/hints.ts`（現有提示流）、`ai/lessonPlan.ts`（兩步結構化 workflow，不是 Agent 迴圈）。新增 `db/`（`node:sqlite` + 版本化 migration + repository）與 `lessonPlanRoutes.ts`。前端新增 `teacher-home` / `lesson-prep` 畫面，`config/content.ts` 讓 HostSession 與 BigScreen「先查教案、再查靜態設定」。

**Tech Stack:** Node 22.18（`node:sqlite`）、Express 5、`@google/genai` 2.x、Vitest + supertest（後端）、React 19 + Vite + Vitest/jsdom（前端，只測純函式）。

**Spec:** `docs/superpowers/specs/2026-09-03-ai-lesson-prep-design.md`

## Global Constraints

- 後端 ESM，`import` 路徑一律帶 `.js` 副檔名（例：`./ai/client.js`）；前端 import 帶 `.ts` / `.tsx`。
- 只有 `backend/src/ai/client.ts` 可以 `import { GoogleGenAI } from '@google/genai'`。
- CEFR 等級固定 `'A1' | 'A2' | 'B1'`；`durationMin` 固定 `15`。
- 任務 id 一律 `plan_{planId}_{n}`（n 從 1 起跨模組連號）；模組 id `plan_{planId}_m{k}`（k 從 1 起）。
- 教案語言：`objectives` / `phase` / `activity` / `grammarNotes.explanation` / `teachingNotes` 用繁體中文；`teacherScript` / 任務 label / TaskHint / `sceneConstraint` 用英文。
- 生成端點總逾時 90 秒；任一子步驟失敗即整體失敗，不儲存半成品。
- 刪除教案用 `POST /api/lesson-plans/:id/delete`（方法白名單沒有 DELETE）。
- 後端信任前端送的 `teacherUid`，不驗 token。
- 前端測試只測純函式，不引入 Testing Library。
- Commit 訊息不加 `Co-Authored-By`。
- 後端測試慣例：`vi.mock('@google/genai')` + `beforeEach(vi.resetModules)` + 動態 `await import(...)`。
- 跑會連外的 Node 腳本要加 `NODE_OPTIONS=--use-system-ca`（這台機器有 Avast TLS 攔截）。

## File Structure

**後端（`backend/src`）**

| 檔案 | 責任 |
|------|------|
| `ai/client.ts`（新） | `callGemini<T>()`：模型 fallback、逾時、可重試判斷、responseSchema、usage、`parse` hook |
| `ai/hints.ts`（新，取代 `ai.ts`） | `generateHint` / `generateHints`，介面不變 |
| `ai/hints.test.ts`（搬自 `ai.test.ts`） | 既有測試，只改 import 路徑 |
| `ai/lessonPlanPrompts.ts`（新） | 四個 responseSchema 與 prompt builder、CEFR 指引 |
| `ai/lessonPlan.ts`（新） | `generateLessonPlan()` workflow、驗證、id 指派 |
| `lessonPlanTypes.ts`（新） | 教案相關型別（後端版） |
| `db/migrations.ts`（新） | SQL 字串陣列 |
| `db/connection.ts`（新） | `openDatabase()` / `migrate()` |
| `db/lessonPlanRepo.ts`（新） | `LessonPlanRepo` 增刪改查 |
| `lessonPlanRoutes.ts`（新） | `createLessonPlanRouter()` |
| `routes.ts`（改） | import 改 `./ai/hints.js`；掛 `/lesson-plans` |
| `standalone.ts` / `dev.ts`（改） | 開 DB、注入 repo |
| `scripts/lesson-plan-spike.mts`（新） | 手動品質 spike |

**前端（`frontend/src`）**

| 檔案 | 責任 |
|------|------|
| `types/lessonPlan.ts`（新） | 教案型別（前端版） |
| `types/vrm.ts`（改） | `TaskItem.hint?` |
| `utils/lessonPlanClient.ts`（新） | 教案端點 fetch 封裝 |
| `utils/sceneContext.ts`（新） | `buildSceneContext(sceneId)` |
| `utils/lessonPlanMarkdown.ts`（新） | `lessonPlanToMarkdown(plan)` |
| `utils/lessonPlanEdit.ts`（新） | 結果頁編輯 reducer（純函式） |
| `config/content.ts`（新） | `resolveModules` / `resolveTaskHint` / `resolveSceneConstraint` |
| `state.ts`（改） | 新畫面、`planId`、`resolveAuthRoute` 改回 `teacher-home` |
| `App.tsx`（改） | 分流與新畫面接線 |
| `components/TeacherHome.tsx` + `.css`（新） | 備課 / 開始上課 |
| `components/LessonPrep.tsx` + `.css`（新） | 清單、表單、生成中 |
| `components/LessonPlanView.tsx`（新） | 結果卡片、編輯、Markdown、列印 |
| `components/HostSession.tsx`（改） | `planId` prop、載入教案、resolve 接線 |
| `components/BigScreen.tsx`（改） | `TaskEntry.hint?`、提示查表 |

---

### Task 1: 後端 `ai/client.ts` 統一 Gemini 呼叫層

**Files:**
- Create: `backend/src/ai/client.ts`
- Test: `backend/src/ai/client.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface TokenUsage { prompt: number; output: number; total: number }
  export interface GeminiCallOptions<T> {
    tag: string; contents: unknown; systemInstruction?: string
    temperature: number; maxOutputTokens: number; thinkingBudget: number
    responseSchema?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number
    parse: (text: string) => T
  }
  export interface GeminiCallResult<T> { data: T; model: string; usage?: TokenUsage }
  export class GeminiParseError extends Error {}
  export function isRetryable(err: unknown): boolean
  export async function callGemini<T>(opts: GeminiCallOptions<T>): Promise<GeminiCallResult<T>>
  ```

- [ ] **Step 1: 寫失敗測試**

```ts
// backend/src/ai/client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const generateContentMock = vi.fn()

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContent: generateContentMock },
  })),
}))

describe('callGemini', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.GEMINI_API_KEY = 'test-key'
    process.env.GEMINI_MODEL = 'gemini-2.5-flash,gemini-2.0-flash-lite'
    generateContentMock.mockReset()
  })

  const base = { tag: '[test]', contents: 'hi', temperature: 0.5, maxOutputTokens: 100, thinkingBudget: 256 }

  it('returns parsed data, model and usage', async () => {
    generateContentMock.mockResolvedValue({
      text: '{"a":1}',
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 },
    })
    const { callGemini } = await import('./client.js')
    const res = await callGemini({ ...base, parse: t => JSON.parse(t) as { a: number } })
    expect(res.data).toEqual({ a: 1 })
    expect(res.model).toBe('gemini-2.5-flash')
    expect(res.usage).toEqual({ prompt: 3, output: 4, total: 7 })
  })

  it('falls back to the next model on a retryable error', async () => {
    generateContentMock
      .mockRejectedValueOnce(new Error('503 Service Unavailable'))
      .mockResolvedValueOnce({ text: 'ok' })
    const { callGemini } = await import('./client.js')
    const res = await callGemini({ ...base, parse: t => t })
    expect(res.data).toBe('ok')
    expect(res.model).toBe('gemini-2.0-flash-lite')
    expect(generateContentMock).toHaveBeenCalledTimes(2)
  })

  it('throws immediately on a non-retryable error', async () => {
    generateContentMock.mockRejectedValue(new Error('400 API key not valid'))
    const { callGemini } = await import('./client.js')
    await expect(callGemini({ ...base, parse: t => t })).rejects.toThrow('API key not valid')
    expect(generateContentMock).toHaveBeenCalledTimes(1)
  })

  it('treats a parse failure as a model failure and tries the next model', async () => {
    generateContentMock
      .mockResolvedValueOnce({ text: 'not json' })
      .mockResolvedValueOnce({ text: '{"ok":true}' })
    const { callGemini } = await import('./client.js')
    const res = await callGemini({ ...base, parse: t => JSON.parse(t) as { ok: boolean } })
    expect(res.data).toEqual({ ok: true })
    expect(res.model).toBe('gemini-2.0-flash-lite')
  })

  it('throws GeminiParseError when every model fails to parse', async () => {
    generateContentMock.mockResolvedValue({ text: 'garbage' })
    const { callGemini, GeminiParseError } = await import('./client.js')
    await expect(callGemini({ ...base, parse: t => JSON.parse(t) })).rejects.toBeInstanceOf(GeminiParseError)
  })

  it('throws on empty response without trying the next model', async () => {
    generateContentMock.mockResolvedValue({ text: '' })
    const { callGemini } = await import('./client.js')
    await expect(callGemini({ ...base, parse: t => t })).rejects.toThrow('Empty response')
    expect(generateContentMock).toHaveBeenCalledTimes(1)
  })

  it('sets JSON mime type and schema when responseSchema is given', async () => {
    generateContentMock.mockResolvedValue({ text: '{}' })
    const { callGemini } = await import('./client.js')
    const schema = { type: 'OBJECT', properties: {} }
    await callGemini({ ...base, responseSchema: schema, parse: t => JSON.parse(t) })
    const config = generateContentMock.mock.calls[0][0].config
    expect(config.responseMimeType).toBe('application/json')
    expect(config.responseSchema).toBe(schema)
    expect(config.systemInstruction).toBeUndefined()
  })

  it('sends thinkingBudget 0 to non-2.5 models', async () => {
    generateContentMock
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValueOnce({ text: 'x' })
    const { callGemini } = await import('./client.js')
    await callGemini({ ...base, parse: t => t })
    expect(generateContentMock.mock.calls[0][0].config.thinkingConfig).toEqual({ thinkingBudget: 256 })
    expect(generateContentMock.mock.calls[1][0].config.thinkingConfig).toEqual({ thinkingBudget: 0 })
  })

  it('throws when GEMINI_API_KEY is missing', async () => {
    delete process.env.GEMINI_API_KEY
    const { callGemini } = await import('./client.js')
    await expect(callGemini({ ...base, parse: t => t })).rejects.toThrow('GEMINI_API_KEY')
  })
})
```

- [ ] **Step 2: 確認失敗**

Run: `cd backend && npx vitest run src/ai/client.test.ts`
Expected: FAIL，找不到 `./client.js`

- [ ] **Step 3: 實作**

```ts
// backend/src/ai/client.ts
import { GoogleGenAI } from '@google/genai'

const DEFAULT_MODELS = 'gemini-2.5-flash,gemini-2.5-flash-lite,gemini-2.0-flash-lite'
export const MODELS = (process.env.GEMINI_MODEL || DEFAULT_MODELS)
  .split(',')
  .map(m => m.trim())
  .filter(Boolean)
const DEFAULT_TIMEOUT_MS = 60_000

let client: GoogleGenAI | null = null

function getClient(): GoogleGenAI {
  if (client) return client
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')
  client = new GoogleGenAI({ apiKey })
  return client
}

export function isRetryable(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    msg.includes('503') ||
    msg.includes('429') ||
    msg.includes('unavailable') ||
    msg.includes('overloaded') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota')
  )
}

export interface TokenUsage {
  prompt: number
  output: number
  total: number
}

/** 模型回傳文字無法被 parse 成預期形狀；視為該模型失敗、換下一個模型。 */
export class GeminiParseError extends Error {
  constructor(model: string, cause: unknown) {
    super(`[${model}] response parse failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'GeminiParseError'
  }
}

export interface GeminiCallOptions<T> {
  /** log 前綴，例如 '[ai/hints]' */
  tag: string
  /** 純字串 prompt，或已是 @google/genai Content[] 形狀的多輪內容 */
  contents: unknown
  systemInstruction?: string
  temperature: number
  maxOutputTokens: number
  /** 只對 2.5 系列生效；2.0 系列傳 thinkingBudget 會報錯，一律送 0 */
  thinkingBudget: number
  /** 有給就強制 JSON 輸出 */
  responseSchema?: Record<string, unknown>
  signal?: AbortSignal
  timeoutMs?: number
  /** 把模型文字轉成結果；拋錯視為該模型失敗 */
  parse: (text: string) => T
}

export interface GeminiCallResult<T> {
  data: T
  model: string
  usage?: TokenUsage
}

export async function callGemini<T>(opts: GeminiCallOptions<T>): Promise<GeminiCallResult<T>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  opts.signal?.addEventListener('abort', () => controller.abort())
  try {
    let lastErr: unknown = new Error('No models configured')
    for (const model of MODELS) {
      try {
        const thinkingBudget = model.includes('2.5') ? opts.thinkingBudget : 0
        const config: Record<string, unknown> = {
          temperature: opts.temperature,
          maxOutputTokens: opts.maxOutputTokens,
          thinkingConfig: { thinkingBudget },
          abortSignal: controller.signal,
        }
        if (opts.responseSchema) {
          config.responseMimeType = 'application/json'
          config.responseSchema = opts.responseSchema
        }
        if (opts.systemInstruction) config.systemInstruction = opts.systemInstruction
        const res = await getClient().models.generateContent({
          model,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          contents: opts.contents as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          config: config as any,
        })
        const text = (res.text ?? '').trim()
        if (!text) throw new Error('Empty response')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const um = (res as any).usageMetadata
        const usage: TokenUsage | undefined = um
          ? { prompt: um.promptTokenCount ?? 0, output: um.candidatesTokenCount ?? 0, total: um.totalTokenCount ?? 0 }
          : undefined
        let data: T
        try {
          data = opts.parse(text)
        } catch (parseErr) {
          throw new GeminiParseError(model, parseErr)
        }
        if (usage) console.log(`${opts.tag} ${model} tokens prompt=${usage.prompt} output=${usage.output} total=${usage.total}`)
        return { data, model, usage }
      } catch (err) {
        lastErr = err
        const msg = err instanceof Error ? err.message : String(err)
        if (!isRetryable(err) && !(err instanceof GeminiParseError)) throw err
        console.warn(`${opts.tag} ${model} failed (${msg.slice(0, 120)}), trying next model`)
      }
    }
    throw lastErr
  } finally {
    clearTimeout(timer)
  }
}
```

- [ ] **Step 4: 確認通過**

Run: `cd backend && npx vitest run src/ai/client.test.ts`
Expected: 9 passed

- [ ] **Step 5: Commit**

```bash
git add backend/src/ai/client.ts backend/src/ai/client.test.ts
git commit -m "feat(ai): 新增 ai/client.ts 統一 Gemini 呼叫層（fallback、逾時、parse hook、usage）"
```

---

### Task 2: 現有提示流搬到 `ai/hints.ts`，刪除 `ai.ts`

**Files:**
- Create: `backend/src/ai/hints.ts`
- Move: `backend/src/ai.test.ts` → `backend/src/ai/hints.test.ts`
- Delete: `backend/src/ai.ts`
- Modify: `backend/src/routes.ts:9`

**Interfaces:**
- Consumes: `callGemini` from Task 1
- Produces: `generateHint`、`generateHints`、型別 `HintResult` / `HintsResult` / `ChatTurn` / `GenerateHintOptions` / `TokenUsage`（與現有 `ai.ts` 完全相同的簽名）

- [ ] **Step 1: 搬測試檔並改 import**

```bash
cd backend && git mv src/ai.test.ts src/ai/hints.test.ts
```

在 `src/ai/hints.test.ts` 把所有 `await import('./ai.js')` 換成 `await import('./hints.js')`（用編輯器全域取代，應有多處）。

- [ ] **Step 2: 確認失敗**

Run: `cd backend && npx vitest run src/ai/hints.test.ts`
Expected: FAIL，找不到 `./hints.js`

- [ ] **Step 3: 寫 `ai/hints.ts`**

```ts
// backend/src/ai/hints.ts
import { callGemini, type TokenUsage } from './client.js'

export type { TokenUsage }

export interface HintResult {
  text: string
  model: string
}

export interface ChatTurn {
  role: 'user' | 'model'
  text: string
}

export interface GenerateHintOptions {
  history?: ChatTurn[]
  systemInstruction?: string
  signal?: AbortSignal
  /** 當前輪改用音訊輸入（base64）；history 仍為文字。 */
  audio?: { data: string; mimeType: string }
}

export interface HintsResult {
  transcript: string
  question: string
  complete: string
  extend: string
  model: string
  usage?: TokenUsage
}

const HINTS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcript: { type: 'STRING' },
    question: { type: 'STRING' },
    complete: { type: 'STRING' },
    extend: { type: 'STRING' },
  },
  required: ['question', 'complete', 'extend'],
}

function parseHints(raw: string): Omit<HintsResult, 'model' | 'usage'> {
  let parsed: { transcript?: unknown; question?: unknown; complete?: unknown; extend?: unknown }
  try { parsed = JSON.parse(raw) }
  catch { parsed = { question: '', complete: raw, extend: '' } } // fallback: 純文字視為 complete
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const result = {
    transcript: str(parsed.transcript),
    question: str(parsed.question),
    complete: str(parsed.complete),
    extend: str(parsed.extend),
  }
  if (!result.complete) throw new Error('Empty complete field')
  return result
}

function buildContents(prompt: string, opts: GenerateHintOptions): unknown {
  const historyTurns = (opts.history ?? []).map(h => ({ role: h.role, parts: [{ text: h.text }] }))
  if (opts.audio) {
    if (!opts.audio.data) throw new Error('audio.data is empty')
    return [
      ...historyTurns,
      { role: 'user', parts: [{ inlineData: { mimeType: opts.audio.mimeType, data: opts.audio.data } }] },
    ]
  }
  if (historyTurns.length > 0) return [...historyTurns, { role: 'user', parts: [{ text: prompt }] }]
  return prompt
}

export async function generateHints(prompt: string, opts: GenerateHintOptions = {}): Promise<HintsResult> {
  const { data, model, usage } = await callGemini({
    tag: '[ai/hints]',
    contents: buildContents(prompt, opts),
    systemInstruction: opts.systemInstruction,
    // 抽取主問句屬「抽取」而非創作，低溫降低選錯句子的機率。
    temperature: 0.3,
    // 開 thinking 後思考 token 會佔用輸出額度，拉高上限避免 JSON 被截斷。
    maxOutputTokens: 640,
    thinkingBudget: 512,
    responseSchema: HINTS_SCHEMA,
    signal: opts.signal,
    parse: parseHints,
  })
  return { ...data, model, usage }
}

export async function generateHint(prompt: string, opts: GenerateHintOptions = {}): Promise<HintResult> {
  const { data, model } = await callGemini({
    tag: '[ai/hint]',
    contents: buildContents(prompt, { history: opts.history }),
    systemInstruction: opts.systemInstruction,
    temperature: 0.6,
    maxOutputTokens: 128,
    thinkingBudget: 0,
    signal: opts.signal,
    parse: text => text,
  })
  return { text: data, model }
}
```

- [ ] **Step 4: 改 routes import 並刪除舊檔**

`backend/src/routes.ts` 第 9 行改為：

```ts
import { generateHint as generateAIHint, generateHints as generateAIHints } from './ai/hints.js'
```

```bash
cd backend && git rm src/ai.ts
```

- [ ] **Step 5: 跑全部後端測試與型別檢查**

Run: `cd backend && npx vitest run && npx tsc --noEmit`
Expected: 全部 passed（含 `ai/hints.test.ts` 原有案例）、tsc 無錯

> 若 `hints.test.ts` 有案例預期「`Empty complete field` 立即拋出、不換模型」而現在變成換模型後才拋，接受新行為並改該測試的 `toHaveBeenCalledTimes` 期望值；在 commit 訊息註明。

- [ ] **Step 6: Commit**

```bash
git add -A backend/src
git commit -m "refactor(ai): 提示流搬到 ai/hints.ts 並改用 client，移除重複的 fallback 邏輯"
```

---

### Task 3: SQLite 連線與 migration

**Files:**
- Create: `backend/src/db/migrations.ts`、`backend/src/db/connection.ts`
- Test: `backend/src/db/connection.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const MIGRATIONS: ReadonlyArray<string>
  export function openDatabase(filePath: string): DatabaseSync   // ':memory:' 可用
  export function migrate(db: DatabaseSync): number              // 回傳套用後版本
  ```

- [ ] **Step 1: 寫失敗測試**

```ts
// backend/src/db/connection.test.ts
import { describe, it, expect } from 'vitest'
import { openDatabase, migrate } from './connection.js'
import { MIGRATIONS } from './migrations.js'

function tableNames(db: ReturnType<typeof openDatabase>): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[])
    .map(r => r.name)
}

describe('openDatabase / migrate', () => {
  it('creates lesson_plans and lesson_tasks tables', () => {
    const db = openDatabase(':memory:')
    expect(tableNames(db)).toEqual(expect.arrayContaining(['lesson_plans', 'lesson_tasks', 'schema_version']))
  })

  it('is idempotent: second migrate keeps the same version', () => {
    const db = openDatabase(':memory:')
    const v1 = migrate(db)
    const v2 = migrate(db)
    expect(v1).toBe(MIGRATIONS.length)
    expect(v2).toBe(v1)
    const rows = db.prepare('SELECT COUNT(*) AS c FROM schema_version').get() as { c: number }
    expect(rows.c).toBe(MIGRATIONS.length)
  })

  it('enforces foreign keys', () => {
    const db = openDatabase(':memory:')
    expect(() =>
      db.prepare(
        `INSERT INTO lesson_tasks (id, plan_id, module_id, module_label, sort_order, label, hint_json)
         VALUES ('t1', 'missing-plan', 'm1', 'Price', 0, 'Ask', '{}')`,
      ).run(),
    ).toThrow(/FOREIGN KEY/i)
  })
})
```

- [ ] **Step 2: 確認失敗**

Run: `cd backend && npx vitest run src/db/connection.test.ts`
Expected: FAIL，找不到模組

- [ ] **Step 3: 實作**

```ts
// backend/src/db/migrations.ts
/**
 * 版本化 migration。index i 對應版本 i+1，只能在尾端追加、不可改動已上線的項目。
 * 用 TS 字串而非 .sql 檔：esbuild 把 backend 打包成單一 bundle，讀不到旁邊的檔案。
 */
export const MIGRATIONS: ReadonlyArray<string> = [
  `
  CREATE TABLE lesson_plans (
    id             TEXT PRIMARY KEY,
    teacher_uid    TEXT NOT NULL,
    institution_id TEXT,
    scene_id       TEXT NOT NULL,
    topic          TEXT NOT NULL,
    level          TEXT NOT NULL,
    title          TEXT NOT NULL,
    plan_json      TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );
  CREATE INDEX idx_lesson_plans_teacher ON lesson_plans (teacher_uid, updated_at DESC);
  CREATE TABLE lesson_tasks (
    id           TEXT PRIMARY KEY,
    plan_id      TEXT NOT NULL REFERENCES lesson_plans(id) ON DELETE CASCADE,
    module_id    TEXT NOT NULL,
    module_label TEXT NOT NULL,
    sort_order   INTEGER NOT NULL,
    label        TEXT NOT NULL,
    hint_json    TEXT NOT NULL
  );
  CREATE INDEX idx_lesson_tasks_plan ON lesson_tasks (plan_id, sort_order);
  `,
]
```

```ts
// backend/src/db/connection.ts
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import path from 'path'
import { MIGRATIONS } from './migrations.js'

/** 開啟（必要時建立）SQLite 檔案並套用所有未執行的 migration。傳 ':memory:' 供測試。 */
export function openDatabase(filePath: string): DatabaseSync {
  if (filePath !== ':memory:') fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const db = new DatabaseSync(filePath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

export function migrate(db: DatabaseSync): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null }
  let current = row.v ?? 0
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[i])
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(i + 1)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
    current = i + 1
  }
  return current
}
```

- [ ] **Step 4: 確認通過**

Run: `cd backend && npx vitest run src/db/connection.test.ts`
Expected: 3 passed（終端會印一行 `ExperimentalWarning: SQLite is an experimental feature`，屬正常）

- [ ] **Step 5: Commit**

```bash
git add backend/src/db
git commit -m "feat(db): node:sqlite 連線與版本化 migration，建立 lesson_plans / lesson_tasks"
```

---

### Task 4: 教案型別與 `LessonPlanRepo`

**Files:**
- Create: `backend/src/lessonPlanTypes.ts`、`backend/src/db/lessonPlanRepo.ts`
- Test: `backend/src/db/lessonPlanRepo.test.ts`

**Interfaces:**
- Consumes: `openDatabase` from Task 3
- Produces:
  ```ts
  // lessonPlanTypes.ts
  export type CefrLevel = 'A1' | 'A2' | 'B1'
  export const CEFR_LEVELS: readonly CefrLevel[]
  export interface TaskHint { keyStructure: string; partialSentence: string; unscramble: string[]; completeSentence: string; extraPhrases: string[] }
  export interface LessonPlanTask { id: string; label: string; hint: TaskHint }
  export interface LessonPlanModule { id: string; label: string; icon: string; tasks: LessonPlanTask[] }
  export interface TimelinePhase { phase: string; minutes: number; activity: string; teacherScript: string }
  export interface GrammarNote { point: string; explanation: string; examples: string[] }
  export interface LessonPlan { title; sceneId; topic; level: CefrLevel; durationMin: 15; objectives: string[]; timeline: TimelinePhase[]; grammarNotes: GrammarNote[]; teachingNotes: string[]; sceneConstraint: string; modules: LessonPlanModule[] }
  export interface SceneContext { sceneId; themeLabel; sceneLabel; sceneLabelEn; slots: { id; label }[]; existingModuleLabels: string[]; exampleTasks: { label: string; hint: TaskHint }[] }
  export interface LessonPlanRecord { id; teacherUid; institutionId: string | null; createdAt; updatedAt; plan: LessonPlan }
  export interface LessonPlanSummary { id; title; sceneId; topic; level: CefrLevel; createdAt; updatedAt }
  // lessonPlanRepo.ts
  export class LessonPlanRepo {
    constructor(db: DatabaseSync)
    create(input: { id: string; teacherUid: string; institutionId?: string | null; plan: LessonPlan }): LessonPlanRecord
    list(teacherUid: string): LessonPlanSummary[]
    get(id: string): LessonPlanRecord | null
    update(id: string, patch: { title?: string; modules?: LessonPlanModule[] }): LessonPlanRecord | null
    remove(id: string): boolean
    countTasks(planId: string): number
  }
  ```

- [ ] **Step 1: 寫型別檔**

```ts
// backend/src/lessonPlanTypes.ts
export type CefrLevel = 'A1' | 'A2' | 'B1'
export const CEFR_LEVELS: readonly CefrLevel[] = ['A1', 'A2', 'B1']

/** 與前端 frontend/src/config/taskHints.ts 的 TaskHint 形狀一致 */
export interface TaskHint {
  keyStructure: string
  partialSentence: string
  unscramble: string[]
  completeSentence: string
  extraPhrases: string[]
}

export interface LessonPlanTask {
  id: string
  label: string
  hint: TaskHint
}

export interface LessonPlanModule {
  id: string
  label: string
  icon: string
  tasks: LessonPlanTask[]
}

export interface TimelinePhase {
  phase: string
  minutes: number
  activity: string
  teacherScript: string
}

export interface GrammarNote {
  point: string
  explanation: string
  examples: string[]
}

export interface LessonPlan {
  title: string
  sceneId: string
  topic: string
  level: CefrLevel
  durationMin: 15
  objectives: string[]
  timeline: TimelinePhase[]
  grammarNotes: GrammarNote[]
  teachingNotes: string[]
  sceneConstraint: string
  modules: LessonPlanModule[]
}

/** 前端從 THEMES / TASK_HINTS 整理出、隨生成請求送上來的場景脈絡 */
export interface SceneContext {
  sceneId: string
  themeLabel: string
  sceneLabel: string
  sceneLabelEn: string
  slots: { id: string; label: string }[]
  existingModuleLabels: string[]
  exampleTasks: { label: string; hint: TaskHint }[]
}

export interface LessonPlanRecord {
  id: string
  teacherUid: string
  institutionId: string | null
  createdAt: string
  updatedAt: string
  plan: LessonPlan
}

export interface LessonPlanSummary {
  id: string
  title: string
  sceneId: string
  topic: string
  level: CefrLevel
  createdAt: string
  updatedAt: string
}
```

- [ ] **Step 2: 寫失敗測試**

```ts
// backend/src/db/lessonPlanRepo.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from './connection.js'
import { LessonPlanRepo } from './lessonPlanRepo.js'
import type { LessonPlan, LessonPlanModule } from '../lessonPlanTypes.js'

function hint(sentence: string) {
  const words = sentence.split(' ')
  return { keyStructure: 'X', partialSentence: '___', unscramble: [...words].reverse(), completeSentence: sentence, extraPhrases: ['Y'] }
}

function samplePlan(planId: string): LessonPlan {
  return {
    title: '退換貨', sceneId: 'clothingStore_cashier', topic: 'returns', level: 'A2', durationMin: 15,
    objectives: ['能提出退貨要求'],
    timeline: [
      { phase: '暖身', minutes: 5, activity: '問候', teacherScript: 'Hello everyone.' },
      { phase: '練習', minutes: 10, activity: '角色扮演', teacherScript: 'Now practice.' },
    ],
    grammarNotes: [{ point: 'would like to', explanation: '禮貌請求', examples: ['I would like to return this.'] }],
    teachingNotes: ['注意語速'],
    sceneConstraint: 'Setting: returns counter.',
    modules: [
      { id: `plan_${planId}_m1`, label: 'Return', icon: '🔁', tasks: [
        { id: `plan_${planId}_1`, label: 'Ask to return a T-shirt.', hint: hint('I would like to return this T-shirt.') },
        { id: `plan_${planId}_2`, label: 'Ask for a refund.', hint: hint('Can I get a refund?') },
      ] },
    ],
  }
}

describe('LessonPlanRepo', () => {
  let repo: LessonPlanRepo
  beforeEach(() => { repo = new LessonPlanRepo(openDatabase(':memory:')) })

  it('create then get returns the same plan with metadata', () => {
    const rec = repo.create({ id: 'p1', teacherUid: 't1', institutionId: 'inst9', plan: samplePlan('p1') })
    expect(rec.id).toBe('p1')
    expect(rec.institutionId).toBe('inst9')
    expect(rec.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(repo.get('p1')).toEqual(rec)
    expect(repo.countTasks('p1')).toBe(2)
  })

  it('get returns null for unknown id', () => {
    expect(repo.get('nope')).toBeNull()
  })

  it('list returns only that teacher, newest updated first, without plan body', () => {
    repo.create({ id: 'a', teacherUid: 't1', plan: samplePlan('a') })
    repo.create({ id: 'b', teacherUid: 't2', plan: samplePlan('b') })
    repo.create({ id: 'c', teacherUid: 't1', plan: { ...samplePlan('c'), title: 'newer' } })
    repo.update('a', { title: 'touched' })
    const list = repo.list('t1')
    expect(list.map(s => s.id)).toEqual(['a', 'c'])
    expect(list[0]).not.toHaveProperty('plan')
    expect(list[0].title).toBe('touched')
  })

  it('update replaces title and modules, rewriting lesson_tasks rows', () => {
    repo.create({ id: 'p1', teacherUid: 't1', plan: samplePlan('p1') })
    const modules: LessonPlanModule[] = [
      { id: 'plan_p1_m1', label: 'Return', icon: '🔁', tasks: [
        { id: 'plan_p1_1', label: 'Ask to return a jacket.', hint: hint('I would like to return this jacket.') },
      ] },
    ]
    const rec = repo.update('p1', { title: 'New title', modules })
    expect(rec?.plan.title).toBe('New title')
    expect(rec?.plan.modules[0].tasks).toHaveLength(1)
    expect(rec?.plan.modules[0].tasks[0].label).toBe('Ask to return a jacket.')
    expect(repo.countTasks('p1')).toBe(1)
    expect(repo.get('p1')?.plan.objectives).toEqual(['能提出退貨要求'])
  })

  it('update returns null for unknown id', () => {
    expect(repo.update('nope', { title: 'x' })).toBeNull()
  })

  it('remove deletes plan and cascades tasks', () => {
    repo.create({ id: 'p1', teacherUid: 't1', plan: samplePlan('p1') })
    expect(repo.remove('p1')).toBe(true)
    expect(repo.get('p1')).toBeNull()
    expect(repo.countTasks('p1')).toBe(0)
    expect(repo.remove('p1')).toBe(false)
  })
})
```

- [ ] **Step 3: 確認失敗**

Run: `cd backend && npx vitest run src/db/lessonPlanRepo.test.ts`
Expected: FAIL，找不到 `./lessonPlanRepo.js`

- [ ] **Step 4: 實作 repo**

```ts
// backend/src/db/lessonPlanRepo.ts
import type { DatabaseSync } from 'node:sqlite'
import type { LessonPlan, LessonPlanModule, LessonPlanRecord, LessonPlanSummary, CefrLevel } from '../lessonPlanTypes.js'

interface PlanRow {
  id: string
  teacher_uid: string
  institution_id: string | null
  scene_id: string
  topic: string
  level: string
  title: string
  plan_json: string
  created_at: string
  updated_at: string
}

function rowToRecord(row: PlanRow): LessonPlanRecord {
  return {
    id: row.id,
    teacherUid: row.teacher_uid,
    institutionId: row.institution_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    plan: JSON.parse(row.plan_json) as LessonPlan,
  }
}

export class LessonPlanRepo {
  constructor(private readonly db: DatabaseSync) {}

  create(input: { id: string; teacherUid: string; institutionId?: string | null; plan: LessonPlan }): LessonPlanRecord {
    const now = new Date().toISOString()
    const { id, teacherUid, plan } = input
    this.db.exec('BEGIN')
    try {
      this.db.prepare(
        `INSERT INTO lesson_plans (id, teacher_uid, institution_id, scene_id, topic, level, title, plan_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, teacherUid, input.institutionId ?? null, plan.sceneId, plan.topic, plan.level, plan.title, JSON.stringify(plan), now, now)
      this.replaceTasks(id, plan.modules)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    return this.get(id)!
  }

  list(teacherUid: string): LessonPlanSummary[] {
    const rows = this.db.prepare(
      `SELECT id, title, scene_id, topic, level, created_at, updated_at
       FROM lesson_plans WHERE teacher_uid = ? ORDER BY updated_at DESC, created_at DESC`,
    ).all(teacherUid) as Omit<PlanRow, 'teacher_uid' | 'institution_id' | 'plan_json'>[]
    return rows.map(r => ({
      id: r.id, title: r.title, sceneId: r.scene_id, topic: r.topic,
      level: r.level as CefrLevel, createdAt: r.created_at, updatedAt: r.updated_at,
    }))
  }

  get(id: string): LessonPlanRecord | null {
    const row = this.db.prepare('SELECT * FROM lesson_plans WHERE id = ?').get(id) as PlanRow | undefined
    return row ? rowToRecord(row) : null
  }

  update(id: string, patch: { title?: string; modules?: LessonPlanModule[] }): LessonPlanRecord | null {
    const existing = this.get(id)
    if (!existing) return null
    const plan: LessonPlan = {
      ...existing.plan,
      title: patch.title ?? existing.plan.title,
      modules: patch.modules ?? existing.plan.modules,
    }
    const now = new Date().toISOString()
    this.db.exec('BEGIN')
    try {
      this.db.prepare('UPDATE lesson_plans SET title = ?, plan_json = ?, updated_at = ? WHERE id = ?')
        .run(plan.title, JSON.stringify(plan), now, id)
      if (patch.modules) this.replaceTasks(id, plan.modules)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    return this.get(id)
  }

  remove(id: string): boolean {
    const res = this.db.prepare('DELETE FROM lesson_plans WHERE id = ?').run(id)
    return Number(res.changes) > 0
  }

  countTasks(planId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM lesson_tasks WHERE plan_id = ?').get(planId) as { c: number }
    return Number(row.c)
  }

  /** 先清掉再整批寫入；呼叫端負責交易。 */
  private replaceTasks(planId: string, modules: LessonPlanModule[]): void {
    this.db.prepare('DELETE FROM lesson_tasks WHERE plan_id = ?').run(planId)
    const insert = this.db.prepare(
      `INSERT INTO lesson_tasks (id, plan_id, module_id, module_label, sort_order, label, hint_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    let order = 0
    for (const mod of modules) {
      for (const task of mod.tasks) {
        insert.run(task.id, planId, mod.id, mod.label, order++, task.label, JSON.stringify(task.hint))
      }
    }
  }
}
```

> `list()` 的排序測試依賴 `update` 後 `updated_at` 比其他列晚。若同一毫秒內建立多筆導致排序不穩，測試裡在 `repo.update('a', ...)` 前加 `await new Promise(r => setTimeout(r, 2))` 並把該案例改成 `async`。

- [ ] **Step 5: 確認通過**

Run: `cd backend && npx vitest run src/db/lessonPlanRepo.test.ts`
Expected: 6 passed

- [ ] **Step 6: Commit**

```bash
git add backend/src/lessonPlanTypes.ts backend/src/db/lessonPlanRepo.ts backend/src/db/lessonPlanRepo.test.ts
git commit -m "feat(db): 教案型別與 LessonPlanRepo（增刪改查、任務列同步）"
```

---

### Task 5: 教案生成 workflow（`ai/lessonPlanPrompts.ts` + `ai/lessonPlan.ts`）

**Files:**
- Create: `backend/src/ai/lessonPlanPrompts.ts`、`backend/src/ai/lessonPlan.ts`
- Test: `backend/src/ai/lessonPlan.test.ts`

**Interfaces:**
- Consumes: `callGemini` / `GeminiCallOptions` from Task 1；型別 from Task 4
- Produces:
  ```ts
  export interface LessonPlanRequest { sceneId: string; topic: string; level: CefrLevel; sceneContext: SceneContext }
  export interface OutlineDraft { title; objectives: string[]; timeline: { phase; minutes; activity }[]; modules: { label; icon; taskLabels: string[] }[]; sceneConstraint }
  export type GeminiCaller = <T>(opts: GeminiCallOptions<T>) => Promise<GeminiCallResult<T>>
  export function validateOutline(raw: unknown): OutlineDraft            // 拋錯 = 不合格
  export function unscrambleMatches(hint: TaskHint): boolean
  export function repairUnscramble(sentence: string): string[]
  export function assignIds(planId: string, modules: { label; icon; tasks: { label; hint }[] }[]): LessonPlanModule[]
  export async function generateLessonPlan(req: LessonPlanRequest, planId: string, opts?: { signal?: AbortSignal; call?: GeminiCaller }): Promise<LessonPlan>
  ```
- 呼叫 `call` 時的 `tag` 固定為：`'[ai/lesson/outline]'`、`'[ai/lesson/script]'`、`'[ai/lesson/hints]'`、`'[ai/lesson/notes]'`（測試靠 tag 分派假資料）。

- [ ] **Step 1: 寫 prompts 與 schema 檔**

```ts
// backend/src/ai/lessonPlanPrompts.ts
import type { CefrLevel, SceneContext, TaskHint } from '../lessonPlanTypes.js'

export const LEVEL_GUIDE: Record<CefrLevel, string> = {
  A1: 'CEFR A1 (beginner, roughly Taiwan grades 3-4). Present simple only, very high-frequency words, sentences of 4-7 words, one idea per sentence. Avoid clauses, phrasal verbs and idioms.',
  A2: 'CEFR A2 (elementary, roughly Taiwan grades 5-6). Present, past and "be going to"; everyday vocabulary; sentences up to ~10 words; simple "because" / "but" clauses are fine.',
  B1: 'CEFR B1 (intermediate, roughly Taiwan junior high). Common tenses including present perfect, modals for politeness, sentences up to ~14 words, simple relative clauses allowed.',
}

const STR = { type: 'STRING' }
const STR_ARRAY = { type: 'ARRAY', items: STR }

export const OUTLINE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: STR,
    objectives: STR_ARRAY,
    timeline: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { phase: STR, minutes: { type: 'INTEGER' }, activity: STR }, required: ['phase', 'minutes', 'activity'] },
    },
    modules: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { label: STR, icon: STR, taskLabels: STR_ARRAY }, required: ['label', 'icon', 'taskLabels'] },
    },
    sceneConstraint: STR,
  },
  required: ['title', 'objectives', 'timeline', 'modules', 'sceneConstraint'],
}

export const SCRIPT_SCHEMA = {
  type: 'OBJECT',
  properties: { teacherScript: STR },
  required: ['teacherScript'],
}

export const MODULE_HINTS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    tasks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label: STR,
          keyStructure: STR,
          partialSentence: STR,
          unscramble: STR_ARRAY,
          completeSentence: STR,
          extraPhrases: STR_ARRAY,
        },
        required: ['label', 'keyStructure', 'partialSentence', 'unscramble', 'completeSentence', 'extraPhrases'],
      },
    },
  },
  required: ['tasks'],
}

export const NOTES_SCHEMA = {
  type: 'OBJECT',
  properties: {
    grammarNotes: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { point: STR, explanation: STR, examples: STR_ARRAY }, required: ['point', 'explanation', 'examples'] },
    },
    teachingNotes: STR_ARRAY,
  },
  required: ['grammarNotes', 'teachingNotes'],
}

function describeScene(ctx: SceneContext): string {
  const slots = ctx.slots.map(s => `${s.label} (${s.id})`).join(', ')
  return `Theme: ${ctx.themeLabel}. Scene: ${ctx.sceneLabel} / ${ctx.sceneLabelEn} (id: ${ctx.sceneId}).
Roles on stage: ${slots}. One student plays each role; the teacher may also step into a role.
Existing task modules in this scene (do NOT duplicate them): ${ctx.existingModuleLabels.join(', ') || 'none'}.`
}

function describeExamples(examples: SceneContext['exampleTasks']): string {
  return examples
    .map(e => `- label: "${e.label}"\n  hint: ${JSON.stringify(e.hint)}`)
    .join('\n')
}

export function buildOutlinePrompt(topic: string, level: CefrLevel, ctx: SceneContext): { systemInstruction: string; prompt: string } {
  return {
    systemInstruction: `You are an experienced English conversation teacher designing a 15-minute micro-lesson for a mixed-reality classroom where students speak as avatars in a 3D scene.
Student level: ${LEVEL_GUIDE[level]}
${describeScene(ctx)}

Write in Traditional Chinese for "title", "objectives", every "phase" and "activity"; write in English for task labels and "sceneConstraint".

Rules:
- The timeline has 3 to 5 phases and the "minutes" values MUST add up to exactly 15.
- Produce 2 to 4 task modules, each with 3 to 6 task labels. Each label is ONE English imperative sentence telling the student what to say, in the style of: "Ask for the price of a blue T-shirt."
- "icon" is a single emoji for the module.
- "sceneConstraint" is a 5-line English block with the headings Setting:, Language:, Grammar:, Vocabulary:, Response style: describing the scene for this topic, used later to steer an AI that writes sample student replies. Keep it concrete.
- Do not include the teacher script or hints here; another step writes them.`,
    prompt: `Lesson topic from the teacher: "${topic}". Design the outline now.`,
  }
}

export function buildScriptPrompt(
  outline: { title: string; objectives: string[] },
  phase: { phase: string; minutes: number; activity: string },
  level: CefrLevel,
  ctx: SceneContext,
): { systemInstruction: string; prompt: string } {
  return {
    systemInstruction: `You write the teacher's verbatim spoken script for ONE phase of a 15-minute English conversation micro-lesson.
Student level: ${LEVEL_GUIDE[level]}
${describeScene(ctx)}
Lesson title: ${outline.title}. Objectives: ${outline.objectives.join('; ')}.

Write in English, first person, as the teacher speaking to the class. Include what the teacher says to open the phase, the instructions, 2-3 model exchanges the teacher demonstrates, and how the teacher hands over to students. Mark short stage directions in square brackets, e.g. [point to the counter]. Target about ${phase.minutes * 120} words (between ${phase.minutes * 100} and ${phase.minutes * 150}).`,
    prompt: `Phase: ${phase.phase} (${phase.minutes} min). Activity: ${phase.activity}. Write the teacher script.`,
  }
}

export function buildModuleHintsPrompt(
  moduleLabel: string,
  taskLabels: string[],
  level: CefrLevel,
  examples: SceneContext['exampleTasks'],
): { systemInstruction: string; prompt: string } {
  return {
    systemInstruction: `You create 5-level scaffolding hints for English speaking tasks. Student level: ${LEVEL_GUIDE[level]}

For EACH task label you receive, output one object with exactly these fields:
- "label": copy the task label verbatim.
- "completeSentence": ONE natural English sentence the student says to accomplish the task.
- "keyStructure": the sentence skeleton with replaceable parts in [brackets], joined by " + ", e.g. "What + is + the price of + the + [color] + [item]?"
- "partialSentence": the complete sentence with 2-3 key words replaced by "_____".
- "unscramble": the words of "completeSentence" split on spaces, in a SHUFFLED order. Every token must appear exactly as it does in "completeSentence" (keep punctuation attached to the word). Same number of tokens.
- "extraPhrases": 2 or 3 alternative sentences with the same meaning.

Format examples from an existing module:
${describeExamples(examples)}

Return the tasks in the same order as the labels given.`,
    prompt: `Module: ${moduleLabel}\nTask labels:\n${taskLabels.map((l, i) => `${i + 1}. ${l}`).join('\n')}`,
  }
}

export function buildNotesPrompt(
  outline: { title: string; objectives: string[] },
  sentences: string[],
  level: CefrLevel,
): { systemInstruction: string; prompt: string } {
  return {
    systemInstruction: `You are an English teacher-trainer in Taiwan writing notes for a colleague who will teach a 15-minute conversation micro-lesson. Student level: ${LEVEL_GUIDE[level]}

Output:
- "grammarNotes": 2 to 4 items. "point" is the English name of the structure (e.g. "would like to + noun"), "explanation" is 1-3 sentences in Traditional Chinese explaining form and use for this level, "examples" are 2 English sentences taken from or close to the target sentences.
- "teachingNotes": 3 to 6 short bullets in Traditional Chinese: common student errors to listen for, pronunciation traps, pacing advice, and how to use the 3D scene roles.`,
    prompt: `Lesson: ${outline.title}\nObjectives: ${outline.objectives.join('; ')}\nTarget sentences students will say:\n${sentences.map(s => `- ${s}`).join('\n')}`,
  }
}
```

- [ ] **Step 2: 寫失敗測試**

```ts
// backend/src/ai/lessonPlan.test.ts
import { describe, it, expect, vi } from 'vitest'
import type { GeminiCallOptions, GeminiCallResult } from './client.js'
import type { SceneContext, TaskHint } from '../lessonPlanTypes.js'

const ctx: SceneContext = {
  sceneId: 'clothingStore_cashier', themeLabel: '服飾店', sceneLabel: '收銀台', sceneLabelEn: 'Cashier',
  slots: [{ id: 'cashier', label: '收銀員' }, { id: 'customer', label: '顧客' }],
  existingModuleLabels: ['Price'],
  exampleTasks: [{ label: 'Ask for the price of a blue T-shirt.', hint: {
    keyStructure: 'What + is + the price of + the + [color] + [item]?',
    partialSentence: 'What is the _____ of the _____ _____?',
    unscramble: ['What', 'the', 'T-shirt?', 'price', 'of', 'is', 'the', 'blue'],
    completeSentence: 'What is the price of the blue T-shirt?',
    extraPhrases: ['How much is the blue T-shirt?'],
  } }],
}

const outline = {
  title: '退換貨', objectives: ['能提出退貨'],
  timeline: [{ phase: '暖身', minutes: 5, activity: '問候' }, { phase: '練習', minutes: 10, activity: '角色扮演' }],
  modules: [{ label: 'Return', icon: '🔁', taskLabels: ['Ask to return a T-shirt.', 'Ask for a refund.'] }],
  sceneConstraint: 'Setting: returns.',
}

function goodHint(label: string, sentence: string) {
  const words = sentence.split(' ')
  return { label, keyStructure: 'K', partialSentence: 'P', unscramble: [...words].reverse(), completeSentence: sentence, extraPhrases: ['E'] }
}

/** 依 tag 回假資料的 caller；可用 overrides 改單一 tag 的行為 */
function fakeCaller(overrides: Partial<Record<string, (opts: GeminiCallOptions<unknown>) => unknown>> = {}) {
  const calls: GeminiCallOptions<unknown>[] = []
  const defaults: Record<string, (opts: GeminiCallOptions<unknown>) => unknown> = {
    '[ai/lesson/outline]': () => outline,
    '[ai/lesson/script]': () => ({ teacherScript: 'Hello class. ' + 'word '.repeat(600) }),
    '[ai/lesson/hints]': () => ({ tasks: [
      goodHint('Ask to return a T-shirt.', 'I would like to return this T-shirt.'),
      goodHint('Ask for a refund.', 'Can I get a refund?'),
    ] }),
    '[ai/lesson/notes]': () => ({ grammarNotes: [{ point: 'would like to', explanation: '禮貌', examples: ['x'] }], teachingNotes: ['慢慢說'] }),
  }
  const call = vi.fn(async <T,>(opts: GeminiCallOptions<T>): Promise<GeminiCallResult<T>> => {
    calls.push(opts as GeminiCallOptions<unknown>)
    const fn = overrides[opts.tag] ?? defaults[opts.tag]
    if (!fn) throw new Error('unexpected tag ' + opts.tag)
    // 走真實 parse，確保 schema 驗證邏輯也被測到
    const data = opts.parse(JSON.stringify(fn(opts as GeminiCallOptions<unknown>)))
    return { data, model: 'fake', usage: { prompt: 1, output: 1, total: 2 } }
  })
  return { call, calls }
}

const req = { sceneId: 'clothingStore_cashier', topic: '退換貨', level: 'A2' as const, sceneContext: ctx }

describe('generateLessonPlan', () => {
  it('assembles a full plan with prefixed ids', async () => {
    const { generateLessonPlan } = await import('./lessonPlan.js')
    const { call, calls } = fakeCaller()
    const plan = await generateLessonPlan(req, 'p1', { call })
    expect(plan.title).toBe('退換貨')
    expect(plan.level).toBe('A2')
    expect(plan.durationMin).toBe(15)
    expect(plan.sceneId).toBe('clothingStore_cashier')
    expect(plan.timeline).toHaveLength(2)
    expect(plan.timeline[0].teacherScript.startsWith('Hello class.')).toBe(true)
    expect(plan.modules[0].id).toBe('plan_p1_m1')
    expect(plan.modules[0].tasks.map(t => t.id)).toEqual(['plan_p1_1', 'plan_p1_2'])
    expect(plan.modules[0].tasks[1].hint.completeSentence).toBe('Can I get a refund?')
    expect(plan.grammarNotes[0].point).toBe('would like to')
    expect(plan.sceneConstraint).toBe('Setting: returns.')
    const tags = calls.map(c => c.tag)
    expect(tags.filter(t => t === '[ai/lesson/outline]')).toHaveLength(1)
    expect(tags.filter(t => t === '[ai/lesson/script]')).toHaveLength(2)
    expect(tags.filter(t => t === '[ai/lesson/hints]')).toHaveLength(1)
    expect(tags.filter(t => t === '[ai/lesson/notes]')).toHaveLength(1)
  })

  it('retries the outline once when minutes do not sum to 15, then throws', async () => {
    const { generateLessonPlan } = await import('./lessonPlan.js')
    const bad = { ...outline, timeline: [{ phase: 'a', minutes: 5, activity: 'x' }] }
    const { call, calls } = fakeCaller({ '[ai/lesson/outline]': () => bad })
    await expect(generateLessonPlan(req, 'p1', { call })).rejects.toThrow(/15/)
    expect(calls.filter(c => c.tag === '[ai/lesson/outline]')).toHaveLength(2)
  })

  it('accepts the outline on the second attempt', async () => {
    const { generateLessonPlan } = await import('./lessonPlan.js')
    let n = 0
    const { call } = fakeCaller({ '[ai/lesson/outline]': () => (n++ === 0 ? { ...outline, timeline: [] } : outline) })
    const plan = await generateLessonPlan(req, 'p1', { call })
    expect(plan.timeline).toHaveLength(2)
  })

  it('retries a module once on unscramble mismatch, then repairs from completeSentence', async () => {
    const { generateLessonPlan } = await import('./lessonPlan.js')
    const broken = { tasks: [
      { ...goodHint('Ask to return a T-shirt.', 'I would like to return this T-shirt.'), unscramble: ['wrong', 'words'] },
      goodHint('Ask for a refund.', 'Can I get a refund?'),
    ] }
    const { call, calls } = fakeCaller({ '[ai/lesson/hints]': () => broken })
    const plan = await generateLessonPlan(req, 'p1', { call })
    expect(calls.filter(c => c.tag === '[ai/lesson/hints]')).toHaveLength(2)
    const repaired = plan.modules[0].tasks[0].hint.unscramble
    expect([...repaired].sort()).toEqual('I would like to return this T-shirt.'.split(' ').sort())
  })

  it('fails the whole generation when a script call throws', async () => {
    const { generateLessonPlan } = await import('./lessonPlan.js')
    const { call } = fakeCaller({ '[ai/lesson/script]': () => { throw new Error('503 boom') } })
    await expect(generateLessonPlan(req, 'p1', { call })).rejects.toThrow('503 boom')
  })

  it('throws when a module returns fewer tasks than labels', async () => {
    const { generateLessonPlan } = await import('./lessonPlan.js')
    const { call } = fakeCaller({ '[ai/lesson/hints]': () => ({ tasks: [goodHint('Ask for a refund.', 'Can I get a refund?')] }) })
    await expect(generateLessonPlan(req, 'p1', { call })).rejects.toThrow(/task count/)
  })
})

describe('helpers', () => {
  it('unscrambleMatches compares token multisets', async () => {
    const { unscrambleMatches } = await import('./lessonPlan.js')
    const base: TaskHint = { keyStructure: '', partialSentence: '', unscramble: ['b', 'a', 'a'], completeSentence: 'a a b', extraPhrases: [] }
    expect(unscrambleMatches(base)).toBe(true)
    expect(unscrambleMatches({ ...base, unscramble: ['a', 'b'] })).toBe(false)
  })

  it('repairUnscramble keeps all tokens', async () => {
    const { repairUnscramble } = await import('./lessonPlan.js')
    expect([...repairUnscramble('Can I get a refund?')].sort()).toEqual(['Can', 'I', 'a', 'get', 'refund?'])
  })

  it('validateOutline rejects missing modules', async () => {
    const { validateOutline } = await import('./lessonPlan.js')
    expect(() => validateOutline({ ...outline, modules: [] })).toThrow(/module/)
  })
})
```

- [ ] **Step 3: 確認失敗**

Run: `cd backend && npx vitest run src/ai/lessonPlan.test.ts`
Expected: FAIL，找不到 `./lessonPlan.js`

- [ ] **Step 4: 實作 workflow**

```ts
// backend/src/ai/lessonPlan.ts
import { callGemini, type GeminiCallOptions, type GeminiCallResult } from './client.js'
import {
  OUTLINE_SCHEMA, SCRIPT_SCHEMA, MODULE_HINTS_SCHEMA, NOTES_SCHEMA,
  buildOutlinePrompt, buildScriptPrompt, buildModuleHintsPrompt, buildNotesPrompt,
} from './lessonPlanPrompts.js'
import type { CefrLevel, LessonPlan, LessonPlanModule, SceneContext, TaskHint, GrammarNote } from '../lessonPlanTypes.js'

export interface LessonPlanRequest {
  sceneId: string
  topic: string
  level: CefrLevel
  sceneContext: SceneContext
}

export interface OutlineDraft {
  title: string
  objectives: string[]
  timeline: { phase: string; minutes: number; activity: string }[]
  modules: { label: string; icon: string; taskLabels: string[] }[]
  sceneConstraint: string
}

export type GeminiCaller = <T>(opts: GeminiCallOptions<T>) => Promise<GeminiCallResult<T>>

interface DraftModule { label: string; icon: string; tasks: { label: string; hint: TaskHint }[] }

const TOTAL_MINUTES = 15

// ── 驗證與修復 ────────────────────────────────────────────────────────────────

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(x => typeof x === 'string')
}

/** 大綱結構檢查；分鐘總和錯或模組缺失都拋錯，呼叫端決定是否重試。 */
export function validateOutline(raw: unknown): OutlineDraft {
  const o = raw as Partial<OutlineDraft>
  if (!o || typeof o.title !== 'string' || !o.title.trim()) throw new Error('outline: title missing')
  if (!isStringArray(o.objectives) || o.objectives.length === 0) throw new Error('outline: objectives missing')
  if (!Array.isArray(o.timeline) || o.timeline.length === 0) throw new Error('outline: timeline minutes must sum to 15')
  const sum = o.timeline.reduce((acc, p) => acc + (typeof p.minutes === 'number' ? p.minutes : 0), 0)
  if (sum !== TOTAL_MINUTES) throw new Error(`outline: timeline minutes must sum to 15 (got ${sum})`)
  if (!Array.isArray(o.modules) || o.modules.length === 0) throw new Error('outline: modules missing')
  for (const m of o.modules) {
    if (typeof m.label !== 'string' || !isStringArray(m.taskLabels) || m.taskLabels.length === 0) throw new Error('outline: module malformed')
  }
  if (typeof o.sceneConstraint !== 'string' || !o.sceneConstraint.trim()) throw new Error('outline: sceneConstraint missing')
  return {
    title: o.title.trim(),
    objectives: o.objectives,
    timeline: o.timeline.map(p => ({ phase: String(p.phase), minutes: Number(p.minutes), activity: String(p.activity) })),
    modules: o.modules.map(m => ({ label: m.label, icon: typeof m.icon === 'string' && m.icon ? m.icon : '📘', taskLabels: m.taskLabels })),
    sceneConstraint: o.sceneConstraint.trim(),
  }
}

function tokens(sentence: string): string[] {
  return sentence.split(/\s+/).filter(Boolean)
}

export function unscrambleMatches(hint: TaskHint): boolean {
  const a = [...hint.unscramble].sort()
  const b = tokens(hint.completeSentence).sort()
  return a.length === b.length && a.every((w, i) => w === b[i])
}

/** Fisher-Yates 洗牌 completeSentence 的 token 當作重組題。 */
export function repairUnscramble(sentence: string): string[] {
  const words = tokens(sentence)
  for (let i = words.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [words[i], words[j]] = [words[j], words[i]]
  }
  return words
}

export function assignIds(planId: string, modules: DraftModule[]): LessonPlanModule[] {
  let n = 0
  return modules.map((m, k) => ({
    id: `plan_${planId}_m${k + 1}`,
    label: m.label,
    icon: m.icon,
    tasks: m.tasks.map(t => ({ id: `plan_${planId}_${++n}`, label: t.label, hint: t.hint })),
  }))
}

// ── 各步驟 ────────────────────────────────────────────────────────────────────

async function stepOutline(req: LessonPlanRequest, call: GeminiCaller, signal?: AbortSignal): Promise<OutlineDraft> {
  const { systemInstruction, prompt } = buildOutlinePrompt(req.topic, req.level, req.sceneContext)
  const run = () => call<OutlineDraft>({
    tag: '[ai/lesson/outline]', contents: prompt, systemInstruction,
    temperature: 0.5, maxOutputTokens: 2048, thinkingBudget: 1024,
    responseSchema: OUTLINE_SCHEMA, signal, parse: t => JSON.parse(t) as OutlineDraft,
  })
  try {
    return validateOutline((await run()).data)
  } catch (first) {
    console.warn('[ai/lesson/outline] invalid, retrying once:', first instanceof Error ? first.message : String(first))
    return validateOutline((await run()).data)
  }
}

async function stepScript(
  outline: OutlineDraft, phase: OutlineDraft['timeline'][number], req: LessonPlanRequest, call: GeminiCaller, signal?: AbortSignal,
): Promise<string> {
  const { systemInstruction, prompt } = buildScriptPrompt(outline, phase, req.level, req.sceneContext)
  const { data } = await call<{ teacherScript: string }>({
    tag: '[ai/lesson/script]', contents: prompt, systemInstruction,
    temperature: 0.7, maxOutputTokens: 1536, thinkingBudget: 0,
    responseSchema: SCRIPT_SCHEMA, signal,
    parse: t => {
      const p = JSON.parse(t) as { teacherScript?: unknown }
      if (typeof p.teacherScript !== 'string' || !p.teacherScript.trim()) throw new Error('teacherScript missing')
      return { teacherScript: p.teacherScript.trim() }
    },
  })
  const words = tokens(data.teacherScript).length
  if (words < phase.minutes * 100 || words > phase.minutes * 150) {
    console.warn(`[ai/lesson/script] "${phase.phase}" has ${words} words, expected ${phase.minutes * 100}-${phase.minutes * 150}`)
  }
  return data.teacherScript
}

interface RawHintTask extends TaskHint { label: string }

async function stepModuleHints(
  mod: OutlineDraft['modules'][number], req: LessonPlanRequest, call: GeminiCaller, signal?: AbortSignal,
): Promise<DraftModule> {
  const { systemInstruction, prompt } = buildModuleHintsPrompt(mod.label, mod.taskLabels, req.level, req.sceneContext.exampleTasks)
  const run = () => call<{ tasks: RawHintTask[] }>({
    tag: '[ai/lesson/hints]', contents: prompt, systemInstruction,
    temperature: 0.4, maxOutputTokens: 2048, thinkingBudget: 256,
    responseSchema: MODULE_HINTS_SCHEMA, signal,
    parse: t => {
      const p = JSON.parse(t) as { tasks?: unknown }
      if (!Array.isArray(p.tasks)) throw new Error('tasks missing')
      for (const task of p.tasks as Partial<RawHintTask>[]) {
        if (typeof task.completeSentence !== 'string' || !isStringArray(task.unscramble) ||
            typeof task.keyStructure !== 'string' || typeof task.partialSentence !== 'string' || !isStringArray(task.extraPhrases)) {
          throw new Error('hint task malformed')
        }
      }
      return p as { tasks: RawHintTask[] }
    },
  })
  const toDraft = (tasks: RawHintTask[]): DraftModule => {
    if (tasks.length !== mod.taskLabels.length) {
      throw new Error(`[ai/lesson/hints] task count mismatch for "${mod.label}": expected ${mod.taskLabels.length}, got ${tasks.length}`)
    }
    return {
      label: mod.label, icon: mod.icon,
      tasks: tasks.map((t, i) => ({
        label: mod.taskLabels[i],
        hint: { keyStructure: t.keyStructure, partialSentence: t.partialSentence, unscramble: t.unscramble, completeSentence: t.completeSentence, extraPhrases: t.extraPhrases },
      })),
    }
  }
  let draft = toDraft((await run()).data.tasks)
  if (draft.tasks.some(t => !unscrambleMatches(t.hint))) {
    console.warn(`[ai/lesson/hints] unscramble mismatch in "${mod.label}", retrying once`)
    draft = toDraft((await run()).data.tasks)
    for (const t of draft.tasks) {
      if (!unscrambleMatches(t.hint)) {
        console.warn(`[ai/lesson/hints] repairing unscramble for "${t.label}"`)
        t.hint.unscramble = repairUnscramble(t.hint.completeSentence)
      }
    }
  }
  return draft
}

async function stepNotes(
  outline: OutlineDraft, sentences: string[], req: LessonPlanRequest, call: GeminiCaller, signal?: AbortSignal,
): Promise<{ grammarNotes: GrammarNote[]; teachingNotes: string[] }> {
  const { systemInstruction, prompt } = buildNotesPrompt(outline, sentences, req.level)
  const { data } = await call<{ grammarNotes: GrammarNote[]; teachingNotes: string[] }>({
    tag: '[ai/lesson/notes]', contents: prompt, systemInstruction,
    temperature: 0.5, maxOutputTokens: 2048, thinkingBudget: 256,
    responseSchema: NOTES_SCHEMA, signal,
    parse: t => {
      const p = JSON.parse(t) as { grammarNotes?: unknown; teachingNotes?: unknown }
      if (!Array.isArray(p.grammarNotes) || !isStringArray(p.teachingNotes)) throw new Error('notes malformed')
      return p as { grammarNotes: GrammarNote[]; teachingNotes: string[] }
    },
  })
  return data
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

/**
 * 兩步結構化 workflow：大綱 → 並行展開（逐時段腳本、逐模組五階層提示、語法與注意點）。
 * 任一步驟拋錯即整體失敗；不做自主迴圈。
 */
export async function generateLessonPlan(
  req: LessonPlanRequest,
  planId: string,
  opts: { signal?: AbortSignal; call?: GeminiCaller } = {},
): Promise<LessonPlan> {
  const call: GeminiCaller = opts.call ?? callGemini
  const outline = await stepOutline(req, call, opts.signal)

  const [scripts, modules] = await Promise.all([
    Promise.all(outline.timeline.map(phase => stepScript(outline, phase, req, call, opts.signal))),
    Promise.all(outline.modules.map(mod => stepModuleHints(mod, req, call, opts.signal))),
  ])
  // notes 需要完整句，所以等 hints 完成後再跑（腳本與提示彼此仍是並行的）
  const sentences = modules.flatMap(m => m.tasks.map(t => t.hint.completeSentence))
  const notes = await stepNotes(outline, sentences, req, call, opts.signal)

  return {
    title: outline.title,
    sceneId: req.sceneId,
    topic: req.topic,
    level: req.level,
    durationMin: 15,
    objectives: outline.objectives,
    timeline: outline.timeline.map((p, i) => ({ ...p, teacherScript: scripts[i] })),
    grammarNotes: notes.grammarNotes,
    teachingNotes: notes.teachingNotes,
    sceneConstraint: outline.sceneConstraint,
    modules: assignIds(planId, modules),
  }
}
```

> 注意：spec 第 6 節寫「三類呼叫並行」，實作上 notes 需要提示的完整句作輸入，所以是「腳本 ∥ 提示」先並行，再跑 notes。這是 spec 的細化，不是偏離。

- [ ] **Step 5: 確認通過**

Run: `cd backend && npx vitest run src/ai/lessonPlan.test.ts && npx tsc --noEmit`
Expected: 9 passed、tsc 無錯

- [ ] **Step 6: Commit**

```bash
git add backend/src/ai/lessonPlanPrompts.ts backend/src/ai/lessonPlan.ts backend/src/ai/lessonPlan.test.ts
git commit -m "feat(ai): 教案兩步結構化生成 workflow（大綱 → 腳本/提示/筆記），含驗證與重組修復"
```

---

### Task 6: 教案 REST 端點與後端接線

**Files:**
- Create: `backend/src/lessonPlanRoutes.ts`
- Test: `backend/src/lessonPlanRoutes.test.ts`
- Modify: `backend/src/routes.ts`（`createRouter` 簽名與掛載）、`backend/src/standalone.ts`、`backend/src/dev.ts`、`.gitignore`

**Interfaces:**
- Consumes: `LessonPlanRepo`（Task 4）、`generateLessonPlan` / `LessonPlanRequest`（Task 5）
- Produces:
  ```ts
  export interface LessonPlanRouteDeps {
    repo: LessonPlanRepo | null                       // null = DB 不可用 → 全部回 503
    generate?: typeof generateLessonPlan              // 測試注入
    timeoutMs?: number                                // 預設 90_000
  }
  export function createLessonPlanRouter(deps: LessonPlanRouteDeps): Router
  // routes.ts
  export function createRouter(store: RoomStore, recording?: RecordingDeps, lessonPlans?: LessonPlanRouteDeps): Router
  ```
- HTTP 契約：
  - `POST /api/lesson-plans/generate` body `{ teacherUid, institutionId?, sceneId, sceneContext, topic, level }` → 201 `LessonPlanRecord`；400 欄位錯；502 生成失敗（body `{ error, step? }`）；504 逾時；503 無 DB
  - `GET /api/lesson-plans?teacherUid=` → 200 `LessonPlanSummary[]`；400 缺 teacherUid
  - `GET /api/lesson-plans/:id` → 200 `LessonPlanRecord`；404
  - `PATCH /api/lesson-plans/:id` body `{ title?, modules? }` → 200 `LessonPlanRecord`；400；404
  - `POST /api/lesson-plans/:id/delete` → 200 `{ success: true }`；404

- [ ] **Step 1: 寫失敗測試**

```ts
// backend/src/lessonPlanRoutes.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import { openDatabase } from './db/connection.js'
import { LessonPlanRepo } from './db/lessonPlanRepo.js'
import { createLessonPlanRouter, type LessonPlanRouteDeps } from './lessonPlanRoutes.js'
import type { LessonPlan } from './lessonPlanTypes.js'

const sceneContext = {
  sceneId: 'clothingStore_cashier', themeLabel: '服飾店', sceneLabel: '收銀台', sceneLabelEn: 'Cashier',
  slots: [{ id: 'cashier', label: '收銀員' }], existingModuleLabels: [], exampleTasks: [],
}

function fakePlan(planId: string): LessonPlan {
  return {
    title: 'T', sceneId: 'clothingStore_cashier', topic: 'returns', level: 'A1', durationMin: 15,
    objectives: ['o'], timeline: [{ phase: 'p', minutes: 15, activity: 'a', teacherScript: 's' }],
    grammarNotes: [], teachingNotes: [], sceneConstraint: 'c',
    modules: [{ id: `plan_${planId}_m1`, label: 'M', icon: '📘', tasks: [
      { id: `plan_${planId}_1`, label: 'Ask.', hint: { keyStructure: 'k', partialSentence: 'p', unscramble: ['Hi.'], completeSentence: 'Hi.', extraPhrases: [] } },
    ] }],
  }
}

function createApp(deps: LessonPlanRouteDeps) {
  const app = express()
  app.use(express.json())
  app.use('/api/lesson-plans', createLessonPlanRouter(deps))
  return app
}

const validBody = { teacherUid: 't1', institutionId: 'i1', sceneId: 'clothingStore_cashier', sceneContext, topic: 'returns', level: 'A1' }

describe('lesson plan routes', () => {
  let repo: LessonPlanRepo
  let generate: ReturnType<typeof vi.fn>
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    repo = new LessonPlanRepo(openDatabase(':memory:'))
    generate = vi.fn(async (_req: unknown, planId: string) => fakePlan(planId))
    app = createApp({ repo, generate: generate as unknown as LessonPlanRouteDeps['generate'] })
  })

  it('returns 503 for every endpoint when repo is null', async () => {
    const noDb = createApp({ repo: null })
    expect((await request(noDb).get('/api/lesson-plans?teacherUid=t1')).status).toBe(503)
    expect((await request(noDb).post('/api/lesson-plans/generate').send(validBody)).status).toBe(503)
  })

  it('generate validates the body', async () => {
    expect((await request(app).post('/api/lesson-plans/generate').send({ ...validBody, teacherUid: '' })).status).toBe(400)
    expect((await request(app).post('/api/lesson-plans/generate').send({ ...validBody, level: 'C2' })).status).toBe(400)
    expect((await request(app).post('/api/lesson-plans/generate').send({ ...validBody, topic: 'x'.repeat(201) })).status).toBe(400)
    expect((await request(app).post('/api/lesson-plans/generate').send({ ...validBody, sceneContext: null })).status).toBe(400)
    expect(generate).not.toHaveBeenCalled()
  })

  it('generate stores and returns the record', async () => {
    const res = await request(app).post('/api/lesson-plans/generate').send(validBody)
    expect(res.status).toBe(201)
    expect(res.body.teacherUid).toBe('t1')
    expect(res.body.institutionId).toBe('i1')
    expect(res.body.plan.title).toBe('T')
    expect(res.body.plan.modules[0].tasks[0].id).toBe(`plan_${res.body.id}_1`)
    expect(repo.get(res.body.id)).not.toBeNull()
    const [reqArg, planIdArg] = generate.mock.calls[0]
    expect(reqArg).toMatchObject({ sceneId: 'clothingStore_cashier', topic: 'returns', level: 'A1' })
    expect(planIdArg).toBe(res.body.id)
  })

  it('generate returns 502 with the error when generation fails, and stores nothing', async () => {
    generate.mockRejectedValueOnce(new Error('[ai/lesson/hints] task count mismatch'))
    const res = await request(app).post('/api/lesson-plans/generate').send(validBody)
    expect(res.status).toBe(502)
    expect(res.body.error).toContain('task count mismatch')
    expect(repo.list('t1')).toHaveLength(0)
  })

  it('generate returns 504 on timeout', async () => {
    generate.mockImplementationOnce((_r: unknown, _id: string, opts: { signal: AbortSignal }) =>
      new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(new Error('aborted')))))
    const slow = createApp({ repo, generate: generate as unknown as LessonPlanRouteDeps['generate'], timeoutMs: 20 })
    const res = await request(slow).post('/api/lesson-plans/generate').send(validBody)
    expect(res.status).toBe(504)
  })

  it('list requires teacherUid and returns summaries', async () => {
    expect((await request(app).get('/api/lesson-plans')).status).toBe(400)
    repo.create({ id: 'p1', teacherUid: 't1', plan: fakePlan('p1') })
    const res = await request(app).get('/api/lesson-plans?teacherUid=t1')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0]).not.toHaveProperty('plan')
  })

  it('get returns record or 404', async () => {
    repo.create({ id: 'p1', teacherUid: 't1', plan: fakePlan('p1') })
    expect((await request(app).get('/api/lesson-plans/p1')).body.plan.title).toBe('T')
    expect((await request(app).get('/api/lesson-plans/zzz')).status).toBe(404)
  })

  it('patch validates and updates', async () => {
    repo.create({ id: 'p1', teacherUid: 't1', plan: fakePlan('p1') })
    expect((await request(app).patch('/api/lesson-plans/p1').send({ title: 42 })).status).toBe(400)
    expect((await request(app).patch('/api/lesson-plans/p1').send({ modules: [{ id: 'm', label: 'M' }] })).status).toBe(400)
    const ok = await request(app).patch('/api/lesson-plans/p1').send({ title: 'Renamed', modules: [] })
    expect(ok.status).toBe(200)
    expect(ok.body.plan.title).toBe('Renamed')
    expect(repo.countTasks('p1')).toBe(0)
    expect((await request(app).patch('/api/lesson-plans/zzz').send({ title: 'x' })).status).toBe(404)
  })

  it('delete removes or 404', async () => {
    repo.create({ id: 'p1', teacherUid: 't1', plan: fakePlan('p1') })
    expect((await request(app).post('/api/lesson-plans/p1/delete')).status).toBe(200)
    expect(repo.get('p1')).toBeNull()
    expect((await request(app).post('/api/lesson-plans/p1/delete')).status).toBe(404)
  })
})
```

- [ ] **Step 2: 確認失敗**

Run: `cd backend && npx vitest run src/lessonPlanRoutes.test.ts`
Expected: FAIL，找不到 `./lessonPlanRoutes.js`

- [ ] **Step 3: 實作路由**

```ts
// backend/src/lessonPlanRoutes.ts
import { Router, type Request, type Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import type { LessonPlanRepo } from './db/lessonPlanRepo.js'
import { generateLessonPlan } from './ai/lessonPlan.js'
import { CEFR_LEVELS, type CefrLevel, type LessonPlanModule, type SceneContext, type TaskHint } from './lessonPlanTypes.js'

export interface LessonPlanRouteDeps {
  /** null 表示資料庫開啟失敗，所有端點回 503 */
  repo: LessonPlanRepo | null
  generate?: typeof generateLessonPlan
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 90_000
const MAX_TOPIC_LEN = 200

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(x => typeof x === 'string')
}

function isTaskHint(v: unknown): v is TaskHint {
  const h = v as Partial<TaskHint> | null
  return !!h && typeof h.keyStructure === 'string' && typeof h.partialSentence === 'string' &&
    isStringArray(h.unscramble) && typeof h.completeSentence === 'string' && isStringArray(h.extraPhrases)
}

function isModules(v: unknown): v is LessonPlanModule[] {
  if (!Array.isArray(v)) return false
  return v.every(m => m && typeof m.id === 'string' && typeof m.label === 'string' && typeof m.icon === 'string' &&
    Array.isArray(m.tasks) && m.tasks.every((t: Partial<LessonPlanModule['tasks'][number]>) =>
      t && typeof t.id === 'string' && typeof t.label === 'string' && isTaskHint(t.hint)))
}

function isSceneContext(v: unknown): v is SceneContext {
  const c = v as Partial<SceneContext> | null
  return !!c && typeof c.sceneId === 'string' && typeof c.themeLabel === 'string' && typeof c.sceneLabel === 'string' &&
    typeof c.sceneLabelEn === 'string' && Array.isArray(c.slots) && isStringArray(c.existingModuleLabels) &&
    Array.isArray(c.exampleTasks) && c.exampleTasks.every(e => e && typeof e.label === 'string' && isTaskHint(e.hint))
}

export function createLessonPlanRouter(deps: LessonPlanRouteDeps): Router {
  const router = Router()
  const generate = deps.generate ?? generateLessonPlan
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS

  // DB 不可用時整組端點降級，其他功能不受影響
  router.use((_req, res, next) => {
    if (!deps.repo) { res.status(503).json({ error: 'Lesson plan storage unavailable' }); return }
    next()
  })
  const repo = () => deps.repo!

  router.post('/generate', async (req: Request, res: Response) => {
    const body = req.body as {
      teacherUid?: unknown; institutionId?: unknown; sceneId?: unknown; sceneContext?: unknown; topic?: unknown; level?: unknown
    }
    if (typeof body.teacherUid !== 'string' || !body.teacherUid.trim()) { res.status(400).json({ error: 'teacherUid is required' }); return }
    if (typeof body.sceneId !== 'string' || !body.sceneId.trim()) { res.status(400).json({ error: 'sceneId is required' }); return }
    if (typeof body.topic !== 'string' || !body.topic.trim() || body.topic.length > MAX_TOPIC_LEN) {
      res.status(400).json({ error: `topic is required (max ${MAX_TOPIC_LEN} chars)` }); return
    }
    if (!CEFR_LEVELS.includes(body.level as CefrLevel)) { res.status(400).json({ error: 'level must be A1, A2 or B1' }); return }
    if (!isSceneContext(body.sceneContext)) { res.status(400).json({ error: 'sceneContext is malformed' }); return }
    const institutionId = typeof body.institutionId === 'string' && body.institutionId.trim() ? body.institutionId : null

    const planId = uuidv4()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const plan = await generate(
        { sceneId: body.sceneId, topic: body.topic.trim(), level: body.level as CefrLevel, sceneContext: body.sceneContext },
        planId,
        { signal: controller.signal },
      )
      const record = repo().create({ id: planId, teacherUid: body.teacherUid, institutionId, plan })
      res.status(201).json(record)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[lesson-plans/generate] error:', msg)
      if (controller.signal.aborted) { res.status(504).json({ error: 'Lesson plan generation timed out' }); return }
      const status = msg.includes('GEMINI_API_KEY') ? 500 : 502
      const step = msg.match(/\[ai\/lesson\/(\w+)\]/)?.[1]
      res.status(status).json({ error: msg, step })
    } finally {
      clearTimeout(timer)
    }
  })

  router.get('/', (req: Request, res: Response) => {
    const teacherUid = req.query.teacherUid
    if (typeof teacherUid !== 'string' || !teacherUid.trim()) { res.status(400).json({ error: 'teacherUid is required' }); return }
    res.json(repo().list(teacherUid))
  })

  router.get('/:id', (req: Request, res: Response) => {
    const record = repo().get(req.params.id as string)
    if (!record) { res.status(404).json({ error: 'Lesson plan not found' }); return }
    res.json(record)
  })

  router.patch('/:id', (req: Request, res: Response) => {
    const body = req.body as { title?: unknown; modules?: unknown }
    const patch: { title?: string; modules?: LessonPlanModule[] } = {}
    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || !body.title.trim()) { res.status(400).json({ error: 'title must be a non-empty string' }); return }
      patch.title = body.title.trim()
    }
    if (body.modules !== undefined) {
      if (!isModules(body.modules)) { res.status(400).json({ error: 'modules is malformed' }); return }
      patch.modules = body.modules
    }
    const record = repo().update(req.params.id as string, patch)
    if (!record) { res.status(404).json({ error: 'Lesson plan not found' }); return }
    res.json(record)
  })

  // 用 POST 而非 DELETE：CORS 與安全標頭的方法白名單只開 GET / POST / PATCH
  router.post('/:id/delete', (req: Request, res: Response) => {
    if (!repo().remove(req.params.id as string)) { res.status(404).json({ error: 'Lesson plan not found' }); return }
    res.json({ success: true })
  })

  return router
}
```

- [ ] **Step 4: 掛到 `createRouter` 並接線**

`backend/src/routes.ts`：

```ts
// 新增 import（檔案頂端）
import { createLessonPlanRouter, type LessonPlanRouteDeps } from './lessonPlanRoutes.js'

// createRouter 簽名改為
export function createRouter(store: RoomStore, recording?: RecordingDeps, lessonPlans?: LessonPlanRouteDeps): Router {
  const router = Router()
  router.use('/lesson-plans', createLessonPlanRouter(lessonPlans ?? { repo: null }))
  // ...其餘不變
```

`backend/src/standalone.ts`：在 `const roomAdmin = new RoomAdminService()` 之後、`app.use('/api', ...)` 之前加：

```ts
  // 教案資料庫：開啟失敗只停用教案端點（503），其他功能照常
  let lessonPlanRepo: LessonPlanRepo | null = null
  try {
    lessonPlanRepo = new LessonPlanRepo(openDatabase(path.join(DATA_DIR, 'livemr.sqlite')))
    console.log(`[db] lesson plans at ${path.join(DATA_DIR, 'livemr.sqlite')}`)
  } catch (err) {
    console.error('[db] failed to open lesson plan database, lesson plan endpoints disabled:', err instanceof Error ? err.message : String(err))
  }
```

並把 `app.use('/api', createRouter(store, { recordingStore, roomAdmin }))` 改成 `app.use('/api', createRouter(store, { recordingStore, roomAdmin }, { repo: lessonPlanRepo }))`。頂端加 import：

```ts
import { openDatabase } from './db/connection.js'
import { LessonPlanRepo } from './db/lessonPlanRepo.js'
```

`backend/src/dev.ts` 同樣處理，路徑改為：

```ts
import path from 'path'
import { openDatabase } from './db/connection.js'
import { LessonPlanRepo } from './db/lessonPlanRepo.js'
// ...
const dbPath = process.env.LIVEMR_DB_PATH || path.resolve(process.cwd(), '../data/livemr.sqlite')
let lessonPlanRepo: LessonPlanRepo | null = null
try { lessonPlanRepo = new LessonPlanRepo(openDatabase(dbPath)) }
catch (err) { console.error('[db] failed to open', dbPath, err) }
app.use('/api', createRouter(store, { recordingStore, roomAdmin }, { repo: lessonPlanRepo }))
```

`.gitignore` 加一行 `/data/`。

- [ ] **Step 5: 全部後端測試與型別**

Run: `cd backend && npx vitest run && npx tsc --noEmit`
Expected: 全部 passed、tsc 無錯（`routes.test.ts` 用兩個參數呼叫 `createRouter` 仍相容）

- [ ] **Step 6: 打包冒煙**

Run: `node scripts/build-launcher.mjs`（從專案根目錄）
Expected: 成功產出 `dist-launcher/LiveMR/app/standalone.bundle.cjs`；用 `grep -c "node:sqlite" dist-launcher/LiveMR/app/standalone.bundle.cjs` 確認 `require("node:sqlite")` 被保留為外部模組而非打包失敗。

- [ ] **Step 7: Commit**

```bash
git add backend/src/lessonPlanRoutes.ts backend/src/lessonPlanRoutes.test.ts backend/src/routes.ts backend/src/standalone.ts backend/src/dev.ts .gitignore
git commit -m "feat(api): 教案 REST 端點（generate/list/get/patch/delete）並接上 SQLite"
```

---

### Task 7: 手動品質 spike 腳本

**Files:**
- Create: `backend/scripts/lesson-plan-spike.mts`

**Interfaces:**
- Consumes: `generateLessonPlan`（Task 5）

- [ ] **Step 1: 寫腳本**

```ts
/**
 * 教案生成品質 spike：對 A1 / A2 / B1 各生成一份教案，寫到 scripts/out/ 供人工檢視。
 * 執行：  cd backend && NODE_OPTIONS=--use-system-ca npx tsx scripts/lesson-plan-spike.mts [topic]
 * 需求：  .env 內 GEMINI_API_KEY
 * 一次性評估腳本，不進自動測試。
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { generateLessonPlan } from '../src/ai/lessonPlan.js'
import type { CefrLevel, SceneContext } from '../src/lessonPlanTypes.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

const topic = process.argv[2] ?? '退換貨與退款'
const outDir = path.resolve(__dirname, 'out')
fs.mkdirSync(outDir, { recursive: true })

// 與 frontend/src/config/scenes.ts 的服飾店收銀台一致（手動同步，spike 用）
const sceneContext: SceneContext = {
  sceneId: 'clothingStore_cashier', themeLabel: '服飾店', sceneLabel: '收銀台', sceneLabelEn: 'Cashier',
  slots: [{ id: 'cashier', label: '收銀員' }, { id: 'customer', label: '顧客' }],
  existingModuleLabels: ['Price', 'Size', 'Color', 'Sale'],
  exampleTasks: [{
    label: 'Ask for the price of a blue T-shirt.',
    hint: {
      keyStructure: 'What + is + the price of + the + [color] + [item]?',
      partialSentence: 'What is the _____ of the _____ _____?',
      unscramble: ['What', 'the', 'T-shirt?', 'price', 'of', 'is', 'the', 'blue'],
      completeSentence: 'What is the price of the blue T-shirt?',
      extraPhrases: ['How much is the blue T-shirt?', 'How much does the blue T-shirt cost?'],
    },
  }],
}

for (const level of ['A1', 'A2', 'B1'] as CefrLevel[]) {
  const t0 = Date.now()
  try {
    const plan = await generateLessonPlan({ sceneId: sceneContext.sceneId, topic, level, sceneContext }, `spike${level}`)
    const file = path.join(outDir, `lesson-${level}.json`)
    fs.writeFileSync(file, JSON.stringify(plan, null, 2))
    const tasks = plan.modules.reduce((n, m) => n + m.tasks.length, 0)
    console.log(`${level}: ${((Date.now() - t0) / 1000).toFixed(1)}s, ${plan.timeline.length} phases, ${plan.modules.length} modules / ${tasks} tasks → ${file}`)
  } catch (err) {
    console.error(`${level}: FAILED after ${((Date.now() - t0) / 1000).toFixed(1)}s:`, err instanceof Error ? err.message : err)
  }
}
```

- [ ] **Step 2: 執行並人工檢視**

Run: `cd backend && NODE_OPTIONS=--use-system-ca npx tsx scripts/lesson-plan-spike.mts`
Expected: 三個等級各產出一個 JSON，終端顯示秒數。人工檢視重點：分鐘總和 15、任務 label 是英文祈使句、A1 句子明顯比 B1 短、中文欄位確實是中文、`unscramble` 與完整句對得上。若某等級品質明顯不對，調整 `lessonPlanPrompts.ts` 的對應 prompt 並重跑，不改測試。

- [ ] **Step 3: Commit**

```bash
echo "backend/scripts/out/" >> .gitignore
git add backend/scripts/lesson-plan-spike.mts .gitignore
git commit -m "chore(ai): 教案生成品質 spike 腳本（三等級人工檢視）"
```

---

### Task 8: 前端型別、API 封裝、場景脈絡、Markdown 匯出

**Files:**
- Create: `frontend/src/types/lessonPlan.ts`、`frontend/src/utils/lessonPlanClient.ts`、`frontend/src/utils/sceneContext.ts`、`frontend/src/utils/lessonPlanMarkdown.ts`
- Test: `frontend/src/utils/sceneContext.test.ts`、`frontend/src/utils/lessonPlanMarkdown.test.ts`

**Interfaces:**
- Consumes: `THEMES`（`config/scenes.ts`）、`TASK_HINTS` / `TaskHint`（`config/taskHints.ts`）
- Produces:
  ```ts
  // types/lessonPlan.ts — 與後端 lessonPlanTypes.ts 逐欄相同（TaskHint 用 config/taskHints.ts 的）
  export type CefrLevel = 'A1' | 'A2' | 'B1'
  export const CEFR_LEVELS: readonly { value: CefrLevel; label: string }[]
  export interface LessonPlanTask / LessonPlanModule / TimelinePhase / GrammarNote / LessonPlan / SceneContext / LessonPlanRecord / LessonPlanSummary
  export interface GenerateLessonPlanRequest { teacherUid: string; institutionId?: string; sceneId: string; sceneContext: SceneContext; topic: string; level: CefrLevel }
  // utils/lessonPlanClient.ts
  export async function generateLessonPlan(req: GenerateLessonPlanRequest): Promise<LessonPlanRecord>
  export async function listLessonPlans(teacherUid: string): Promise<LessonPlanSummary[]>
  export async function getLessonPlan(id: string): Promise<LessonPlanRecord>      // 404 → throw Error('not-found')
  export async function updateLessonPlan(id: string, patch: { title?: string; modules?: LessonPlanModule[] }): Promise<LessonPlanRecord>
  export async function deleteLessonPlan(id: string): Promise<void>
  // utils/sceneContext.ts
  export function buildSceneContext(sceneId: string): SceneContext | null
  // utils/lessonPlanMarkdown.ts
  export function lessonPlanToMarkdown(plan: LessonPlan): string
  ```

- [ ] **Step 1: 寫型別檔**

```ts
// frontend/src/types/lessonPlan.ts
import type { TaskHint } from '../config/taskHints.ts'

export type CefrLevel = 'A1' | 'A2' | 'B1'

export const CEFR_LEVELS: readonly { value: CefrLevel; label: string }[] = [
  { value: 'A1', label: 'A1：國小中低年級（入門）' },
  { value: 'A2', label: 'A2：國小高年級（初級）' },
  { value: 'B1', label: 'B1：國中（中級）' },
]

export interface LessonPlanTask {
  id: string
  label: string
  hint: TaskHint
}

export interface LessonPlanModule {
  id: string
  label: string
  icon: string
  tasks: LessonPlanTask[]
}

export interface TimelinePhase {
  phase: string
  minutes: number
  activity: string
  teacherScript: string
}

export interface GrammarNote {
  point: string
  explanation: string
  examples: string[]
}

export interface LessonPlan {
  title: string
  sceneId: string
  topic: string
  level: CefrLevel
  durationMin: 15
  objectives: string[]
  timeline: TimelinePhase[]
  grammarNotes: GrammarNote[]
  teachingNotes: string[]
  sceneConstraint: string
  modules: LessonPlanModule[]
}

export interface SceneContext {
  sceneId: string
  themeLabel: string
  sceneLabel: string
  sceneLabelEn: string
  slots: { id: string; label: string }[]
  existingModuleLabels: string[]
  exampleTasks: { label: string; hint: TaskHint }[]
}

export interface LessonPlanRecord {
  id: string
  teacherUid: string
  institutionId: string | null
  createdAt: string
  updatedAt: string
  plan: LessonPlan
}

export interface LessonPlanSummary {
  id: string
  title: string
  sceneId: string
  topic: string
  level: CefrLevel
  createdAt: string
  updatedAt: string
}

export interface GenerateLessonPlanRequest {
  teacherUid: string
  institutionId?: string
  sceneId: string
  sceneContext: SceneContext
  topic: string
  level: CefrLevel
}
```

- [ ] **Step 2: 寫 API 封裝**

```ts
// frontend/src/utils/lessonPlanClient.ts
import type { GenerateLessonPlanRequest, LessonPlanModule, LessonPlanRecord, LessonPlanSummary } from '../types/lessonPlan.ts'

const BASE = '/api/lesson-plans'
const GENERATE_TIMEOUT_MS = 100_000 // 比後端 90s 稍長，讓後端的 504 先到

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json() as { error?: string }
    if (body.error) return body.error
  } catch { /* not json */ }
  return `HTTP ${res.status}`
}

export async function generateLessonPlan(req: GenerateLessonPlanRequest): Promise<LessonPlanRecord> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(await readError(res))
    return res.json() as Promise<LessonPlanRecord>
  } finally {
    clearTimeout(timer)
  }
}

export async function listLessonPlans(teacherUid: string): Promise<LessonPlanSummary[]> {
  const res = await fetch(`${BASE}?teacherUid=${encodeURIComponent(teacherUid)}`)
  if (!res.ok) throw new Error(await readError(res))
  return res.json() as Promise<LessonPlanSummary[]>
}

export async function getLessonPlan(id: string): Promise<LessonPlanRecord> {
  const res = await fetch(`${BASE}/${encodeURIComponent(id)}`)
  if (res.status === 404) throw new Error('not-found')
  if (!res.ok) throw new Error(await readError(res))
  return res.json() as Promise<LessonPlanRecord>
}

export async function updateLessonPlan(
  id: string,
  patch: { title?: string; modules?: LessonPlanModule[] },
): Promise<LessonPlanRecord> {
  const res = await fetch(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(await readError(res))
  return res.json() as Promise<LessonPlanRecord>
}

export async function deleteLessonPlan(id: string): Promise<void> {
  const res = await fetch(`${BASE}/${encodeURIComponent(id)}/delete`, { method: 'POST' })
  if (!res.ok) throw new Error(await readError(res))
}

/** 把 API 錯誤轉成老師看得懂的文案 */
export function lessonPlanErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (msg.includes('GEMINI_API_KEY')) return 'Gemini 尚未設定 API 金鑰，請於後端 .env 設定 GEMINI_API_KEY'
  if (msg.includes('timed out') || msg.includes('abort')) return '教案生成逾時，請再試一次'
  if (msg.includes('storage unavailable')) return '教案資料庫無法使用，請檢查 data 資料夾權限'
  if (msg.includes('Failed to fetch')) return '無法連線後端服務'
  return `教案生成失敗：${msg}`
}
```

- [ ] **Step 3: 寫 sceneContext 失敗測試**

```ts
// frontend/src/utils/sceneContext.test.ts
import { describe, it, expect } from 'vitest'
import { buildSceneContext } from './sceneContext'

describe('buildSceneContext', () => {
  it('returns null for an unknown scene', () => {
    expect(buildSceneContext('nope')).toBeNull()
  })

  it('collects theme, scene, slots, module labels and hinted example tasks for the cashier scene', () => {
    const ctx = buildSceneContext('clothingStore_cashier')!
    expect(ctx.sceneId).toBe('clothingStore_cashier')
    expect(ctx.themeLabel).toBe('服飾店')
    expect(ctx.sceneLabel).toBe('收銀台')
    expect(ctx.sceneLabelEn).toBe('Cashier')
    expect(ctx.slots.map(s => s.id)).toEqual(['cashier', 'customer'])
    expect(ctx.existingModuleLabels).toContain('Price')
    expect(ctx.exampleTasks.length).toBeGreaterThan(0)
    expect(ctx.exampleTasks.length).toBeLessThanOrEqual(3)
    expect(ctx.exampleTasks[0].label).toBe('Ask for the price of a blue T-shirt.')
    expect(ctx.exampleTasks[0].hint.completeSentence).toBe('What is the price of the blue T-shirt?')
  })
})
```

- [ ] **Step 4: 確認失敗**

Run: `cd frontend && npx vitest run src/utils/sceneContext.test.ts`
Expected: FAIL，找不到模組

- [ ] **Step 5: 實作 sceneContext**

```ts
// frontend/src/utils/sceneContext.ts
import { THEMES } from '../config/scenes.ts'
import { TASK_HINTS } from '../config/taskHints.ts'
import type { SceneContext } from '../types/lessonPlan.ts'

const MAX_EXAMPLES = 3

/**
 * 從靜態 THEMES / TASK_HINTS 整理出生成教案所需的場景脈絡。
 * 後端不另存場景表，維持「編輯內容只改 THEMES」的原則。
 */
export function buildSceneContext(sceneId: string): SceneContext | null {
  for (const theme of THEMES) {
    const scene = theme.scenes.find(s => s.id === sceneId)
    if (!scene) continue
    const modules = scene.modules ?? []
    const exampleTasks: SceneContext['exampleTasks'] = []
    for (const mod of modules) {
      for (const task of mod.tasks) {
        const hint = TASK_HINTS[task.id]
        if (hint) exampleTasks.push({ label: task.label, hint })
        if (exampleTasks.length >= MAX_EXAMPLES) break
      }
      if (exampleTasks.length >= MAX_EXAMPLES) break
    }
    return {
      sceneId,
      themeLabel: theme.label,
      sceneLabel: scene.label,
      sceneLabelEn: scene.labelEn ?? scene.label,
      slots: (scene.slots ?? []).map(s => ({ id: s.id, label: s.label })),
      existingModuleLabels: modules.map(m => m.label),
      exampleTasks,
    }
  }
  return null
}
```

- [ ] **Step 6: 寫 Markdown 失敗測試**

```ts
// frontend/src/utils/lessonPlanMarkdown.test.ts
import { describe, it, expect } from 'vitest'
import { lessonPlanToMarkdown } from './lessonPlanMarkdown'
import type { LessonPlan } from '../types/lessonPlan'

const plan: LessonPlan = {
  title: '退換貨', sceneId: 'clothingStore_cashier', topic: '退換貨', level: 'A2', durationMin: 15,
  objectives: ['能提出退貨要求', '能詢問退款方式'],
  timeline: [
    { phase: '暖身', minutes: 3, activity: '問候', teacherScript: 'Hello everyone.' },
    { phase: '練習', minutes: 12, activity: '角色扮演', teacherScript: 'Now practice.' },
  ],
  grammarNotes: [{ point: 'would like to', explanation: '禮貌請求', examples: ['I would like to return this.'] }],
  teachingNotes: ['注意語速'],
  sceneConstraint: 'Setting: returns.',
  modules: [{ id: 'plan_p_m1', label: 'Return', icon: '🔁', tasks: [
    { id: 'plan_p_1', label: 'Ask to return a T-shirt.', hint: {
      keyStructure: 'I + would like to + return + [item]', partialSentence: 'I would like to _____ this T-shirt.',
      unscramble: ['return', 'I', 'to', 'like', 'would', 'this', 'T-shirt.'],
      completeSentence: 'I would like to return this T-shirt.', extraPhrases: ['Can I return this T-shirt?'],
    } },
  ] }],
}

describe('lessonPlanToMarkdown', () => {
  const md = lessonPlanToMarkdown(plan)

  it('starts with the title and metadata', () => {
    expect(md.startsWith('# 退換貨\n')).toBe(true)
    expect(md).toContain('A2')
    expect(md).toContain('15 分鐘')
  })

  it('renders objectives, timeline with scripts, grammar, notes and tasks', () => {
    expect(md).toContain('- 能提出退貨要求')
    expect(md).toContain('### 暖身（3 分鐘）')
    expect(md).toContain('Hello everyone.')
    expect(md).toContain('**would like to**')
    expect(md).toContain('- 注意語速')
    expect(md).toContain('### 🔁 Return')
    expect(md).toContain('1. Ask to return a T-shirt.')
    expect(md).toContain('I would like to return this T-shirt.')
  })

  it('does not include the sceneConstraint (internal AI text)', () => {
    expect(md).not.toContain('Setting: returns.')
  })
})
```

- [ ] **Step 7: 確認失敗**

Run: `cd frontend && npx vitest run src/utils/lessonPlanMarkdown.test.ts`
Expected: FAIL

- [ ] **Step 8: 實作 Markdown**

```ts
// frontend/src/utils/lessonPlanMarkdown.ts
import type { LessonPlan } from '../types/lessonPlan.ts'

/** 老師「複製為 Markdown」用；sceneConstraint 是給 AI 的內部文字，不輸出。 */
export function lessonPlanToMarkdown(plan: LessonPlan): string {
  const lines: string[] = []
  lines.push(`# ${plan.title}`)
  lines.push('')
  lines.push(`主題：${plan.topic}｜程度：${plan.level}｜時長：${plan.durationMin} 分鐘`)
  lines.push('')
  lines.push('## 學習目標')
  for (const o of plan.objectives) lines.push(`- ${o}`)
  lines.push('')
  lines.push('## 教學流程與逐字腳本')
  for (const p of plan.timeline) {
    lines.push(`### ${p.phase}（${p.minutes} 分鐘）`)
    lines.push(`活動：${p.activity}`)
    lines.push('')
    lines.push(p.teacherScript)
    lines.push('')
  }
  lines.push('## 語法說明')
  for (const g of plan.grammarNotes) {
    lines.push(`- **${g.point}**：${g.explanation}`)
    for (const ex of g.examples) lines.push(`  - ${ex}`)
  }
  lines.push('')
  lines.push('## 教學注意點')
  for (const n of plan.teachingNotes) lines.push(`- ${n}`)
  lines.push('')
  lines.push('## 任務包')
  for (const m of plan.modules) {
    lines.push(`### ${m.icon} ${m.label}`)
    m.tasks.forEach((t, i) => {
      lines.push(`${i + 1}. ${t.label}`)
      lines.push(`   - 完整句：${t.hint.completeSentence}`)
      lines.push(`   - 句型：${t.hint.keyStructure}`)
      lines.push(`   - 延伸：${t.hint.extraPhrases.join(' / ')}`)
    })
    lines.push('')
  }
  return lines.join('\n')
}
```

- [ ] **Step 9: 確認通過與型別**

Run: `cd frontend && npx vitest run src/utils && npx tsc -b`
Expected: 新增測試 passed、tsc 無錯

- [ ] **Step 10: Commit**

```bash
git add frontend/src/types/lessonPlan.ts frontend/src/utils/lessonPlanClient.ts frontend/src/utils/sceneContext.ts frontend/src/utils/sceneContext.test.ts frontend/src/utils/lessonPlanMarkdown.ts frontend/src/utils/lessonPlanMarkdown.test.ts
git commit -m "feat(front): 教案型別、API 封裝、場景脈絡整理與 Markdown 匯出"
```

---

### Task 9: `config/content.ts` 解析函式與 HostSession / BigScreen 接線

**Files:**
- Create: `frontend/src/config/content.ts`
- Test: `frontend/src/config/content.test.ts`
- Modify: `frontend/src/types/vrm.ts:102-105`（`TaskItem`）、`frontend/src/components/BigScreen.tsx:17-21`（`TaskEntry`）與 `:900`（提示查表）、`frontend/src/components/HostSession.tsx`（props、教案載入、四處 `SCENE_CONSTRAINTS`、三處 `TASK_HINTS`、任務庫、`toggleTaskSelection`）

**Interfaces:**
- Consumes: `LessonPlan` / `LessonPlanRecord`（Task 8）、`getLessonPlan`（Task 8）
- Produces:
  ```ts
  // config/content.ts
  export const PLAN_MODULE_PREFIX = '我的教案'
  export function resolveModules(staticModules: SceneModule[], plan: LessonPlan | null | undefined, sceneId: string): SceneModule[]
  export function resolveTaskHint(taskId: string, plan: LessonPlan | null | undefined): TaskHint | undefined
  export function resolveSceneConstraint(sceneId: string, plan: LessonPlan | null | undefined): string | undefined
  // types/vrm.ts
  export interface TaskItem { id: string; label: string; hint?: TaskHint }
  // BigScreen.tsx
  export interface TaskEntry { id: string; label: string; completed: boolean; hint?: TaskHint }
  // HostSession props
  interface HostSessionProps { roomId: string; livekitToken: string; hostToken: string; planId?: string }
  ```

- [ ] **Step 1: 寫失敗測試**

```ts
// frontend/src/config/content.test.ts
import { describe, it, expect } from 'vitest'
import { resolveModules, resolveTaskHint, resolveSceneConstraint, PLAN_MODULE_PREFIX } from './content'
import type { LessonPlan } from '../types/lessonPlan'
import type { SceneModule } from '../types/vrm'

const hint = { keyStructure: 'k', partialSentence: 'p', unscramble: ['Hi.'], completeSentence: 'Hi.', extraPhrases: [] }
const plan: LessonPlan = {
  title: '退換貨', sceneId: 'clothingStore_cashier', topic: 't', level: 'A1', durationMin: 15,
  objectives: [], timeline: [], grammarNotes: [], teachingNotes: [],
  sceneConstraint: 'PLAN CONSTRAINT',
  modules: [{ id: 'plan_p_m1', label: 'Return', icon: '🔁', tasks: [{ id: 'plan_p_1', label: 'Ask.', hint }] }],
}
const staticModules: SceneModule[] = [{ id: 'ask_price', label: 'Price', icon: '💰', tasks: [{ id: 'ask_price_1', label: 'Ask for the price of a blue T-shirt.' }] }]

describe('resolveModules', () => {
  it('returns static modules unchanged without a plan', () => {
    expect(resolveModules(staticModules, null, 'clothingStore_cashier')).toBe(staticModules)
  })

  it('prepends plan modules (with prefix and task hints) when the scene matches', () => {
    const out = resolveModules(staticModules, plan, 'clothingStore_cashier')
    expect(out).toHaveLength(2)
    expect(out[0].id).toBe('plan_p_m1')
    expect(out[0].label).toBe(`${PLAN_MODULE_PREFIX}：Return`)
    expect(out[0].tasks[0].hint).toEqual(hint)
    expect(out[1]).toBe(staticModules[0])
  })

  it('ignores the plan when a different scene is selected', () => {
    expect(resolveModules(staticModules, plan, 'otherScene')).toBe(staticModules)
  })
})

describe('resolveTaskHint', () => {
  it('finds plan task hints first, then falls back to TASK_HINTS', () => {
    expect(resolveTaskHint('plan_p_1', plan)).toEqual(hint)
    expect(resolveTaskHint('ask_price_1', plan)?.completeSentence).toBe('What is the price of the blue T-shirt?')
    expect(resolveTaskHint('ask_price_1', null)?.completeSentence).toBe('What is the price of the blue T-shirt?')
    expect(resolveTaskHint('unknown', plan)).toBeUndefined()
  })
})

describe('resolveSceneConstraint', () => {
  it('uses the plan constraint only when the scene matches', () => {
    expect(resolveSceneConstraint('clothingStore_cashier', plan)).toBe('PLAN CONSTRAINT')
    expect(resolveSceneConstraint('clothingStore_cashier', null)).toContain('clothing store checkout')
    expect(resolveSceneConstraint('otherScene', plan)).toBeUndefined()
  })
})
```

- [ ] **Step 2: 確認失敗**

Run: `cd frontend && npx vitest run src/config/content.test.ts`
Expected: FAIL

- [ ] **Step 3: 型別與 content.ts**

`frontend/src/types/vrm.ts` 的 `TaskItem` 改為：

```ts
import type { TaskHint } from '../config/taskHints';

export interface TaskItem {
  id: string;
  label: string; // e.g. "Ask for the price of a blue T-shirt."
  /** AI 教案任務自帶五階層提示；靜態任務留空、改查 TASK_HINTS */
  hint?: TaskHint;
}
```

（`taskHints.ts` 只 import 型別、不 import `vrm.ts`，不會形成循環。）

`frontend/src/components/BigScreen.tsx` 的 `TaskEntry` 加同樣的 `hint?: TaskHint;`，並把第 900 行附近的

```ts
const hint = TASK_HINTS[currentTask.id];
```

改成

```ts
const hint = currentTask.hint ?? TASK_HINTS[currentTask.id];
```

新增：

```ts
// frontend/src/config/content.ts
import { TASK_HINTS } from './taskHints.ts'
import type { TaskHint } from './taskHints.ts'
import { SCENE_CONSTRAINTS } from './aiAssistant.ts'
import type { SceneModule } from '../types/vrm.ts'
import type { LessonPlan } from '../types/lessonPlan.ts'

export const PLAN_MODULE_PREFIX = '我的教案'

/**
 * 任務庫：所選場景與教案相符時，教案模組插在靜態模組之前並冠上「我的教案」；
 * 否則原樣回傳靜態模組（回傳同一個陣列參考，方便 memo）。
 */
export function resolveModules(
  staticModules: SceneModule[],
  plan: LessonPlan | null | undefined,
  sceneId: string,
): SceneModule[] {
  if (!plan || plan.sceneId !== sceneId) return staticModules
  const planModules: SceneModule[] = plan.modules.map(m => ({
    id: m.id,
    label: `${PLAN_MODULE_PREFIX}：${m.label}`,
    icon: m.icon,
    tasks: m.tasks.map(t => ({ id: t.id, label: t.label, hint: t.hint })),
  }))
  return [...planModules, ...staticModules]
}

/** 先查教案任務，再查靜態 TASK_HINTS。 */
export function resolveTaskHint(taskId: string, plan: LessonPlan | null | undefined): TaskHint | undefined {
  if (plan) {
    for (const m of plan.modules) {
      const t = m.tasks.find(x => x.id === taskId)
      if (t) return t.hint
    }
  }
  return TASK_HINTS[taskId]
}

/** 教案存在且場景相符 → 用教案的 sceneConstraint；否則用靜態 SCENE_CONSTRAINTS。 */
export function resolveSceneConstraint(sceneId: string, plan: LessonPlan | null | undefined): string | undefined {
  if (plan && plan.sceneId === sceneId) return plan.sceneConstraint
  return SCENE_CONSTRAINTS[sceneId]
}
```

- [ ] **Step 4: 確認通過**

Run: `cd frontend && npx vitest run src/config/content.test.ts`
Expected: 7 passed

- [ ] **Step 5: HostSession 接線**

依序修改 `frontend/src/components/HostSession.tsx`：

1. import 區：把 `import { TASK_HINTS, HINT_LEVELS, hintLevelMeta } from '../config/taskHints.ts';` 改成 `import { HINT_LEVELS, hintLevelMeta } from '../config/taskHints.ts';`，把 `import { SCENE_CONSTRAINTS, shuffleWords, buildHintsSystemInstruction }` 改成 `import { shuffleWords, buildHintsSystemInstruction }`，新增：

```ts
import type { TaskHint } from '../config/taskHints.ts';
import { resolveModules, resolveTaskHint, resolveSceneConstraint } from '../config/content.ts';
import { getLessonPlan } from '../utils/lessonPlanClient.ts';
import type { LessonPlanRecord } from '../types/lessonPlan.ts';
```

2. `HostSessionProps` 加 `planId?: string;`，元件簽名解構出 `planId`。

3. 在 `const [selectedSceneId, setSelectedSceneId] = useState<string>(...)` 之後加教案狀態與載入：

```ts
  // ─── 備課教案（可選）────────────────────────────────────────────────────
  const [lessonPlan, setLessonPlan] = useState<LessonPlanRecord | null>(null);
  const [lessonPlanNotice, setLessonPlanNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!planId) return;
    let cancelled = false;
    getLessonPlan(planId)
      .then(rec => {
        if (cancelled) return;
        setLessonPlan(rec);
        if (rec.plan.sceneId !== selectedSceneId) {
          if (SCENE_PRESETS[rec.plan.sceneId]) handleSceneChange(rec.plan.sceneId);
          else setLessonPlanNotice('此教案的場景已移除，僅能使用靜態任務');
        }
      })
      .catch(err => {
        if (cancelled) return;
        setLessonPlanNotice(err instanceof Error && err.message === 'not-found' ? '教案已被刪除，改用無教案模式' : '教案載入失敗，改用無教案模式');
      });
    return () => { cancelled = true; };
    // 只在掛載時載入一次；handleSceneChange 在下方以 useCallback 定義，這裡透過 ref 或 eslint-disable 處理相依
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);
  const sceneConstraint = useMemo(
    () => resolveSceneConstraint(selectedSceneId, lessonPlan?.plan),
    [selectedSceneId, lessonPlan],
  );
```

> `handleSceneChange` 定義在此 effect 之後（第 1139 行附近）。把這段 effect 放在 `handleSceneChange` 定義之後，就不需要 ref；若檔案結構讓它非得放前面，用 `const handleSceneChangeRef = useRef(handleSceneChange)` 並在每次 render 更新。

4. 四處 `SCENE_CONSTRAINTS[...]`：
   - 第 794 行 `const constraint = SCENE_CONSTRAINTS[selectedSceneId];` → `const constraint = sceneConstraint;`
   - 第 910 行 `if (!sttSupported || !SCENE_CONSTRAINTS[selectedSceneId]) return;` → `if (!sttSupported || !sceneConstraint) return;`
   - 第 984 行 `!SCENE_CONSTRAINTS[spacebarSceneIdRef.current]` → `!resolveSceneConstraint(spacebarSceneIdRef.current, lessonPlan?.plan)`
   - 第 1039 行 `if (!SCENE_CONSTRAINTS[selectedSceneId]) return;` → `if (!sceneConstraint) return;`
   - 第 2414 行 `const hasConstraint = !!SCENE_CONSTRAINTS[selectedSceneId];` → `const hasConstraint = !!sceneConstraint;`
   每處所在的 `useCallback` 相依陣列補上 `sceneConstraint`（第 984 行那處補 `lessonPlan`）。

5. 三處 `TASK_HINTS[...]`：
   - 第 809 行 `TASK_HINTS[currentTask.id]?.completeSentence` → `resolveTaskHint(currentTask.id, lessonPlan?.plan)?.completeSentence`
   - 第 811 行同樣改 `nextTask`
   - 第 2401 行 `const hint = currentTask ? TASK_HINTS[currentTask.id] : undefined;` → `const hint = currentTask ? resolveTaskHint(currentTask.id, lessonPlan?.plan) : undefined;`
   第 874 行的相依陣列補 `lessonPlan`。

6. 任務庫：第 1897 行改為

```ts
  const taskBankModules = useMemo(
    () => resolveModules(currentScenePreset.modules ?? [], lessonPlan?.plan, selectedSceneId),
    [currentScenePreset, lessonPlan, selectedSceneId],
  );
  const hasModules = taskBankModules.length > 0;
```

   第 3121 行 `currentScenePreset.modules!.map((mod) => (` → `taskBankModules.map((mod) => (`；第 3143 行 `onClick={() => toggleTaskSelection(task.id, task.label)}` → `onClick={() => toggleTaskSelection(task.id, task.label, task.hint)}`。

7. `toggleTaskSelection`（第 1318 行）簽名改 `(taskId: string, label: string, hint?: TaskHint)`，新增項目改 `{ id: taskId, label, completed: false, ...(hint ? { hint } : {}) }`。

8. 在右側面板 AI 錯誤訊息旁（`aiError` 顯示處，用 `grep -n "aiError &&"` 找）加一行：

```tsx
{lessonPlanNotice && <div className="hs-ai-error">{lessonPlanNotice}</div>}
```

   另外在任務庫標題 `<span>任務庫</span>` 後面加：

```tsx
{lessonPlan && lessonPlan.plan.sceneId === selectedSceneId && (
  <span className="task-bank-plan-tag">{lessonPlan.plan.title}</span>
)}
```

   並在 `HostSession.css` 加：

```css
.task-bank-plan-tag { margin-left: 8px; padding: 2px 8px; border-radius: 999px; background: #E0F2F1; color: #00695C; font-size: 12px; }
```

- [ ] **Step 6: 型別、lint、既有測試**

Run: `cd frontend && npx tsc -b && npx eslint src/components/HostSession.tsx src/components/BigScreen.tsx src/config/content.ts && npx vitest run`
Expected: 全綠。tsc 會抓出任何漏改的 `TASK_HINTS` / `SCENE_CONSTRAINTS` 引用（因為 import 已移除）。

- [ ] **Step 7: 手動驗證（無教案路徑不退化）**

Run: `cd backend && npm run dev`（另一終端 `cd frontend && npm run dev`），老師登入、建房、開大屏、選任務、切提示階層、按空白鍵觸發 AI 提示。
Expected: 行為與改動前完全相同；大屏提示欄照常顯示 `TASK_HINTS`。

- [ ] **Step 8: Commit**

```bash
git add frontend/src/config/content.ts frontend/src/config/content.test.ts frontend/src/types/vrm.ts frontend/src/components/BigScreen.tsx frontend/src/components/HostSession.tsx frontend/src/components/HostSession.css
git commit -m "feat(host): 任務庫、提示與場景約束改為先查教案再查靜態設定；HostSession 可載入 planId"
```

---

### Task 10: 狀態機、App 分流與 `TeacherHome`

**Files:**
- Modify: `frontend/src/state.ts`、`frontend/src/state.test.ts`、`frontend/src/App.tsx`
- Create: `frontend/src/components/TeacherHome.tsx`、`frontend/src/components/TeacherHome.css`

**Interfaces:**
- Consumes: `listLessonPlans`（Task 8）、`HostSession.planId`（Task 9）
- Produces:
  ```ts
  // state.ts
  export type AppState =
    | { screen: 'select-role' }
    | { screen: 'teacher-home' }
    | { screen: 'lesson-prep' }
    | { screen: 'host-lobby'; roomId; hostToken; livekitToken; planId?: string }
    | { screen: 'host-session'; roomId; hostToken; livekitToken; planId?: string }
    | ...（其餘不變）
  export type AuthRoute = { action: 'teacher-home' } | { action: 'auto-join'; roomId: string } | { action: 'student-home' }
  // TeacherHome props
  interface TeacherHomeProps { teacherName: string; teacherUid: string; onPrep: () => void; onStart: (planId?: string) => void; onLogout: () => void }
  ```

- [ ] **Step 1: 改 state 測試（先紅）**

`frontend/src/state.test.ts` 把三個 `{ action: 'host' }` 期望值全改成 `{ action: 'teacher-home' }`，並把第一個案例名稱改成 `'routes teacher to teacher-home regardless of pendingRoomId'`。

Run: `cd frontend && npx vitest run src/state.test.ts`
Expected: FAIL（仍回 `host`）

- [ ] **Step 2: 改 state.ts**

```ts
// frontend/src/state.ts
import type { UserRole } from './hooks/useAuth.ts';

export type AppState =
  | { screen: 'select-role' }
  | { screen: 'teacher-home' }
  | { screen: 'lesson-prep' }
  | { screen: 'host-lobby'; roomId: string; hostToken: string; livekitToken: string; planId?: string }
  | { screen: 'host-session'; roomId: string; hostToken: string; livekitToken: string; planId?: string }
  | { screen: 'student-home' }
  | { screen: 'student-joining'; roomId: string }
  | { screen: 'student-waiting'; roomId: string; requestId: string; name: string }
  | { screen: 'student-session'; roomId: string; token: string; name: string }
  | { screen: 'student-rejected'; roomId: string }
  | { screen: 'error'; message: string };

export type AuthRoute =
  | { action: 'teacher-home' }
  | { action: 'auto-join'; roomId: string }
  | { action: 'student-home' };

const STUDENT_LIKE_ROLES: ReadonlySet<UserRole> = new Set(['student', 'visitor']);

/**
 * 登入成功、或開機時偵測到既有 session 後，依 role 決定下一步畫面。
 * 老師/管理員進老師主畫面（備課 / 開始上課），忽略 pendingRoomId；學生/訪客若帶著
 * 外部連結的房號就直接自動加入，否則進房間選擇畫面（手動輸入房號或掃 QR）。
 */
export function resolveAuthRoute(role: UserRole, pendingRoomId: string | null): AuthRoute {
  if (!STUDENT_LIKE_ROLES.has(role)) {
    return { action: 'teacher-home' };
  }
  return pendingRoomId ? { action: 'auto-join', roomId: pendingRoomId } : { action: 'student-home' };
}
```

Run: `cd frontend && npx vitest run src/state.test.ts`
Expected: PASS

- [ ] **Step 3: 寫 `TeacherHome`**

```tsx
// frontend/src/components/TeacherHome.tsx
import { useEffect, useState } from 'react';
import { listLessonPlans } from '../utils/lessonPlanClient.ts';
import type { LessonPlanSummary } from '../types/lessonPlan.ts';
import './TeacherHome.css';

interface TeacherHomeProps {
  teacherName: string;
  teacherUid: string;
  onPrep: () => void;
  /** planId 為 undefined 表示不帶教案上課 */
  onStart: (planId?: string) => void;
  onLogout: () => void;
}

export default function TeacherHome({ teacherName, teacherUid, onPrep, onStart, onLogout }: TeacherHomeProps) {
  const [plans, setPlans] = useState<LessonPlanSummary[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listLessonPlans(teacherUid)
      .then(list => { if (!cancelled) setPlans(list); })
      .catch(() => { if (!cancelled) setLoadError('無法載入教案清單，仍可直接開始上課'); });
    return () => { cancelled = true; };
  }, [teacherUid]);

  const handleStart = () => {
    if (starting) return;
    setStarting(true);
    onStart(selectedPlanId || undefined);
  };

  return (
    <div className="teacher-home-screen">
      <button className="teacher-home-logout-btn" onClick={onLogout}>
        <span className="material-symbols-outlined">logout</span> 登出
      </button>
      <div className="teacher-home-container">
        <h1 className="teacher-home-title">
          <span className="title-orange">Live</span> <span className="title-teal">MR</span>
        </h1>
        <p className="teacher-home-greeting">{teacherName} 老師，今天要做什麼？</p>

        <div className="teacher-home-cards">
          <button className="teacher-home-card" onClick={onPrep}>
            <span className="material-symbols-outlined teacher-home-card-icon">edit_note</span>
            <span className="teacher-home-card-title">備課</span>
            <span className="teacher-home-card-desc">一鍵生成 15 分鐘微教案與任務包</span>
          </button>

          <div className="teacher-home-card teacher-home-card-static">
            <span className="material-symbols-outlined teacher-home-card-icon">play_circle</span>
            <span className="teacher-home-card-title">開始上課</span>
            <select
              className="teacher-home-select"
              value={selectedPlanId}
              onChange={e => setSelectedPlanId(e.target.value)}
            >
              <option value="">不使用教案</option>
              {plans.map(p => (
                <option key={p.id} value={p.id}>{p.title}（{p.level}）</option>
              ))}
            </select>
            {loadError && <span className="teacher-home-error">{loadError}</span>}
            <button className="teacher-home-start-btn" onClick={handleStart} disabled={starting}>
              {starting ? '建立房間中…' : '建立房間'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

```css
/* frontend/src/components/TeacherHome.css */
.teacher-home-screen {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  padding: 24px;
  background: #FAFAF8;
}
.teacher-home-logout-btn {
  position: absolute; top: 20px; right: 20px;
  display: flex; align-items: center; gap: 6px;
  border: none; background: transparent; color: #6B7280; font-size: 14px; cursor: pointer;
}
.teacher-home-container { width: 100%; max-width: 720px; text-align: center; }
.teacher-home-title { font-size: 40px; margin: 0 0 8px; }
.teacher-home-greeting { color: #6B7280; margin: 0 0 32px; }
.teacher-home-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
@media (max-width: 640px) { .teacher-home-cards { grid-template-columns: 1fr; } }
.teacher-home-card {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 32px 20px; border-radius: 16px; border: 1px solid #E5E7EB; background: #fff;
  cursor: pointer; font: inherit; color: inherit; transition: box-shadow .15s, transform .15s;
}
.teacher-home-card:hover { box-shadow: 0 6px 20px rgba(0,0,0,.08); transform: translateY(-2px); }
.teacher-home-card-static { cursor: default; }
.teacher-home-card-static:hover { transform: none; }
.teacher-home-card-icon { font-size: 44px; color: #00897B; }
.teacher-home-card-title { font-size: 20px; font-weight: 600; }
.teacher-home-card-desc { font-size: 13px; color: #6B7280; }
.teacher-home-select { width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid #D1D5DB; font: inherit; }
.teacher-home-start-btn {
  width: 100%; padding: 10px; border: none; border-radius: 8px;
  background: #FF7043; color: #fff; font: inherit; font-weight: 600; cursor: pointer;
}
.teacher-home-start-btn:disabled { opacity: .6; cursor: default; }
.teacher-home-error { font-size: 12px; color: #B91C1C; }
```

- [ ] **Step 4: 改 App.tsx**

1. lazy import 區加：

```ts
const TeacherHome = lazy(() => import('./components/TeacherHome.tsx'));
const LessonPrep = lazy(() => import('./components/LessonPrep.tsx'));
```

（`LessonPrep` 在 Task 11 建立；本任務先建一個最小占位檔讓 tsc 過：`export default function LessonPrep(_: { teacherUid: string; institutionId?: string; onBack: () => void }) { return null; }`，Task 11 覆蓋。）

2. 在 `displayNameOf` 旁加：

```ts
/** SDGs 帳號的穩定識別；後端只用它分組教案。 */
function teacherUidOf(user: AuthUser): string {
  return (typeof user.uid === 'string' && user.uid) || (typeof user.id === 'string' && user.id) || user.email || 'unknown';
}
```

3. `handleHost` 改成可帶 `planId`：

```ts
  const handleHost = async (planId?: string) => {
    try {
      const { roomId, hostToken, livekitToken } = await createRoom();
      setState({ screen: 'host-session', roomId, hostToken, livekitToken, ...(planId ? { planId } : {}) });
    } catch (err) {
      setState({ screen: 'error', message: String(err) });
    }
  };
```

4. `routeUser` 的 `if (route.action === 'host') { void handleHost(); }` 改成 `if (route.action === 'teacher-home') { setState({ screen: 'teacher-home' }); }`，並更新上方註解為「teacher / admin / institution_admin → teacher-home（備課 / 開始上課）」。

5. 持久化 effect 的不持久化清單加入 `'teacher-home'` 與 `'lesson-prep'`（refresh 後靠開機 `routeUser` 回到 `teacher-home`）。

6. `renderScreen` 加兩個 case（放在 `'select-role'` 之後）：

```tsx
      case 'teacher-home':
        return (
          <TeacherHome
            teacherName={user ? displayNameOf(user) : '老師'}
            teacherUid={user ? teacherUidOf(user) : 'unknown'}
            onPrep={() => setState({ screen: 'lesson-prep' })}
            onStart={(planId) => { void handleHost(planId); }}
            onLogout={() => { void logout(); setState({ screen: 'select-role' }); }}
          />
        );

      case 'lesson-prep':
        return (
          <LessonPrep
            teacherUid={user ? teacherUidOf(user) : 'unknown'}
            institutionId={user?.institution_id != null ? String(user.institution_id) : undefined}
            onBack={() => setState({ screen: 'teacher-home' })}
          />
        );
```

7. `'host-lobby'` 的 `onStart` 與 `'host-session'` 的 `<HostSession ... />` 都把 `planId={state.planId}` 傳下去（`host-lobby` 的 `setState` 也帶 `planId: state.planId`）。

- [ ] **Step 5: 型別與測試**

Run: `cd frontend && npx tsc -b && npx vitest run`
Expected: 全綠

- [ ] **Step 6: 手動驗證**

老師登入 → 應看到 `TeacherHome`；選「不使用教案」建立房間 → 進 `host-session` 與以前相同；登出 → 回登入表單；重新整理 `teacher-home` → 自動回到 `teacher-home`。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/state.ts frontend/src/state.test.ts frontend/src/App.tsx frontend/src/components/TeacherHome.tsx frontend/src/components/TeacherHome.css frontend/src/components/LessonPrep.tsx
git commit -m "feat(front): 老師登入後進 TeacherHome（備課 / 開始上課），host-session 可帶 planId"
```

---

### Task 11: 備課畫面（`LessonPrep`、`LessonPlanView`、編輯 reducer）

**Files:**
- Create: `frontend/src/utils/lessonPlanEdit.ts`、`frontend/src/components/LessonPrep.tsx`（覆蓋 Task 10 的占位）、`frontend/src/components/LessonPrep.css`、`frontend/src/components/LessonPlanView.tsx`
- Test: `frontend/src/utils/lessonPlanEdit.test.ts`

**Interfaces:**
- Consumes: Task 8 全部（型別、client、`buildSceneContext`、`lessonPlanToMarkdown`）、`THEMES`、`CEFR_LEVELS`
- Produces:
  ```ts
  // utils/lessonPlanEdit.ts
  export type EditAction =
    | { type: 'set-title'; title: string }
    | { type: 'edit-task-label'; taskId: string; label: string }
    | { type: 'delete-task'; taskId: string }
    | { type: 'reset'; plan: LessonPlan }
  export interface EditState { title: string; modules: LessonPlanModule[]; dirty: boolean }
  export function initEditState(plan: LessonPlan): EditState
  export function editReducer(state: EditState, action: EditAction): EditState
  // components
  export default function LessonPrep(props: { teacherUid: string; institutionId?: string; onBack: () => void })
  export default function LessonPlanView(props: { record: LessonPlanRecord; onSaved: (rec: LessonPlanRecord) => void; onBack: () => void })
  ```

- [ ] **Step 1: 寫 reducer 失敗測試**

```ts
// frontend/src/utils/lessonPlanEdit.test.ts
import { describe, it, expect } from 'vitest'
import { initEditState, editReducer } from './lessonPlanEdit'
import type { LessonPlan } from '../types/lessonPlan'

const hint = { keyStructure: 'k', partialSentence: 'p', unscramble: ['Hi.'], completeSentence: 'Hi.', extraPhrases: [] }
const plan: LessonPlan = {
  title: 'T', sceneId: 's', topic: 't', level: 'A1', durationMin: 15,
  objectives: [], timeline: [], grammarNotes: [], teachingNotes: [], sceneConstraint: 'c',
  modules: [
    { id: 'm1', label: 'M1', icon: '📘', tasks: [{ id: 't1', label: 'One.', hint }, { id: 't2', label: 'Two.', hint }] },
    { id: 'm2', label: 'M2', icon: '📗', tasks: [{ id: 't3', label: 'Three.', hint }] },
  ],
}

describe('editReducer', () => {
  it('starts clean from the plan', () => {
    const s = initEditState(plan)
    expect(s.title).toBe('T')
    expect(s.modules).toHaveLength(2)
    expect(s.dirty).toBe(false)
  })

  it('set-title marks dirty', () => {
    const s = editReducer(initEditState(plan), { type: 'set-title', title: 'New' })
    expect(s.title).toBe('New')
    expect(s.dirty).toBe(true)
  })

  it('edit-task-label changes only that task without mutating input', () => {
    const init = initEditState(plan)
    const s = editReducer(init, { type: 'edit-task-label', taskId: 't2', label: 'Two!' })
    expect(s.modules[0].tasks[1].label).toBe('Two!')
    expect(s.modules[0].tasks[0].label).toBe('One.')
    expect(init.modules[0].tasks[1].label).toBe('Two.')
    expect(s.dirty).toBe(true)
  })

  it('delete-task removes the task and drops a module that becomes empty', () => {
    const s = editReducer(initEditState(plan), { type: 'delete-task', taskId: 't3' })
    expect(s.modules).toHaveLength(1)
    expect(s.modules[0].id).toBe('m1')
    expect(s.dirty).toBe(true)
  })

  it('reset returns to the given plan and clears dirty', () => {
    const dirty = editReducer(initEditState(plan), { type: 'set-title', title: 'X' })
    const s = editReducer(dirty, { type: 'reset', plan })
    expect(s.title).toBe('T')
    expect(s.dirty).toBe(false)
  })
})
```

- [ ] **Step 2: 確認失敗**

Run: `cd frontend && npx vitest run src/utils/lessonPlanEdit.test.ts`
Expected: FAIL

- [ ] **Step 3: 實作 reducer**

```ts
// frontend/src/utils/lessonPlanEdit.ts
import type { LessonPlan, LessonPlanModule } from '../types/lessonPlan.ts'

export type EditAction =
  | { type: 'set-title'; title: string }
  | { type: 'edit-task-label'; taskId: string; label: string }
  | { type: 'delete-task'; taskId: string }
  | { type: 'reset'; plan: LessonPlan }

export interface EditState {
  title: string
  modules: LessonPlanModule[]
  dirty: boolean
}

export function initEditState(plan: LessonPlan): EditState {
  return { title: plan.title, modules: plan.modules, dirty: false }
}

/** 結果頁的任務包編輯：只支援改標題、改任務文字、刪單題（spec 明定不做完整編輯器）。 */
export function editReducer(state: EditState, action: EditAction): EditState {
  switch (action.type) {
    case 'set-title':
      return { ...state, title: action.title, dirty: true }
    case 'edit-task-label':
      return {
        ...state,
        dirty: true,
        modules: state.modules.map(m => ({
          ...m,
          tasks: m.tasks.map(t => (t.id === action.taskId ? { ...t, label: action.label } : t)),
        })),
      }
    case 'delete-task':
      return {
        ...state,
        dirty: true,
        modules: state.modules
          .map(m => ({ ...m, tasks: m.tasks.filter(t => t.id !== action.taskId) }))
          .filter(m => m.tasks.length > 0),
      }
    case 'reset':
      return initEditState(action.plan)
  }
}
```

Run: `cd frontend && npx vitest run src/utils/lessonPlanEdit.test.ts`
Expected: 5 passed

- [ ] **Step 4: 寫 `LessonPlanView`**

```tsx
// frontend/src/components/LessonPlanView.tsx
import { useReducer, useState } from 'react';
import type { LessonPlanRecord } from '../types/lessonPlan.ts';
import { editReducer, initEditState } from '../utils/lessonPlanEdit.ts';
import { updateLessonPlan, lessonPlanErrorText } from '../utils/lessonPlanClient.ts';
import { lessonPlanToMarkdown } from '../utils/lessonPlanMarkdown.ts';

interface LessonPlanViewProps {
  record: LessonPlanRecord;
  onSaved: (rec: LessonPlanRecord) => void;
  onBack: () => void;
}

export default function LessonPlanView({ record, onSaved, onBack }: LessonPlanViewProps) {
  const plan = record.plan;
  const [edit, dispatch] = useReducer(editReducer, plan, initEditState);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true); setError(null);
    try {
      const rec = await updateLessonPlan(record.id, { title: edit.title, modules: edit.modules });
      dispatch({ type: 'reset', plan: rec.plan });
      onSaved(rec);
    } catch (e) {
      setError(lessonPlanErrorText(e));
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(lessonPlanToMarkdown({ ...plan, title: edit.title, modules: edit.modules }));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('無法存取剪貼簿，請改用列印');
    }
  };

  return (
    <div className="lp-view">
      <div className="lp-view-toolbar lp-no-print">
        <button className="lp-btn-ghost" onClick={onBack}>← 返回清單</button>
        <div className="lp-view-actions">
          <button className="lp-btn-ghost" onClick={handleCopy}>{copied ? '已複製' : '複製為 Markdown'}</button>
          <button className="lp-btn-ghost" onClick={() => window.print()}>列印</button>
          <button className="lp-btn-primary" onClick={handleSave} disabled={!edit.dirty || saving}>
            {saving ? '儲存中…' : '儲存'}
          </button>
        </div>
      </div>
      {error && <div className="lp-error">{error}</div>}

      <input
        className="lp-title-input"
        value={edit.title}
        onChange={e => dispatch({ type: 'set-title', title: e.target.value })}
        aria-label="教案標題"
      />
      <p className="lp-meta">主題：{plan.topic}｜程度：{plan.level}｜{plan.durationMin} 分鐘｜場景：{plan.sceneId}</p>

      <section className="lp-card">
        <h2>學習目標</h2>
        <ul>{plan.objectives.map((o, i) => <li key={i}>{o}</li>)}</ul>
      </section>

      <section className="lp-card">
        <h2>教學流程與逐字腳本</h2>
        {plan.timeline.map((p, i) => (
          <div className="lp-phase" key={i}>
            <h3>{p.phase} <span className="lp-minutes">{p.minutes} 分鐘</span></h3>
            <p className="lp-activity">{p.activity}</p>
            <pre className="lp-script">{p.teacherScript}</pre>
          </div>
        ))}
      </section>

      <section className="lp-card">
        <h2>語法說明</h2>
        {plan.grammarNotes.map((g, i) => (
          <div className="lp-grammar" key={i}>
            <strong>{g.point}</strong>
            <p>{g.explanation}</p>
            <ul>{g.examples.map((ex, j) => <li key={j}>{ex}</li>)}</ul>
          </div>
        ))}
      </section>

      <section className="lp-card">
        <h2>教學注意點</h2>
        <ul>{plan.teachingNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>
      </section>

      <section className="lp-card">
        <h2>任務包 <span className="lp-hint-text lp-no-print">可改文字、刪單題；儲存後課堂即可載入</span></h2>
        {edit.modules.map(m => (
          <div className="lp-module" key={m.id}>
            <h3>{m.icon} {m.label}</h3>
            {m.tasks.map(t => (
              <div className="lp-task" key={t.id}>
                <input
                  className="lp-task-input"
                  value={t.label}
                  onChange={e => dispatch({ type: 'edit-task-label', taskId: t.id, label: e.target.value })}
                  aria-label="任務文字"
                />
                <button className="lp-btn-danger lp-no-print" onClick={() => dispatch({ type: 'delete-task', taskId: t.id })}>刪除</button>
                <div className="lp-task-hint">
                  <div>完整句：{t.hint.completeSentence}</div>
                  <div>句型：{t.hint.keyStructure}</div>
                  <div>半句：{t.hint.partialSentence}</div>
                  <div>重組：{t.hint.unscramble.join(' ')}</div>
                  <div>延伸：{t.hint.extraPhrases.join(' / ')}</div>
                </div>
              </div>
            ))}
          </div>
        ))}
        {edit.modules.length === 0 && <p className="lp-hint-text">任務包已清空，儲存後課堂不會出現教案任務。</p>}
      </section>
    </div>
  );
}
```

- [ ] **Step 5: 寫 `LessonPrep`（覆蓋占位）**

```tsx
// frontend/src/components/LessonPrep.tsx
import { useEffect, useState } from 'react';
import { THEMES } from '../config/scenes.ts';
import { CEFR_LEVELS, type CefrLevel, type LessonPlanRecord, type LessonPlanSummary } from '../types/lessonPlan.ts';
import { buildSceneContext } from '../utils/sceneContext.ts';
import { generateLessonPlan, listLessonPlans, getLessonPlan, deleteLessonPlan, lessonPlanErrorText } from '../utils/lessonPlanClient.ts';
import LessonPlanView from './LessonPlanView.tsx';
import './LessonPrep.css';

interface LessonPrepProps {
  teacherUid: string;
  institutionId?: string;
  onBack: () => void;
}

type View =
  | { kind: 'list' }
  | { kind: 'form' }
  | { kind: 'generating' }
  | { kind: 'view'; record: LessonPlanRecord };

const GENERATING_STEPS = ['規劃大綱與學習目標', '撰寫逐字腳本', '產生任務五階層提示', '整理語法說明與注意點'];

const SCENE_OPTIONS = THEMES.flatMap(t => t.scenes.map(s => ({ id: s.id, label: `${t.label}／${s.label}` })));

export default function LessonPrep({ teacherUid, institutionId, onBack }: LessonPrepProps) {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [plans, setPlans] = useState<LessonPlanSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sceneId, setSceneId] = useState<string>(SCENE_OPTIONS[0]?.id ?? '');
  const [topic, setTopic] = useState('');
  const [level, setLevel] = useState<CefrLevel>('A1');
  const [stepIdx, setStepIdx] = useState(0);

  const refresh = () =>
    listLessonPlans(teacherUid).then(setPlans).catch(e => setError(lessonPlanErrorText(e)));

  useEffect(() => { void refresh(); }, [teacherUid]); // eslint-disable-line react-hooks/exhaustive-deps

  // 生成中：固定文案輪播，不是真實進度
  useEffect(() => {
    if (view.kind !== 'generating') return;
    setStepIdx(0);
    const t = setInterval(() => setStepIdx(i => Math.min(i + 1, GENERATING_STEPS.length - 1)), 8000);
    return () => clearInterval(t);
  }, [view.kind]);

  const handleGenerate = async () => {
    const trimmed = topic.trim();
    if (!trimmed) { setError('請輸入主題'); return; }
    const sceneContext = buildSceneContext(sceneId);
    if (!sceneContext) { setError('找不到所選場景'); return; }
    setError(null);
    setView({ kind: 'generating' });
    try {
      const record = await generateLessonPlan({ teacherUid, institutionId, sceneId, sceneContext, topic: trimmed, level });
      setView({ kind: 'view', record });
      void refresh();
    } catch (e) {
      setError(lessonPlanErrorText(e));
      setView({ kind: 'form' }); // 表單內容保留
    }
  };

  const handleOpen = async (id: string) => {
    setError(null);
    try { setView({ kind: 'view', record: await getLessonPlan(id) }); }
    catch (e) { setError(lessonPlanErrorText(e)); }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    try { await deleteLessonPlan(id); await refresh(); }
    catch (e) { setError(lessonPlanErrorText(e)); }
  };

  if (view.kind === 'view') {
    return (
      <div className="lp-screen">
        <LessonPlanView
          record={view.record}
          onSaved={rec => { setView({ kind: 'view', record: rec }); void refresh(); }}
          onBack={() => setView({ kind: 'list' })}
        />
      </div>
    );
  }

  return (
    <div className="lp-screen">
      <div className="lp-header">
        <button className="lp-btn-ghost" onClick={onBack}>← 回主畫面</button>
        <h1>備課</h1>
      </div>
      {error && <div className="lp-error">{error}</div>}

      {view.kind === 'generating' && (
        <div className="lp-generating">
          <div className="gradient-spinner" />
          <p>{GENERATING_STEPS[stepIdx]}…</p>
          <p className="lp-hint-text">通常需要 20 到 60 秒</p>
        </div>
      )}

      {view.kind === 'form' && (
        <div className="lp-card lp-form">
          <label>場景
            <select value={sceneId} onChange={e => setSceneId(e.target.value)}>
              {SCENE_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
          <label>主題
            <input value={topic} maxLength={200} placeholder="例：退換貨與退款" onChange={e => setTopic(e.target.value)} />
          </label>
          <label>學生程度
            <select value={level} onChange={e => setLevel(e.target.value as CefrLevel)}>
              {CEFR_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </label>
          <div className="lp-form-actions">
            <button className="lp-btn-ghost" onClick={() => setView({ kind: 'list' })}>取消</button>
            <button className="lp-btn-primary" onClick={handleGenerate}>生成教案</button>
          </div>
        </div>
      )}

      {view.kind === 'list' && (
        <>
          <button className="lp-btn-primary lp-new-btn" onClick={() => setView({ kind: 'form' })}>＋ 新建教案</button>
          {plans.length === 0 ? (
            <p className="lp-hint-text">還沒有教案，按「新建教案」開始。</p>
          ) : (
            <ul className="lp-list">
              {plans.map(p => (
                <li key={p.id} className="lp-list-item">
                  <button className="lp-list-main" onClick={() => { void handleOpen(p.id); }}>
                    <span className="lp-list-title">{p.title}</span>
                    <span className="lp-list-meta">{p.level}｜{p.topic}｜{new Date(p.updatedAt).toLocaleDateString()}</span>
                  </button>
                  <button className="lp-btn-danger" onClick={() => { void handleDelete(p.id); }}>刪除</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
```

```css
/* frontend/src/components/LessonPrep.css */
.lp-screen { min-height: 100vh; background: #FAFAF8; padding: 24px; max-width: 960px; margin: 0 auto; }
.lp-header { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; }
.lp-header h1 { margin: 0; font-size: 24px; }
.lp-card { background: #fff; border: 1px solid #E5E7EB; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
.lp-card h2 { margin: 0 0 12px; font-size: 18px; }
.lp-form { display: flex; flex-direction: column; gap: 14px; max-width: 520px; }
.lp-form label { display: flex; flex-direction: column; gap: 6px; font-size: 14px; color: #374151; }
.lp-form input, .lp-form select { padding: 8px 10px; border: 1px solid #D1D5DB; border-radius: 8px; font: inherit; }
.lp-form-actions { display: flex; justify-content: flex-end; gap: 10px; }
.lp-btn-primary { padding: 8px 16px; border: none; border-radius: 8px; background: #FF7043; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
.lp-btn-primary:disabled { opacity: .5; cursor: default; }
.lp-btn-ghost { padding: 8px 12px; border: 1px solid #D1D5DB; border-radius: 8px; background: #fff; font: inherit; cursor: pointer; }
.lp-btn-danger { padding: 6px 10px; border: none; border-radius: 8px; background: #FEE2E2; color: #B91C1C; font: inherit; cursor: pointer; }
.lp-error { background: #FEE2E2; color: #B91C1C; padding: 10px 12px; border-radius: 8px; margin-bottom: 12px; }
.lp-hint-text { color: #6B7280; font-size: 13px; font-weight: 400; }
.lp-new-btn { margin-bottom: 16px; }
.lp-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.lp-list-item { display: flex; align-items: center; gap: 10px; background: #fff; border: 1px solid #E5E7EB; border-radius: 10px; padding: 10px 12px; }
.lp-list-main { flex: 1; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; border: none; background: transparent; font: inherit; cursor: pointer; text-align: left; }
.lp-list-title { font-weight: 600; }
.lp-list-meta { font-size: 12px; color: #6B7280; }
.lp-generating { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 48px 0; }
.lp-view-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.lp-view-actions { display: flex; gap: 8px; }
.lp-title-input { width: 100%; font-size: 24px; font-weight: 700; border: none; border-bottom: 1px dashed #D1D5DB; background: transparent; padding: 4px 0; margin-bottom: 4px; font-family: inherit; }
.lp-meta { color: #6B7280; font-size: 13px; margin: 0 0 16px; }
.lp-phase h3 { margin: 12px 0 4px; font-size: 16px; }
.lp-minutes { font-size: 12px; color: #00695C; background: #E0F2F1; padding: 2px 8px; border-radius: 999px; margin-left: 6px; }
.lp-activity { margin: 0 0 6px; color: #374151; }
.lp-script { white-space: pre-wrap; font-family: inherit; background: #F9FAFB; padding: 12px; border-radius: 8px; line-height: 1.6; }
.lp-grammar { margin-bottom: 10px; }
.lp-grammar p { margin: 4px 0; }
.lp-module h3 { margin: 12px 0 6px; font-size: 16px; }
.lp-task { display: grid; grid-template-columns: 1fr auto; gap: 6px 10px; align-items: center; padding: 8px 0; border-top: 1px solid #F3F4F6; }
.lp-task-input { padding: 6px 8px; border: 1px solid #D1D5DB; border-radius: 6px; font: inherit; }
.lp-task-hint { grid-column: 1 / -1; font-size: 13px; color: #4B5563; display: grid; gap: 2px; }
@media print {
  .lp-no-print { display: none !important; }
  .lp-screen { padding: 0; max-width: none; }
  .lp-card { border: none; padding: 0 0 12px; break-inside: avoid; }
  .lp-title-input, .lp-task-input { border: none; }
}
```

- [ ] **Step 6: 型別、lint、測試**

Run: `cd frontend && npx tsc -b && npx eslint src/components/LessonPrep.tsx src/components/LessonPlanView.tsx src/utils/lessonPlanEdit.ts && npx vitest run`
Expected: 全綠

- [ ] **Step 7: 手動端到端驗證**

前置：`.env` 有 `GEMINI_API_KEY`；`cd backend && npm run dev` 與 `cd frontend && npm run dev`。

1. 老師登入 → 備課 → 新建教案：場景「服飾店／收銀台」、主題「退換貨與退款」、A2 → 生成教案。
   Expected: 20 到 60 秒後進結果頁；五個區塊都有內容；任務包每題有五階層。
2. 改一題文字、刪一題 → 儲存 → 返回清單 → 再開啟。
   Expected: 修改被保留；`data/livemr.sqlite` 存在。
3. 複製為 Markdown → 貼到記事本；列印預覽。
   Expected: Markdown 有標題與五區塊；列印預覽沒有按鈕列。
4. 回主畫面 → 開始上課選該教案 → 建立房間 → 開大屏。
   Expected: 任務庫最上方出現「我的教案：…」模組，標題旁有教案 tag；選教案任務後大屏提示欄能切五階層；按空白鍵觸發 AI 提示時使用教案的場景約束（後端 log 的 systemInstruction 含教案 `sceneConstraint` 文字）。
5. 刪除該教案後重新整理 host-session。
   Expected: 顯示「教案已被刪除，改用無教案模式」，靜態任務照常。

- [ ] **Step 8: Commit**

```bash
git add frontend/src/utils/lessonPlanEdit.ts frontend/src/utils/lessonPlanEdit.test.ts frontend/src/components/LessonPrep.tsx frontend/src/components/LessonPrep.css frontend/src/components/LessonPlanView.tsx
git commit -m "feat(front): 備課畫面（清單 / 表單 / 生成中 / 結果卡片、任務包編輯、Markdown 與列印）"
```

---

### Task 12: 文件更新與整體驗證

**Files:**
- Modify: `docs/ARCHITECTURE.md`（第 5 節模組表、5.1 端點表、7.3 之後新增 7.5、附錄速查）

- [ ] **Step 1: 更新 ARCHITECTURE.md**

1. 第 5 節模組表：把 `ai.ts` 那列改成三列：

```
| `ai/client.ts` | 唯一碰 `@google/genai` 的檔案：`callGemini()` 多模型 fallback + 逾時 + 可重試判斷 + responseSchema + usage log + `parse` hook |
| `ai/hints.ts` | `generateHint` / `generateHints`（課中提示，介面同舊 `ai.ts`） |
| `ai/lessonPlan.ts` | 教案兩步結構化 workflow（大綱 → 腳本 ∥ 五階層提示 → 語法/注意點），驗證與重組修復 |
| `db/connection.ts` / `db/migrations.ts` | `node:sqlite` 連線、版本化 migration（`data/livemr.sqlite`） |
| `db/lessonPlanRepo.ts` | 教案與任務的增刪改查 |
| `lessonPlanRoutes.ts` | `/api/lesson-plans/*` 端點；DB 不可用時整組回 503 |
```

2. 5.1 端點表加一組「教案」列：`POST /lesson-plans/generate`、`GET /lesson-plans?teacherUid=`、`GET /lesson-plans/:id`、`PATCH /lesson-plans/:id`、`POST /lesson-plans/:id/delete`。

3. 在 7.4 之後新增：

```
### 7.5 備課教案流

老師登入 → teacher-home → lesson-prep：選場景 + 主題 + CEFR 等級
   ▼  前端 buildSceneContext()（THEMES / TASK_HINTS → 角色、既有模組、範例提示）
POST /api/lesson-plans/generate
   ▼  backend ai/lessonPlan.ts
   大綱（responseSchema，分鐘總和必須 15，失敗重試一次）
   → 並行：逐時段逐字腳本 ∥ 逐模組五階層提示（重組單字驗證、重試一次、仍錯則洗牌修復）
   → 語法說明與教學注意點
   ▼  LessonPlanRepo.create()（lesson_plans + lesson_tasks）
結果頁：分段卡片、任務包可改文字/刪題、複製 Markdown、列印
開始上課帶 planId → HostSession 載入教案並切到教案場景
   → config/content.ts：任務庫 / 提示 / 場景約束「先查教案，再查靜態設定」
   → task-change 廣播的 TaskEntry 自帶 hint，BigScreen 優先使用

設計重點：不是 Agent 迴圈，是固定步驟的結構化 workflow；`ai/client.ts`、`db/`、repository 查詢函式是之後課中適性與課後資產化的共用地基（見 `docs/superpowers/specs/2026-09-03-ai-lesson-prep-design.md`）。
```

4. 第 4.2 狀態機圖把 `(Host) ──▶ host-lobby` 改為 `(Host) ──▶ teacher-home ──▶ lesson-prep / host-session`。

5. 附錄速查加 `教案生成 | backend/src/ai/lessonPlan.ts、frontend/src/components/LessonPrep.tsx`、`教案資料層 | backend/src/db/`、`內容解析 | frontend/src/config/content.ts`。

6. 第 10 節「記憶體狀態」那條後面補一句：教案已改存 SQLite（`data/livemr.sqlite`），房間與錄製仍為記憶體。

- [ ] **Step 2: 完整驗證**

```bash
cd backend && npx vitest run && npx tsc --noEmit
cd ../frontend && npx vitest run && npx tsc -b && npx eslint . && npm run build
cd .. && node scripts/build-launcher.mjs
```

Expected: 全部成功。把每個指令的最後幾行輸出留在 commit 前的紀錄裡（執行者回報時要附上）。

- [ ] **Step 3: 封裝冒煙**

Run: 雙擊 `dist-launcher/LiveMR/LiveMR.bat`（或在 PowerShell 執行），瀏覽器開老師端。
Expected: 後端 log 出現 `[db] lesson plans at ...\data\livemr.sqlite`；備課畫面可開啟清單（空清單也算過）。

- [ ] **Step 4: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: 架構文件補上 ai/ 模組拆分、SQLite 資料層與備課教案流"
```
