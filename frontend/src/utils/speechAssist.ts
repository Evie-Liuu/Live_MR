/**
 * 登台展演 AI 口說輔助的規則（不含網路與錄音，方便測試）：
 *   - 什麼時候送 AI 判斷：開口後停住 JUDGE_PAUSE_MS，或按「我說完了」；每句最多 MAX_JUDGES_PER_TURN 次
 *   - 完全沒有回應：輪到自己 NO_RESPONSE_MS 都沒出聲 → 主動提問、給簡單選項（不用 AI）
 *   - 判斷結果怎麼呈現：正確不介入、輕微只記錄、嚴重才在 iPad 上給提示
 */
import type { TurnJudgment } from '../types/speechAssist.ts';
import { lineWords } from './turnHints.ts';

/** 開口後停住多久送判斷 */
export const JUDGE_PAUSE_MS = 2500;
/** 輪到自己多久都沒出聲算「完全沒有回應」（文件建議 5–8 秒先給文字提示，這裡再晚一點給選項） */
export const NO_RESPONSE_MS = 10000;
export const MAX_JUDGES_PER_TURN = 3;
/** 錄音太短（只是咳嗽、雜音）不送 */
export const MIN_CLIP_SECONDS = 0.8;
/** 錄音上限：只送最後這幾秒 */
export const MAX_CLIP_SECONDS = 20;

export interface JudgeTiming {
  now: number;
  /** 最後一次偵測到自己出聲；0＝還沒開口 */
  lastVoiceAt: number;
  /** 上一次送判斷時的 lastVoiceAt；0＝還沒送過 */
  judgedVoiceAt: number;
  judges: number;
  /** 正在等判斷結果 */
  pending: boolean;
}

/** 停住夠久、而且上次判斷之後又說了話，才送新的判斷 */
export function shouldJudgeOnPause(t: JudgeTiming): boolean {
  return !t.pending && t.judges < MAX_JUDGES_PER_TURN && t.lastVoiceAt > 0
    && t.lastVoiceAt > t.judgedVoiceAt && t.now - t.lastVoiceAt >= JUDGE_PAUSE_MS;
}

/** 按「我說完了」：上次判斷之後有說話就再判斷一次（只記錄，不顯示） */
export function shouldJudgeOnDone(t: Omit<JudgeTiming, 'now'>): boolean {
  return t.judges < MAX_JUDGES_PER_TURN && t.lastVoiceAt > 0 && t.lastVoiceAt > t.judgedVoiceAt;
}

export function isNoResponse(t: { now: number; turnAt: number; lastVoiceAt: number }): boolean {
  return t.lastVoiceAt === 0 && t.now - t.turnAt >= NO_RESPONSE_MS;
}

/**
 * 選項：同一步的其他台詞當干擾句，最多 2 句。
 * 先挑隔一句以上的（前後句常是一問一答，太容易猜），不重複、不與正確台詞相同。
 */
export function distractorLines(lines: readonly string[], lineIndex: number, max = 2): string[] {
  const target = lines[lineIndex]?.trim().toLowerCase();
  const seen = new Set<string>(target ? [target] : []);
  const offsets: number[] = [];
  for (let d = 2; d < lines.length; d++) offsets.push(d, -d);
  offsets.push(1, -1);
  const out: string[] = [];
  for (const d of offsets) {
    const line = lines[lineIndex + d];
    const key = line?.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= max) break;
  }
  return out;
}

/** 正確台詞與干擾句排成選項（依 seq 固定順序，重畫時不會跳動） */
export function choiceOptions(line: string, distractors: readonly string[], seq: number): { options: string[]; answer: number } {
  const options = [...distractors];
  const answer = Math.abs(seq) % (options.length + 1);
  options.splice(answer, 0, line);
  return { options, answer };
}

function bare(word: string): string {
  return word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

const FILLERS = new Set(['um', 'uh', 'er', 'ah', 'hmm', 'mm']);

/** 學生已經照順序說到台詞的第幾個字（可跳過填詞與說錯的字，不計大小寫與標點） */
export function spokenPrefix(transcript: string, en: string): number {
  const said = lineWords(transcript).map(bare).filter(w => w && !FILLERS.has(w));
  const target = lineWords(en).map(bare);
  let t = 0;
  for (const w of said) {
    if (t >= target.length) break;
    if (w === target[t]) t++;
    else if (w === target[t + 1]) t += 2;
  }
  return t;
}

export type AssistFeedback =
  | { kind: 'chinese' | 'incomplete'; shown: string[]; blanks: number }
  | { kind: 'wrongWord'; pairs: { said: string; expected: string }[] };

/** 句型框架：說到哪裡就從那裡多給一個字；至少給 1 個字，不給完整句 */
function frame(transcript: string, en: string): { shown: string[]; blanks: number } {
  const words = lineWords(en);
  const count = Math.min(Math.max(1, spokenPrefix(transcript, en) + 1), Math.max(1, words.length - 1));
  return { shown: words.slice(0, count), blanks: words.length - count };
}

/**
 * 嚴重才提示；中文優先（鼓勵改用英文，給英文的句型開頭），其次說錯的字，最後是接著說的句型。
 * 正確、輕微、或是沒有回應（交給選項提示）回傳 null。
 * （畫面上方的分級提示已經有中文意思與關鍵字，這裡不重複給關鍵字）
 */
export function assistFeedback(j: TurnJudgment, line: { en: string }): AssistFeedback | null {
  if (j.severity !== 'severe' || j.issues.includes('noResponse')) return null;
  if (j.issues.includes('chinese')) return { kind: 'chinese', ...frame(j.transcript, line.en) };
  if (j.issues.includes('wrongWord') && j.wrong.length > 0) return { kind: 'wrongWord', pairs: j.wrong };
  return { kind: 'incomplete', ...frame(j.transcript, line.en) };
}
