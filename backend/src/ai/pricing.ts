import type { TokenUsage } from './client.js'

/** 每百萬 token 的美元單價（Gemini API 付費標準層，2026-11 官方價目表） */
interface ModelPrice {
  text: number
  audio: number
  output: number
}

const PRICES: Record<string, ModelPrice> = {
  'gemini-2.5-flash-lite': { text: 0.10, audio: 0.30, output: 0.40 },
  'gemini-2.5-flash': { text: 0.30, audio: 1.00, output: 2.50 },
  'gemini-3.1-flash-lite': { text: 0.25, audio: 0.50, output: 1.50 },
  'gemini-3.5-flash-lite': { text: 0.30, audio: 0.30, output: 2.50 },
}

/** 價目表沒有的模型（含 *-latest 別名）用 2.5 Flash 的價格估，寧可高估 */
const FALLBACK: ModelPrice = PRICES['gemini-2.5-flash']

export function priceOf(model: string): ModelPrice {
  return PRICES[model] ?? FALLBACK
}

/** 估算一次呼叫的費用（美元）；沒有音訊明細時整段 prompt 視為文字 */
export function estimateCostUsd(model: string, usage: Pick<TokenUsage, 'prompt' | 'output' | 'audioPrompt'>): number {
  const p = priceOf(model)
  const audio = Math.min(usage.audioPrompt ?? 0, usage.prompt)
  const text = usage.prompt - audio
  return (text * p.text + audio * p.audio + usage.output * p.output) / 1_000_000
}
