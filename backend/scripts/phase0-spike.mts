/**
 * Phase 0 spike — 比較 AI 助理兩條路線（不影響現階段流程）
 *
 *   Path A（現況）：音訊 → STT 逐字稿 → generateHints(文字)
 *   Path B（候選）：音訊 → 原生多模態直接理解 → generateHints(音訊)
 *
 * 兩條路線使用「完全相同」的 systemInstruction 與生成 config（複製自
 * frontend/src/config/aiAssistant.ts 與 backend/src/ai.ts），唯一差別是
 * 輸入是「文字逐字稿」還是「原始音訊」。比較：抽問句正確率、回答品質、
 * 端到端延遲、input token 量（成本代理）。
 *
 * 執行：  cd backend && npx tsx scripts/phase0-spike.mts
 * 需求：  .env 內 GEMINI_API_KEY
 *
 * 注意：此檔為一次性評估腳本，獨立於正式程式碼，可隨時刪除。
 */
import { GoogleGenAI } from '@google/genai'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

const AUDIO_PATH = path.resolve(__dirname, '../../frontend/public/voice/Teacher_chat_test.mp3')
// 與 prod GEMINI_MODEL 第一順位一致；可用 SPIKE_MODEL 覆寫做交叉比較。
const MODEL = process.env.SPIKE_MODEL || 'gemini-2.5-flash-lite'

const apiKey = process.env.GEMINI_API_KEY
if (!apiKey) { console.error('GEMINI_API_KEY 未設定'); process.exit(1) }
const ai = new GoogleGenAI({ apiKey })

// ── 複製自 aiAssistant.ts：場景限制（收銀台）──────────────────────────────────
const SCENE_CONSTRAINT = `
Setting: A clothing store checkout. The student plays a customer, the teacher plays a shop assistant. Shopping is the default backdrop, but the conversation may naturally drift into everyday small talk when the teacher leads there.
Language: Everyday spoken English. Shopping vocabulary is the core, but follow the teacher into other everyday topics (weekend, hobbies, weather, etc.) when asked.
Grammar: Keep it simple and natural for a learner. Use whatever tense the teacher's question calls for — if the teacher asks about the past, reply in the past tense; about plans, use the future. Avoid overly complex constructions.
Vocabulary: prices (dollars, cost, price), sizes (small, medium, large), colors, payment methods (cash, card), polite expressions (please, thank you), plus common everyday words when the topic shifts.
Response style: short, conversational, natural — 1 to 2 sentences.
`.trim()

// ── 複製自 aiAssistant.ts：buildHintsSystemInstruction（無 taskContext）────────
const SYSTEM_INSTRUCTION = `You are an English conversation teaching assistant. The student is learning conversation in the following setting:

${SCENE_CONSTRAINT}

The user messages in this conversation will contain things the TEACHER says. A single user turn may be a LONG teacher monologue mixing greetings, classroom instructions, asides, and several sentences. Before answering, SILENTLY identify the ONE sentence in that turn that is a question DIRECTED AT THE STUDENT and that the student is expected to answer. Base the student's reply on that one question and ignore the rest. If the turn contains no explicit question, pick the single sentence most directed at the student.

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

IMPORTANT — Handling missing information:
If the teacher refers to details that have NOT been provided, INVENT a reasonable, realistic value and commit to it. Never produce a vague answer like "It is." Always commit to a concrete value (a specific dollar amount, a specific size, etc.).

Output a JSON object with exactly three string fields:
  - "question": the ONE teacher sentence you identified as the question directed at the student, copied as the teacher actually said it (English). If there was no explicit question, the sentence most directed at the student.
  - "complete": ONE grammatically complete English sentence the student can say in reply to "question". Everyday spoken English, using the tense the question calls for (past, present, or future). No ellipsis, no Chinese, no preamble.
  - "extend":   ONE additional sentence the student can say RIGHT AFTER "complete" — a polite follow-up question, an extra relevant detail, or a natural conversational expansion. Same tone and vocabulary level as "complete".

Do not output anything outside the JSON object. Do not wrap it in markdown.`

// ── 複製自 ai.ts：generateHints 的生成 config ─────────────────────────────────
const HINTS_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    question: { type: 'STRING' },
    complete: { type: 'STRING' },
    extend: { type: 'STRING' },
  },
  required: ['question', 'complete', 'extend'],
}

function hintsConfig(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const thinkingBudget = MODEL.includes('2.5') ? 512 : 0
  return {
    systemInstruction: SYSTEM_INSTRUCTION,
    temperature: 0.3,
    maxOutputTokens: 640,
    thinkingConfig: { thinkingBudget },
    responseMimeType: 'application/json',
    responseSchema: HINTS_RESPONSE_SCHEMA,
    ...extra,
  }
}

interface Usage { prompt?: number; output?: number; total?: number }
function usageOf(res: any): Usage {
  const m = res?.usageMetadata
  return { prompt: m?.promptTokenCount, output: m?.candidatesTokenCount, total: m?.totalTokenCount }
}

const audioBase64 = fs.readFileSync(AUDIO_PATH).toString('base64')
const audioPart = { inlineData: { mimeType: 'audio/mpeg', data: audioBase64 } }

// ─────────────────────────────────────────────────────────────────────────────
// Path A：STT（用 Gemini 做逐字稿，作為 Web Speech 的高品質代理）→ 文字 → hints
// ─────────────────────────────────────────────────────────────────────────────
async function pathA() {
  // A1 — STT 逐字稿
  const t0 = performance.now()
  const sttRes: any = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [
      { text: 'Transcribe this audio verbatim. Output ONLY the spoken English text, no timestamps, no speaker labels, no commentary.' },
      audioPart as any,
    ] }],
    config: { temperature: 0, thinkingConfig: { thinkingBudget: 0 } } as any,
  })
  const transcript = (sttRes.text ?? '').trim()
  const tStt = performance.now() - t0

  // A2 — 文字 → hints（與 prod 完全相同的 systemInstruction + config）
  const t1 = performance.now()
  const hintsRes: any = await ai.models.generateContent({
    model: MODEL,
    contents: transcript,
    config: hintsConfig() as any,
  })
  const tHints = performance.now() - t1
  const parsed = JSON.parse((hintsRes.text ?? '{}').trim())

  return {
    transcript,
    parsed,
    timing: { sttMs: tStt, hintsMs: tHints, totalMs: tStt + tHints },
    usage: { stt: usageOf(sttRes), hints: usageOf(hintsRes) },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Path B：原生多模態，音訊直接 → hints（單次呼叫）
// ─────────────────────────────────────────────────────────────────────────────
async function pathB() {
  const t0 = performance.now()
  const res: any = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [audioPart as any] }],
    config: hintsConfig() as any,
  })
  const tMs = performance.now() - t0
  const parsed = JSON.parse((res.text ?? '{}').trim())
  return { parsed, timing: { totalMs: tMs }, usage: usageOf(res) }
}

function ms(n: number) { return `${(n / 1000).toFixed(2)}s` }

async function main() {
  console.log(`\n═══ Phase 0 對照 spike ═══`)
  console.log(`模型：${MODEL}   音檔：${path.basename(AUDIO_PATH)} (${(fs.statSync(AUDIO_PATH).size / 1024).toFixed(0)} KB)\n`)

  console.log('▶ 執行 Path A（STT→文字→hints）…')
  const a = await pathA().catch(e => ({ error: String(e?.message ?? e) } as any))
  console.log('▶ 執行 Path B（原生音訊→hints）…\n')
  const b = await pathB().catch(e => ({ error: String(e?.message ?? e) } as any))

  console.log('────────────────────────────────────────────────────────')
  console.log('PATH A — 傳統 STT → 文字 → LLM')
  console.log('────────────────────────────────────────────────────────')
  if (a.error) { console.log('  ERROR:', a.error) }
  else {
    console.log('  [STT 逐字稿]')
    console.log('   ', a.transcript.replace(/\n/g, '\n    '))
    console.log('\n  [hints 輸出]')
    console.log('    question:', a.parsed.question)
    console.log('    complete:', a.parsed.complete)
    console.log('    extend  :', a.parsed.extend)
    console.log('\n  [延遲] STT', ms(a.timing.sttMs), '+ hints', ms(a.timing.hintsMs), '= 總計', ms(a.timing.totalMs))
    console.log('  [tokens] STT in/out', a.usage.stt.prompt, '/', a.usage.stt.output,
      '| hints in/out', a.usage.hints.prompt, '/', a.usage.hints.output)
  }

  console.log('\n────────────────────────────────────────────────────────')
  console.log('PATH B — 原生多模態（音訊直接理解）')
  console.log('────────────────────────────────────────────────────────')
  if (b.error) { console.log('  ERROR:', b.error) }
  else {
    console.log('  [hints 輸出]')
    console.log('    question:', b.parsed.question)
    console.log('    complete:', b.parsed.complete)
    console.log('    extend  :', b.parsed.extend)
    console.log('\n  [延遲] 總計', ms(b.timing.totalMs))
    console.log('  [tokens] in/out', b.usage.prompt, '/', b.usage.output)
  }

  console.log('\n════════════════════════ 小結 ════════════════════════')
  if (!a.error && !b.error) {
    const faster = a.timing.totalMs < b.timing.totalMs ? 'Path A' : 'Path B'
    console.log(`  延遲較低：${faster}（A ${ms(a.timing.totalMs)} vs B ${ms(b.timing.totalMs)}）`)
    console.log(`  input tokens：A 合計 ${(a.usage.stt.prompt ?? 0) + (a.usage.hints.prompt ?? 0)} vs B ${b.usage.prompt}`)
    console.log(`  → 抽問句/回答品質請人工比對上方兩段 question/complete/extend。`)
  }
  console.log('')
}

main()
