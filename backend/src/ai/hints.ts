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
