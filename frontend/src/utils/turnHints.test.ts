import { describe, it, expect } from 'vitest';
import { HINT_PAUSE_MS, HINT_SILENCE_MS, keywords, nextHintLevel, openingHint, shuffledWords } from './turnHints.ts';

describe('turnHints', () => {
  it('關鍵字去掉功能詞、取最長的並保持句中順序', () => {
    expect(keywords('I want a red T-shirt in size medium, please.')).toEqual(['T-shirt', 'size', 'medium']);
    expect(keywords('Hi.')).toEqual([]);
  });

  it('開頭提示依句長給 1–3 個字，保留句尾標點', () => {
    expect(openingHint('Can I pay by card?')).toEqual({ shown: ['Can', 'I'], blanks: 3, mark: '?' });
    expect(openingHint('Thank you.')).toEqual({ shown: ['Thank'], blanks: 1, mark: '.' });
    expect(openingHint('I want a red T-shirt, please.').shown).toEqual(['I', 'want']);
    expect(openingHint('Hello!')).toEqual({ shown: ['Hello'], blanks: 0, mark: '!' });
  });

  it('重組字卡固定種子、不會跟原句同順序、去掉標點', () => {
    const a = shuffledWords('Can I pay by card?', 7);
    expect(shuffledWords('Can I pay by card?', 7)).toEqual(a);
    expect([...a].sort()).toEqual(['Can', 'I', 'by', 'card', 'pay'].sort());
    expect(a).not.toEqual(['Can', 'I', 'pay', 'by', 'card']);
    expect(shuffledWords('Yes, please.', 1)).toEqual(['please', 'Yes']);
  });

  it('沒開口等 4 秒、開口後停住等 2.5 秒才升級，最多到完整', () => {
    const base = { level: 0 as const, levelAt: 1000, lastVoiceAt: 0 };
    expect(nextHintLevel({ ...base, now: 1000 + HINT_SILENCE_MS - 1 })).toBe(0);
    expect(nextHintLevel({ ...base, now: 1000 + HINT_SILENCE_MS })).toBe(1);
    // 說到一半停住：從最後出聲算
    expect(nextHintLevel({ ...base, lastVoiceAt: 3000, now: 3000 + HINT_PAUSE_MS - 1 })).toBe(0);
    expect(nextHintLevel({ ...base, lastVoiceAt: 3000, now: 3000 + HINT_PAUSE_MS })).toBe(1);
    // 剛升級：從升級時間算
    expect(nextHintLevel({ level: 1, levelAt: 9000, lastVoiceAt: 3000, now: 9000 + HINT_PAUSE_MS - 1 })).toBe(1);
    expect(nextHintLevel({ level: 3, levelAt: 0, lastVoiceAt: 0, now: 99999 })).toBe(3);
  });
});
