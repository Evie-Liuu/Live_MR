# Path B 原生多模態 AI 提示最小原型 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓老師每輪語音的音訊直接送 Gemini 生成 hints（繞過 Web Speech STT），音訊路徑失敗時自動回退現況文字流，dev 顯示 Gemini 自己的轉譯。

**Architecture:** 後端 `/ai/hints` 與 `generateHints` 擴成可選收音訊（base64 inlineData，當前輪用音訊、history 仍文字）；前端新增 per-turn 音訊錄製 hook（tap LiveKit 本地麥克風 track），HostSession 在 turn 結束時優先送音訊、失敗回退 Web Speech 文字。`buildHintsSystemInstruction` 加 `inputMode` 參數切換 STT 容錯段 / 音訊轉錄段。

**Tech Stack:** TypeScript、Express 5、`@google/genai`、React 19、`livekit-client`、MediaRecorder、Vitest。

設計依據：`docs/superpowers/specs/2026-06-16-path-b-native-audio-hints-design.md`

---

## Task 1: 先驗 Gemini 收不收得下 MediaRecorder 容器（de-risk）

目的：spec 的技術風險——Gemini 官方音訊格式列 wav/mp3/aac/ogg/flac，不保證收 `audio/webm`。先用 ffmpeg-static 把現有測試音檔轉成 ogg/opus 與 webm/opus 各一份，分別送 Gemini，確認哪種容器可用。**這決定 Task 6 錄製要優先選哪個 mimeType。**

**Files:**
- Create: `backend/scripts/verify-audio-format.mts`

- [ ] **Step 1: 寫驗證腳本**

```typescript
/**
 * 一次性驗證：Gemini 收不收得下 Chrome MediaRecorder 會吐的容器（ogg/opus、webm/opus）。
 * 用 ffmpeg-static 把測試 mp3 轉檔，分別送 Gemini 轉寫，印出每種容器成功與否。
 *
 * 執行：cd backend && NODE_OPTIONS=--use-system-ca npx tsx scripts/verify-audio-format.mts
 * （本機 Avast TLS 攔截，Node 需 --use-system-ca；Claude Code Bash 需 dangerouslyDisableSandbox）
 */
import ffmpegPath from 'ffmpeg-static'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { GoogleGenAI } from '@google/genai'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const execFileP = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

const SRC = path.resolve(__dirname, '../../frontend/public/voice/Teacher_chat_test.mp3')
const TMP = path.resolve(__dirname, '../../recordings/_fmt_check')
const MODEL = process.env.SPIKE_MODEL || 'gemini-2.5-flash-lite'

const apiKey = process.env.GEMINI_API_KEY
if (!apiKey) { console.error('GEMINI_API_KEY 未設定'); process.exit(1) }
const ai = new GoogleGenAI({ apiKey })

async function transcode(ext: string, args: string[]): Promise<string> {
  fs.mkdirSync(TMP, { recursive: true })
  const out = path.join(TMP, `clip.${ext}`)
  await execFileP(ffmpegPath as unknown as string, ['-y', '-i', SRC, ...args, out])
  return out
}

async function tryGemini(label: string, file: string, mimeType: string) {
  try {
    const data = fs.readFileSync(file).toString('base64')
    const res: any = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [
        { text: 'Transcribe this audio verbatim. Output only the text.' },
        { inlineData: { mimeType, data } },
      ] }],
      config: { temperature: 0, thinkingConfig: { thinkingBudget: 0 } } as any,
    })
    console.log(`✅ ${label} (${mimeType}) OK →`, (res.text ?? '').trim().slice(0, 80))
  } catch (e: any) {
    console.log(`❌ ${label} (${mimeType}) FAIL →`, (e?.message ?? String(e)).slice(0, 120))
  }
}

async function main() {
  const ogg = await transcode('ogg', ['-c:a', 'libopus', '-b:a', '32k'])
  const webm = await transcode('webm', ['-c:a', 'libopus', '-b:a', '32k'])
  await tryGemini('OGG/opus', ogg, 'audio/ogg')
  await tryGemini('WEBM/opus', webm, 'audio/webm')
}
main()
```

- [ ] **Step 2: 執行並記錄結果**

Run: `cd backend && NODE_OPTIONS=--use-system-ca npx tsx scripts/verify-audio-format.mts`
（在 Claude Code 中此 Bash 呼叫需 `dangerouslyDisableSandbox: true`，因需連 Gemini）

Expected: 兩行 ✅/❌。**至少 `audio/ogg` 要 ✅**（Gemini 官方支援 ogg）。把哪種可用記下來，Task 6 的 `pickAudioMimeType` 以此為優先序。若兩者皆 ❌，停下來回報——需改用轉碼方案（超出本原型）。

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/verify-audio-format.mts
git commit -m "test(ai): 加入音訊容器格式驗證腳本 (Gemini ogg/webm 支援度)"
```

---

## Task 2: 後端 `generateHints` 支援音訊輸入 + `transcript` 欄

**Files:**
- Modify: `backend/src/ai.ts:32-124`
- Test: `backend/src/ai.test.ts`

- [ ] **Step 1: 先寫失敗測試（transcript 解析 + 音訊 contents 組裝）**

在 `backend/src/ai.test.ts` 的 `describe('generateHints', …)` 內，`it('defaults question …')` 之後新增：

```typescript
  it('parses the transcript field when present', async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({
        transcript: 'So Angel, tell us about Wendy.',
        question: 'Tell us about Wendy.',
        complete: 'Wendy is my best friend.',
        extend: 'She likes reading.',
      }),
    })
    const { generateHints } = await import('./ai.js')
    const result = await generateHints('teacher ...')
    expect(result.transcript).toBe('So Angel, tell us about Wendy.')
  })

  it('defaults transcript to empty string when absent', async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({ question: 'q', complete: 'c', extend: 'e' }),
    })
    const { generateHints } = await import('./ai.js')
    const result = await generateHints('teacher ...')
    expect(result.transcript).toBe('')
  })

  it('sends audio as an inlineData part when audio option is provided', async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({ transcript: 't', question: 'q', complete: 'c', extend: 'e' }),
    })
    const { generateHints } = await import('./ai.js')
    await generateHints('', { audio: { data: 'QUJD', mimeType: 'audio/ogg' } })
    const call = generateContentMock.mock.calls[0][0]
    const parts = call.contents[call.contents.length - 1].parts
    expect(parts[0].inlineData).toEqual({ mimeType: 'audio/ogg', data: 'QUJD' })
  })
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `cd backend && npx vitest run src/ai.test.ts`
Expected: 新增 3 個測試 FAIL（`result.transcript` undefined；audio 未進 contents）。既有 2 個 PASS。

- [ ] **Step 3: 實作 ai.ts 變更**

在 `backend/src/ai.ts`：

(a) `GenerateHintOptions` interface（約 L42-46）加欄位：

```typescript
export interface GenerateHintOptions {
  history?: ChatTurn[]
  systemInstruction?: string
  signal?: AbortSignal
  /** 當前輪改用音訊輸入（base64）；history 仍為文字。 */
  audio?: { data: string; mimeType: string }
}
```

(b) `HintsResult` interface（約 L48-53）加 `transcript`：

```typescript
export interface HintsResult {
  question: string
  complete: string
  extend: string
  transcript: string
  model: string
}
```

(c) `generateHints` 內 contents 組裝（約 L64-70）改為：

```typescript
    let lastErr: unknown = new Error('No models configured')
    const historyTurns = (opts.history ?? []).map(h => ({ role: h.role, parts: [{ text: h.text }] }))
    let contents: unknown
    if (opts.audio) {
      // 當前輪 = 音訊 inlineData；history 仍為文字 turns
      contents = [
        ...historyTurns,
        { role: 'user', parts: [{ inlineData: { mimeType: opts.audio.mimeType, data: opts.audio.data } }] },
      ]
    } else if (historyTurns.length > 0) {
      contents = [...historyTurns, { role: 'user', parts: [{ text: prompt }] }]
    } else {
      contents = prompt
    }
```

(d) responseSchema（約 L85-93）加 `transcript`（放進 properties，**不放 required**，避免文字模式被迫產出）：

```typescript
          responseSchema: {
            type: 'OBJECT',
            properties: {
              transcript: { type: 'STRING' },
              question: { type: 'STRING' },
              complete: { type: 'STRING' },
              extend: { type: 'STRING' },
            },
            required: ['question', 'complete', 'extend'],
          },
```

(e) 解析（約 L105-112）加 transcript：

```typescript
        let parsed: { transcript?: unknown; question?: unknown; complete?: unknown; extend?: unknown }
        try { parsed = JSON.parse(raw) }
        catch { parsed = { question: '', complete: raw, extend: '' } }
        const transcript = typeof parsed.transcript === 'string' ? parsed.transcript.trim() : ''
        const question = typeof parsed.question === 'string' ? parsed.question.trim() : ''
        const complete = typeof parsed.complete === 'string' ? parsed.complete.trim() : ''
        const extend = typeof parsed.extend === 'string' ? parsed.extend.trim() : ''
        if (!complete) throw new Error('Empty complete field')
        return { transcript, question, complete, extend, model }
```

- [ ] **Step 4: 跑測試，確認全綠**

Run: `cd backend && npx vitest run src/ai.test.ts`
Expected: 5 passed。

- [ ] **Step 5: Commit**

```bash
git add backend/src/ai.ts backend/src/ai.test.ts
git commit -m "feat(ai): generateHints 支援音訊輸入與 transcript 欄"
```

---

## Task 3: 後端 `/ai/hints` 收音訊 + 放寬 body limit + 回傳 transcript

**Files:**
- Modify: `backend/src/routes.ts:490-517`
- Modify: `backend/src/index.ts:25`

- [ ] **Step 1: 放寬 json body limit（index.ts）**

`backend/src/index.ts` 第 25 行：

```typescript
app.use(express.json({ limit: '25mb' }))
```

（音訊 base64 約數十～數百 KB，預設 100kb 會擋下。）

- [ ] **Step 2: `/ai/hints` 收 audio 並回傳 transcript（routes.ts）**

`backend/src/routes.ts` 的 `router.post('/ai/hints', …)`（約 L490-517）改為：

```typescript
  router.post('/ai/hints', async (req: Request, res: Response) => {
    const { prompt, history, systemInstruction, audio } = req.body as {
      prompt?: string
      history?: Array<{ role: 'user' | 'model'; text: string }>
      systemInstruction?: string
      audio?: { data?: unknown; mimeType?: unknown }
    }
    // 驗證音訊 shape；不合法則忽略（退為文字模式），不回 400，利前端無感回退。
    const safeAudio =
      audio && typeof audio.data === 'string' && typeof audio.mimeType === 'string'
        ? { data: audio.data, mimeType: audio.mimeType }
        : undefined
    // 文字模式仍要求 prompt；音訊模式可無 prompt。
    if (!safeAudio && (typeof prompt !== 'string' || !prompt.trim())) {
      res.status(400).json({ error: 'prompt is required' })
      return
    }
    const safeHistory = Array.isArray(history)
      ? history.filter(h => h && (h.role === 'user' || h.role === 'model') && typeof h.text === 'string')
      : undefined
    try {
      const { transcript, question, complete, extend, model } = await generateAIHints(prompt ?? '', {
        history: safeHistory && safeHistory.length > 0 ? safeHistory : undefined,
        systemInstruction: typeof systemInstruction === 'string' && systemInstruction.trim()
          ? systemInstruction
          : undefined,
        audio: safeAudio,
      })
      res.json({ transcript, question, complete, extend, model })
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      console.error('[ai/hints] error:', msg)
      const status = msg.includes('GEMINI_API_KEY') ? 500 : 502
      res.status(status).json({ error: msg })
    }
  })
```

- [ ] **Step 3: 跑後端全測試，確認沒回歸**

Run: `cd backend && npx vitest run`
Expected: 全綠（含 routes.test.ts、ai.test.ts）。

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes.ts backend/src/index.ts
git commit -m "feat(api): /ai/hints 收可選音訊、放寬 body limit、回傳 transcript"
```

---

## Task 4: `buildHintsSystemInstruction` 加 `inputMode` 參數

**Files:**
- Modify: `frontend/src/config/aiAssistant.ts:128-161`
- Test: `frontend/src/config/aiAssistant.test.ts`

- [ ] **Step 1: 先寫失敗測試**

在 `frontend/src/config/aiAssistant.test.ts` 的 describe 內新增：

```typescript
  it('audio mode asks for a transcript field and mentions audio', () => {
    const out = buildHintsSystemInstruction(constraint, undefined, 'audio')
    expect(out).toContain('"transcript"')
    expect(out.toLowerCase()).toContain('audio')
  })

  it('text mode (default) does not ask for a transcript field', () => {
    const out = buildHintsSystemInstruction(constraint)
    expect(out).not.toContain('"transcript"')
  })
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd frontend && npx vitest run src/config/aiAssistant.test.ts`
Expected: 新增 2 個 FAIL（text 模式無 transcript ✓ 已成立，但 audio 模式尚未支援第三參數 → 'audio' 被忽略，`"transcript"` 不存在 → audio 測試 FAIL）。

- [ ] **Step 3: 實作 inputMode**

`frontend/src/config/aiAssistant.ts` 的 `buildHintsSystemInstruction` 改為：

```typescript
export function buildHintsSystemInstruction(
  sceneConstraint: string,
  taskContext?: HintTaskContext,
  inputMode: 'text' | 'audio' = 'text',
): string {
  const focusBlock = taskContext ? buildTaskFocusBlock(taskContext) : ''
  const inputBlock = inputMode === 'audio'
    ? `You will receive the teacher's speech as AUDIO. FIRST, SILENTLY transcribe it faithfully into the verbatim English you hear (this goes into the "transcript" field). Names, numbers, and prices must be transcribed as accurately as you can. Work from this transcription for the rest of the task.`
    : `The teacher's words arrive as raw automatic speech-recognition (STT) output and MAY contain transcription errors, misheard or wrong words, run-on fragments, missing punctuation, or stray noise — especially for names, numbers, prices, and any non-English (e.g. Chinese) words. FIRST, SILENTLY reconstruct the most likely intended English, using the scene setting and vocabulary above as context to repair obvious mishearings (a misheard price / size / color, a student's name, a garbled question). Work from this repaired interpretation, not the literal garbled text; if a part is too corrupted to recover, ignore it rather than guessing wildly.`
  const transcriptField = inputMode === 'audio'
    ? `\n  - "transcript": a faithful verbatim transcription of what the teacher actually said in the audio (English).`
    : ''
  const fieldCount = inputMode === 'audio' ? 'four' : 'three'
  return `You are an English conversation teaching assistant. The student is learning conversation in the following setting:

${sceneConstraint}

The user messages in this conversation will contain things the TEACHER says. A single user turn may be a LONG teacher monologue mixing greetings, classroom instructions, asides, and several sentences.

${inputBlock}

THEN, SILENTLY identify the ONE sentence in that turn that is a question DIRECTED AT THE STUDENT and that the student is expected to answer. Base the student's reply on that one question and ignore the rest. If the turn contains no explicit question, pick the single sentence most directed at the student.

A "question directed at the student" is NOT limited to sentences ending in "?". Recognise these question types, including imperative or implicit ones that expect the student to speak:
  - Yes/No ("Do you like apples?")
  - What / Who / Where / When / Why / How ("What did you have for dinner?", "How do you go to school?")
  - Choice ("Do you like rice or noodles?")
  - Experience / Past ("What did you do last weekend?")
  - Future plan ("What will you do this weekend?")
  - Preference ("What food do you like?")
  - Opinion ("What do you think about English class?")
  - Description / invitation to speak — often phrased as a command, not a question ("Tell me about your favorite animal.", "Can you describe your school?")
Pick whichever single one is most clearly aimed at the student; prefer an explicit question over an instruction when both appear. Let the question type guide the answer focus and tense — Why → a reason ("because…"), Where → a place, When → a time, Who → a person, Past → past tense, Future plan → "will" / "be going to", Choice → commit to one option.

Maintain continuity with earlier turns — if you already invented specific values (price, size, color, brand, stock), reuse them consistently and let the story progress naturally.

IMPORTANT — Always answer, never deflect:
The student is a character who knows their own world — their life, friends, family, school, preferences, and the items in this scene. Whenever the teacher refers to something not previously established — a price, size, color, brand, or stock, but ALSO a person (a friend, classmate, family member), a place, a past experience, a future plan, or an opinion — INVENT a reasonable, realistic, concrete answer and commit to it, speaking in the first person as that student. Reuse anything you invented earlier so the story stays consistent.
NEVER deflect, refuse, or ask for clarification instead of answering. Do NOT output "I don't know", "I'm not sure", "I'm not sure who … is", "Could you tell me more about …", or any vague stub like "It is." If the teacher asks you to describe a person or thing you have no prior information about, simply make one up — give a specific identity and at least one concrete detail — and say it confidently.${focusBlock}

Output a JSON object with exactly ${fieldCount} string fields:${transcriptField}
  - "question": the ONE question you identified, written out as clean, corrected English — repair any obvious STT errors so it reads as the teacher most likely intended (do NOT echo garbled text). If there was no explicit question, the sentence most directed at the student.
  - "complete": ONE grammatically complete English sentence the student can say in reply to "question". Everyday spoken English, using the tense the question calls for (past, present, or future). No ellipsis, no Chinese, no preamble.
  - "extend":   ONE additional sentence the student can say RIGHT AFTER "complete" — a polite follow-up question, an extra relevant detail, or a natural conversational expansion. Same tone and vocabulary level as "complete".

Do not output anything outside the JSON object. Do not wrap it in markdown.`
}
```

注意：此為把現有模板「STT 容錯段」抽成 `inputBlock`、加 `transcriptField` 與 `fieldCount` 的重構，其餘文字（題型、強制作答、欄位描述）原封不動。

- [ ] **Step 4: 跑測試確認全綠**

Run: `cd frontend && npx vitest run src/config/aiAssistant.test.ts`
Expected: 4 passed（原 2 + 新 2）。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/config/aiAssistant.ts frontend/src/config/aiAssistant.test.ts
git commit -m "feat(ai): buildHintsSystemInstruction 加 inputMode (text/audio)"
```

---

## Task 5: 前端 client `generateHints` 支援音訊 + transcript

**Files:**
- Modify: `frontend/src/utils/geminiClient.ts:50-57, 89-131`

- [ ] **Step 1: 擴充型別與請求**

`frontend/src/utils/geminiClient.ts`：

(a) `GenerateHintOptions`（約 L50-57）加 audio：

```typescript
export interface GenerateHintOptions {
  history?: Array<{ role: 'user' | 'model'; text: string }>
  systemInstruction?: string
  signal?: AbortSignal
  /** 當前輪改送音訊（base64）；history 仍為文字。 */
  audio?: { data: string; mimeType: string }
}
```

(b) `HintsResult`（約 L89-94）加 transcript：

```typescript
export interface HintsResult {
  question: string
  complete: string
  extend: string
  transcript: string
  model: string
}
```

(c) `generateHints`（約 L98-131）的 body 與解析：

```typescript
    const body: Record<string, unknown> = { prompt }
    if (opts.history && opts.history.length > 0) body.history = opts.history
    if (opts.systemInstruction) body.systemInstruction = opts.systemInstruction
    if (opts.audio) body.audio = opts.audio
    const res = await fetch(HINTS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(data.error || `AI HTTP ${res.status}`)
    }
    const data = await res.json() as { transcript?: string; question?: string; complete?: string; extend?: string; model?: string }
    const complete = (data.complete ?? '').trim()
    if (!complete) throw new Error('Empty response')
    return {
      transcript: (data.transcript ?? '').trim(),
      question: (data.question ?? '').trim(),
      complete,
      extend: (data.extend ?? '').trim(),
      model: data.model ?? 'unknown',
    }
```

- [ ] **Step 2: typecheck**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: 無錯誤（注意 HostSession 仍會編譯通過，因為它還沒用到 transcript/audio）。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/utils/geminiClient.ts
git commit -m "feat(ai-client): generateHints 支援音訊參數與 transcript 回傳"
```

---

## Task 6: per-turn 音訊錄製 hook

**Files:**
- Create: `frontend/src/hooks/useTurnAudioRecorder.ts`
- Test: `frontend/src/hooks/useTurnAudioRecorder.test.ts`

`pickAudioMimeType` 的優先序依 **Task 1 驗證結果** 決定（預設 ogg 優先，因 Gemini 官方支援）。

- [ ] **Step 1: 先寫 pickAudioMimeType 的失敗測試**

`frontend/src/hooks/useTurnAudioRecorder.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { pickAudioMimeType } from './useTurnAudioRecorder'

describe('pickAudioMimeType', () => {
  it('prefers ogg/opus when supported', () => {
    const isSupported = (t: string) => t === 'audio/ogg;codecs=opus' || t === 'audio/webm;codecs=opus'
    expect(pickAudioMimeType(isSupported)).toBe('audio/ogg;codecs=opus')
  })

  it('falls back to webm/opus when ogg unsupported', () => {
    const isSupported = (t: string) => t === 'audio/webm;codecs=opus'
    expect(pickAudioMimeType(isSupported)).toBe('audio/webm;codecs=opus')
  })

  it('returns empty string when neither supported', () => {
    expect(pickAudioMimeType(() => false)).toBe('')
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd frontend && npx vitest run src/hooks/useTurnAudioRecorder.test.ts`
Expected: FAIL（`pickAudioMimeType` 未定義）。

- [ ] **Step 3: 實作 hook**

`frontend/src/hooks/useTurnAudioRecorder.ts`：

```typescript
import { useCallback, useRef } from 'react'

/** 依瀏覽器支援度挑容器；ogg/opus 優先（Gemini 官方支援），退 webm/opus。 */
export function pickAudioMimeType(isSupported: (t: string) => boolean): string {
  if (isSupported('audio/ogg;codecs=opus')) return 'audio/ogg;codecs=opus'
  if (isSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus'
  return ''
}

/** stop() 回傳的音訊：base64 內容 + 送 Gemini 用的容器 mimeType（去掉 codecs 參數）。 */
export interface TurnAudio {
  data: string
  mimeType: string
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      // dataURL 形如 "data:audio/ogg;codecs=opus;base64,XXXX" → 取逗號後
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * 對「當前麥克風 track」做 per-turn 錄製。getMicTrack 每次 start 時即時取得
 * 老師的 LiveKit 本地麥克風 MediaStreamTrack；無 track 時 start 回 false、
 * stop 回 null（觸發呼叫端的文字回退）。
 */
export function useTurnAudioRecorder(getMicTrack: () => MediaStreamTrack | null) {
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mimeRef = useRef<string>('')

  const supported =
    typeof MediaRecorder !== 'undefined' &&
    pickAudioMimeType((t) => MediaRecorder.isTypeSupported(t)) !== ''

  const start = useCallback((): boolean => {
    if (typeof MediaRecorder === 'undefined') return false
    const track = getMicTrack()
    if (!track) return false
    const mime = pickAudioMimeType((t) => MediaRecorder.isTypeSupported(t))
    if (!mime) return false
    try {
      const stream = new MediaStream([track])
      const mr = new MediaRecorder(stream, { mimeType: mime })
      chunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data) }
      mr.start()
      recorderRef.current = mr
      mimeRef.current = mime
      return true
    } catch (err) {
      console.warn('[useTurnAudioRecorder] start failed:', err)
      return false
    }
  }, [getMicTrack])

  const stop = useCallback((): Promise<TurnAudio | null> => {
    return new Promise((resolve) => {
      const mr = recorderRef.current
      recorderRef.current = null
      if (!mr || mr.state === 'inactive') { resolve(null); return }
      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimeRef.current })
        chunksRef.current = []
        if (blob.size === 0) { resolve(null); return }
        try {
          const data = await blobToBase64(blob)
          // 送 Gemini 的 mimeType 用容器主型別（去掉 ;codecs=opus）
          resolve({ data, mimeType: mimeRef.current.split(';')[0] })
        } catch { resolve(null) }
      }
      try { mr.stop() } catch { resolve(null) }
    })
  }, [])

  return { start, stop, supported }
}
```

- [ ] **Step 4: 跑測試確認全綠**

Run: `cd frontend && npx vitest run src/hooks/useTurnAudioRecorder.test.ts`
Expected: 3 passed。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useTurnAudioRecorder.ts frontend/src/hooks/useTurnAudioRecorder.test.ts
git commit -m "feat(host): 新增 useTurnAudioRecorder per-turn 音訊錄製 hook"
```

---

## Task 7: HostSession 串接（音訊優先、失敗回退、dev 顯示轉譯）

**Files:**
- Modify: `frontend/src/components/HostSession.tsx`（import、hook 實例化、effect、handleHint、handleTeacherDone、dev 顯示）

無自動化測試（MediaRecorder / LiveKit 需真實環境）；以 Step 7 手動驗證。

- [ ] **Step 1: import hook 與型別**

在 HostSession.tsx 既有 import 區加入：

```typescript
import { useTurnAudioRecorder, type TurnAudio } from '../hooks/useTurnAudioRecorder';
```

- [ ] **Step 2: 實例化 hook + 提供 mic track getter + ref 鏡像**

在元件內（`connectedRoom` 已可用之處，靠近其他 ref 宣告，例如 `handleHint` 定義之前）加入：

```typescript
  // 取老師當前 LiveKit 本地麥克風 track（與 camera track 同 pattern）
  const getMicTrack = useCallback((): MediaStreamTrack | null => {
    const pub = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Microphone);
    return pub?.track?.mediaStreamTrack ?? null;
  }, []);
  const turnAudio = useTurnAudioRecorder(getMicTrack);
  // 供穩定 callback（finish / effect）讀最新值
  const turnAudioRef = useRef(turnAudio);
  useEffect(() => { turnAudioRef.current = turnAudio; }, [turnAudio]);
  // dev 顯示 Gemini 轉譯
  const [heardTranscript, setHeardTranscript] = useState('');
```

> 註：`roomRef` 為既有保存 Room 實例的 ref（見 HostSession 既有用法，如 L1462 `roomRef.current?.localParticipant`）。若該 ref 名稱不同，沿用該檔實際名稱。

- [ ] **Step 3: 老師階段開始時啟動錄音（effect）**

在元件內加入一個 effect（放在 `interactionPhase` 已定義之後）：

```typescript
  // 進入 teacher 階段即開始 per-turn 音訊錄製（涵蓋 startInteraction / takeover / 重試）
  useEffect(() => {
    if (interactionPhase === 'teacher') {
      turnAudioRef.current.start();
    }
  }, [interactionPhase]);
```

- [ ] **Step 4: handleHint 接受並優先使用音訊**

修改 `handleHint`（約 L728）簽名與冷路徑。簽名加第三參數：

```typescript
  const handleHint = useCallback(async (mode: AIHintMode, overrideText?: string, audio?: TurnAudio) => {
```

(a) cache-first 區塊（約 L736）前加條件——**有音訊時一律走冷路徑**：把 `if (cachedRepliesRef.current && cachedTranscriptRef.current === txt) {` 改為 `if (!audio && cachedRepliesRef.current && cachedTranscriptRef.current === txt) {`。

(b) 短文字 / gate 守門（約 L754-755）改為「只在無音訊時擋」：

```typescript
    if (!audio && txt.length < 3) return;
    if (!audio && !transcriptGateRef.current.accept(txt, { sceneId: selectedSceneId, source: 'button' })) return;
```

(c) systemInstruction 與呼叫（約 L775-777）改為依音訊切 inputMode、帶 audio：

```typescript
      const systemInstruction = buildHintsSystemInstruction(constraint, taskContext, audio ? 'audio' : 'text');
      const history = chatHistoryRef.current;
      const result = await generateHints(audio ? '' : txt, { history, systemInstruction, audio });
```

(d) 取得 result 後，決定「有效轉譯」並對齊 cache key + 反映到 UI（約 L778-793 區段內，`setAiModel(result.model)` 之後）：

```typescript
      setAiModel(result.model);
      // 音訊模式：以 Gemini 回傳的 transcript 當有效文字；文字模式沿用 txt。
      const effectiveTxt = audio ? (result.transcript || result.question || txt) : txt;
      setHeardTranscript(audio ? result.transcript : '');
      console.log('[hint] input:', audio ? '(audio)' : txt);
      console.log('[hint] heard transcript:', result.transcript);
      console.log('[hint] extracted question:', result.question);
      setDetectedQuestion(result.question || '');
      const sourceText = result.question || effectiveTxt;
```

並把後續 `cachedTranscriptRef.current = txt;` 改為 `cachedTranscriptRef.current = effectiveTxt;`，把 history user turn 的 fallback `result.question || txt` 改為 `result.question || effectiveTxt`。

(e) 在設定好 `cachedTranscriptRef.current = effectiveTxt` **之後**、`broadcastAIHint` 之前，若為音訊模式，把有效轉譯反映進 STT 顯示狀態，讓現有 transcript UI 顯示 Gemini 文字、且後續 mode 按鈕的 cache key（`sttTranscript`）對得上：

```typescript
      if (audio && effectiveTxt) {
        // 先設 cachedTranscriptRef（上方已設）再 simulate，避免 transcript effect 誤判而清掉剛建的 cache。
        simulateTranscript(effectiveTxt);
      }
```

> `simulateTranscript` 即 `useSpeechRecording` 的 `simulate`（已在 L342 解構）。此時 STT 已停止，呼叫安全。

更新 `handleHint` 的依賴陣列（約 L823）：把 `simulateTranscript` 加入（其餘依賴不變）。

- [ ] **Step 5: handleTeacherDone 先停音訊再決定走音訊或回退**

把 `handleTeacherDone`（約 L871-901）的 `finish` 改為 async，先停音訊取 blob：

```typescript
    const finish = async (finalText: string) => {
      const txt = finalText.trim();
      const audio = await turnAudioRef.current.stop();  // TurnAudio | null
      if (!audio && txt.length < 3) {
        // 無音訊且無有效語音 → 提示並回老師階段重新收音
        setAiError('未偵測到語音，請再試一次');
        setInteractionPhase('teacher');
        if (!sttRecordingRef.current) {
          try { startRec(); } catch { /* ignore */ }
        }
        return;
      }
      setInteractionPhase('student');
      // 音訊優先；無音訊時帶 Web Speech 文字走回退。
      void handleHintRef.current('rearrange', txt, audio ?? undefined);
    };
```

> 注意 `finish` 由 `stopRec(finish)` 與 `finish(sttTranscript.trim())` 兩處呼叫（L897-899）；改 async 後兩處皆相容（回傳的 Promise 可不 await）。

- [ ] **Step 6: dev 顯示 heardTranscript**

在 AI 區塊既有顯示 `detectedQuestion` 的 dev 卡片附近（搜尋 `detectedQuestion` 的 JSX 使用處），加入 dev-only 一行：

```tsx
{import.meta.env.DEV && heardTranscript && (
  <div className="hs-ai-heard" style={{ fontSize: 12, opacity: 0.7 }}>
    🎧 Gemini 聽到：{heardTranscript}
  </div>
)}
```

- [ ] **Step 7: 手動驗證 + typecheck**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: 無型別錯誤。

手動（依 dev-setup.md 啟動 nginx+livekit+backend+frontend）：
1. 開老師端、進入互動、用 VB-CABLE 播一段測試音檔當麥克風輸入。
2. 按「老師講完」。
3. 預期：hint card 顯示「🎧 Gemini 聽到：…」為**乾淨**轉譯（明顯優於先前 Web Speech）；complete/extend 正常；切換 complete/rearrange/extend 不重新請求（cache 生效）。
4. 模擬失敗回退：暫時停掉麥克風 track（或 getMicTrack 回 null），確認自動改用 Web Speech 文字流，不中斷。

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/HostSession.tsx
git commit -m "feat(host): 互動改音訊優先送 Gemini,失敗回退 Web Speech,dev 顯示轉譯"
```

---

## 完成後

- 全測試：`cd backend && npx vitest run` 與 `cd frontend && npx vitest run` 皆綠。
- 對照 spec 成功標準：音訊轉譯明顯比 Web Speech 乾淨；失敗無感回退；既有測試全綠。
- 後續（非本原型）：若要把 transcript 存進錄製檔、或改用 Gemini Live API 串流降延遲，另開 spec。
