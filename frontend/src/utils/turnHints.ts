/**
 * 逐句演練的分級提示（不用 AI）：學生 iPad 依沉默時間一級一級多給，老師也可以手動加一級。
 *
 *   0 意思：中文＋關鍵字
 *   1 開頭：前幾個字，其餘留空格
 *   2 重組：打散的字卡
 *   3 完整：整句＋「聽一次」
 *
 * 「完整台詞」模式直接停在 3（第 1 步的顯示方式）。
 */

export type HintLevel = 0 | 1 | 2 | 3;
export const MAX_HINT_LEVEL: HintLevel = 3;
export const HINT_LABELS: Record<HintLevel, string> = { 0: '意思', 1: '開頭', 2: '重組', 3: '完整' };

/** tiered：分級提示；full：一開始就顯示完整台詞 */
export type TurnHintMode = 'tiered' | 'full';

/** 還沒開口：沉默這麼久升一級 */
export const HINT_SILENCE_MS = 4000;
/** 開口後停住：停這麼久升一級 */
export const HINT_PAUSE_MS = 2500;

const STOPWORDS = new Set([
  'a', 'an', 'the', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'my', 'your', 'his', 'her', 'its', 'our', 'their',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'do', 'does', 'did', 'can', 'could', 'will', 'would', 'shall', 'should',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'and', 'or', 'but', 'so', 'this', 'that', 'these', 'those',
  'have', 'has', 'had', 'what', 'how', 'here', 'there', 'yes', 'no', 'not', 'please', 'oh', 'ok', 'okay',
  'want', 'need', 'like', 'get', 'let', 'go',
]);

export function lineWords(en: string): string[] {
  return en.trim().split(/\s+/).filter(Boolean);
}

/** 去掉前後標點，比對用（保留 T-shirt、I'm 這類字中間的符號） */
function bare(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/** 句尾標點（. ? !），開頭提示保留它讓學生知道是問句還是直述句 */
function endMark(en: string): string {
  return en.trim().match(/[.?!]+$/)?.[0] ?? '';
}

/** 關鍵字：去掉功能詞，取最長的幾個，照句中順序 */
export function keywords(en: string, max = 3): string[] {
  const seen = new Set<string>();
  const words: { word: string; index: number }[] = [];
  lineWords(en).forEach((w, index) => {
    const word = bare(w);
    const key = word.toLowerCase();
    if (word.length < 3 || STOPWORDS.has(key) || seen.has(key)) return;
    seen.add(key);
    words.push({ word, index });
  });
  return words
    .sort((a, b) => b.word.length - a.word.length || a.index - b.index)
    .slice(0, max)
    .sort((a, b) => a.index - b.index)
    .map(w => w.word);
}

/** 開頭提示：短句給 1 個字、中句 2 個、長句 3 個，其餘每個字一個空格 */
export function openingHint(en: string): { shown: string[]; blanks: number; mark: string } {
  const words = lineWords(en);
  const count = words.length <= 3 ? 1 : words.length <= 6 ? 2 : 3;
  const shown = words.slice(0, count);
  if (shown.length === words.length && shown.length > 0) shown[shown.length - 1] = bare(shown[shown.length - 1]);
  return { shown, blanks: Math.max(0, words.length - count), mark: endMark(en) };
}

/** 固定種子的亂數（同一輪重畫時字卡順序不變） */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 重組字卡：去掉每個字後面的標點（逗號會洩漏順序）再打散；打散後剛好跟原句同順序就轉一格 */
export function shuffledWords(en: string, seed: number): string[] {
  const words = lineWords(en).map(w => w.replace(/[,.?!;:]+$/, '')).filter(Boolean);
  const out = [...words];
  const rand = seeded(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  if (out.length > 1 && out.every((w, i) => w === words[i])) out.push(out.shift()!);
  return out;
}

export interface HintTiming {
  level: HintLevel;
  /** 升到目前這一級的時間（輪到自己時算第 0 級的開始） */
  levelAt: number;
  /** 最後一次偵測到自己出聲；0＝還沒開口 */
  lastVoiceAt: number;
  now: number;
}

/** 該不該自動升一級：從「升級或最後出聲」較晚的那個時間算起，沒開口等 4 秒、開口後停住等 2.5 秒 */
export function nextHintLevel(t: HintTiming): HintLevel {
  if (t.level >= MAX_HINT_LEVEL) return t.level;
  const wait = t.lastVoiceAt > 0 ? HINT_PAUSE_MS : HINT_SILENCE_MS;
  return t.now - Math.max(t.levelAt, t.lastVoiceAt) >= wait ? ((t.level + 1) as HintLevel) : t.level;
}
