import { callGemini, type TokenUsage } from './client.js'

/**
 * 登台展演的 AI 口說判斷：學生停住或按「我說完了」時，把這一句的錄音連同台詞送 Gemini，
 * 回傳逐字稿、使用的語言、缺漏與說錯的字、嚴重程度。
 *
 * 模型只負責「聽」和「比對」；要不要介入（正確不打擾、輕微只記錄、嚴重才提示）
 * 由 normalizeJudgment 的固定規則決定，避免模型每次判得不一樣。
 */

/** 預設用最便宜的 Flash-Lite，失敗再退到 Flash；GEMINI_JUDGE_MODEL 可覆寫（逗號分隔） */
export const JUDGE_MODELS = (process.env.GEMINI_JUDGE_MODEL || 'gemini-2.5-flash-lite,gemini-2.5-flash')
  .split(',')
  .map(m => m.trim())
  .filter(Boolean)

export type SpokenLanguage = 'en' | 'zh' | 'mixed' | 'silent'
export type JudgeSeverity = 'ok' | 'minor' | 'severe'
/** 對應文件的偵測項目：中文／中英混用、句子不完整、單字錯誤、完全沒有回應 */
export type JudgeIssue = 'chinese' | 'incomplete' | 'wrongWord' | 'noResponse'

export interface WrongWord {
  said: string
  expected: string
}

export interface TurnJudgment {
  transcript: string
  language: SpokenLanguage
  /** 台詞裡沒說到的關鍵字 */
  missing: string[]
  wrong: WrongWord[]
  issues: JudgeIssue[]
  severity: JudgeSeverity
}

export interface TurnJudgeInput {
  line: { en: string; zh: string }
  /** 前一句台詞（判斷語境用） */
  prevLine?: string | null
  /** 學生程度（CEFR 區間，例如 A1-A2） */
  level: string
  audio: { data: string; mimeType: string }
  signal?: AbortSignal
  /** 指定模型（評估腳本比較用）；未給用 JUDGE_MODELS */
  models?: readonly string[]
}

export interface TurnJudgeResult {
  judgment: TurnJudgment
  model: string
  usage?: TokenUsage
}

const MAX_MISSING = 5
const MAX_WRONG = 3
const MAX_WORD_LEN = 40
const MAX_TRANSCRIPT_LEN = 300

const JUDGE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcript: { type: 'STRING' },
    language: { type: 'STRING', enum: ['en', 'zh', 'mixed', 'silent'] },
    meaningConveyed: { type: 'BOOLEAN' },
    missing: { type: 'ARRAY', items: { type: 'STRING' } },
    wrong: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { said: { type: 'STRING' }, expected: { type: 'STRING' } },
        required: ['said', 'expected'],
      },
    },
    severity: { type: 'STRING', enum: ['ok', 'minor', 'severe'] },
  },
  required: ['transcript', 'language', 'meaningConveyed', 'missing', 'wrong', 'severity'],
}

const LEVEL_TEXT: Record<string, string> = {
  'preA1-A1': 'pre-A1 to A1 (young beginners, lower primary school)',
  A1: 'A1 (beginner, upper primary school)',
  'A1-A2': 'A1 to A2 (junior high school)',
  'A2-B1': 'A2 to B1 (senior high school)',
}

export function buildJudgeInstruction(input: Pick<TurnJudgeInput, 'line' | 'prevLine' | 'level'>): string {
  const level = LEVEL_TEXT[input.level] ?? input.level
  return [
    'You check one line spoken by a Taiwanese student during a classroom English role-play.',
    `Student level (CEFR): ${level}.`,
    input.prevLine ? `Previous line in the dialogue: "${input.prevLine}"` : '',
    `Target line the student should say: "${input.line.en}"`,
    input.line.zh ? `Chinese meaning of the target line: ${input.line.zh}` : '',
    '',
    'Listen to the audio and reply with JSON:',
    '- transcript: exactly what the student said. Write Chinese words in Traditional Chinese characters, English in English. Empty if nothing audible.',
    '- language: "en" if the student spoke English, "zh" if mostly Chinese, "mixed" if Chinese words replaced part of the English line, "silent" if there is no speech.',
    '- meaningConveyed: true if a listener would understand the meaning of the target line from what was said in English.',
    `- missing: key words of the target line the student did not say (at most ${MAX_MISSING}, as written in the target line). Ignore small function words unless the meaning changes.`,
    `- wrong: words the student said in place of a target word, e.g. {"said": "shirt", "expected": "skirt"} (at most ${MAX_WRONG}).`,
    '- severity:',
    '  "ok": the meaning was conveyed in English. Accept paraphrases, accents, filler words (um, uh), self-corrections and grammar slips that are normal for this level.',
    '  "minor": small mistakes that do not block understanding (a missing article, wrong verb form, one non-key word missing or wrong).',
    '  "severe": key content said in Chinese, stopped before about half of the line, or a key word missing or wrong so the meaning is lost or changed.',
    'Judge leniently for lower levels. Do not judge pronunciation here.',
  ].filter(line => line !== '').join('\n')
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

/** 把模型回覆整理成固定規則的判斷結果；形狀不對時拋錯（換下一個模型） */
export function normalizeJudgment(raw: unknown): TurnJudgment {
  const r = raw as Record<string, unknown> | null
  if (!r || typeof r !== 'object') throw new Error('judgment is not an object')
  const languages: SpokenLanguage[] = ['en', 'zh', 'mixed', 'silent']
  if (!languages.includes(r.language as SpokenLanguage)) throw new Error('invalid language')
  const transcript = str(r.transcript, MAX_TRANSCRIPT_LEN)
  const language: SpokenLanguage = transcript === '' ? 'silent' : (r.language as SpokenLanguage)
  const missing = (Array.isArray(r.missing) ? r.missing : [])
    .map(w => str(w, MAX_WORD_LEN)).filter(Boolean).slice(0, MAX_MISSING)
  const wrong = (Array.isArray(r.wrong) ? r.wrong : [])
    .map(w => ({ said: str((w as WrongWord)?.said, MAX_WORD_LEN), expected: str((w as WrongWord)?.expected, MAX_WORD_LEN) }))
    .filter(w => w.said && w.expected && w.said.toLowerCase() !== w.expected.toLowerCase())
    .slice(0, MAX_WRONG)
  const meaningConveyed = r.meaningConveyed === true
  const modelSevere = r.severity === 'severe'

  if (language === 'silent') {
    return { transcript: '', language, missing: [], wrong: [], issues: ['noResponse'], severity: 'severe' }
  }
  const issues: JudgeIssue[] = []
  if (language === 'zh' || language === 'mixed') issues.push('chinese')
  if (missing.length > 0) issues.push('incomplete')
  if (wrong.length > 0) issues.push('wrongWord')

  // 說了中文（整句或混用）、意思沒傳達、或模型判嚴重且確實有缺漏／錯字 → 嚴重（要提示，中文一律鼓勵改用英文）；
  // 意思有傳達只是有小錯 → 輕微（只記錄、不打斷）；都沒問題 → 正確
  let severity: JudgeSeverity
  if (issues.includes('chinese') || !meaningConveyed || (modelSevere && issues.length > 0)) severity = 'severe'
  else severity = issues.length === 0 ? 'ok' : 'minor'
  // 判嚴重卻沒列出原因：當作句子不完整（提示句型開頭）
  if (severity === 'severe' && issues.length === 0) issues.push('incomplete')
  return { transcript, language, missing, wrong, issues, severity }
}

export async function judgeTurn(input: TurnJudgeInput): Promise<TurnJudgeResult> {
  const { data, model, usage } = await callGemini({
    tag: '[ai/speech-judge]',
    models: input.models ?? JUDGE_MODELS,
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: input.audio.mimeType, data: input.audio.data } }] }],
    systemInstruction: buildJudgeInstruction(input),
    temperature: 0,
    maxOutputTokens: 400,
    thinkingBudget: 0,
    responseSchema: JUDGE_SCHEMA,
    signal: input.signal,
    timeoutMs: 15_000,
    parse: text => normalizeJudgment(JSON.parse(text)),
  })
  return { judgment: data, model, usage }
}
