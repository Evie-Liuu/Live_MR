import { describe, it, expect } from 'vitest';
import {
  JUDGE_PAUSE_MS, MAX_JUDGES_PER_TURN, NO_RESPONSE_MS,
  assistFeedback, choiceOptions, distractorLines, isNoResponse, shouldJudgeOnDone, shouldJudgeOnPause, spokenPrefix,
} from './speechAssist.ts';
import type { TurnJudgment } from '../types/speechAssist.ts';

const timing = { now: 10_000, lastVoiceAt: 10_000 - JUDGE_PAUSE_MS, judgedVoiceAt: 0, judges: 0, pending: false };

describe('什麼時候送 AI 判斷', () => {
  it('開口後停住夠久才送', () => {
    expect(shouldJudgeOnPause(timing)).toBe(true);
    expect(shouldJudgeOnPause({ ...timing, lastVoiceAt: timing.now - 1000 })).toBe(false);
    expect(shouldJudgeOnPause({ ...timing, lastVoiceAt: 0 })).toBe(false);
  });

  it('上次判斷後沒再說話、正在等結果、或已達上限就不送', () => {
    expect(shouldJudgeOnPause({ ...timing, judgedVoiceAt: timing.lastVoiceAt })).toBe(false);
    expect(shouldJudgeOnPause({ ...timing, pending: true })).toBe(false);
    expect(shouldJudgeOnPause({ ...timing, judges: MAX_JUDGES_PER_TURN })).toBe(false);
  });

  it('按「我說完了」：上次判斷後有說話就再判斷一次', () => {
    expect(shouldJudgeOnDone({ ...timing })).toBe(true);
    expect(shouldJudgeOnDone({ ...timing, judgedVoiceAt: timing.lastVoiceAt })).toBe(false);
    expect(shouldJudgeOnDone({ ...timing, lastVoiceAt: 0 })).toBe(false);
  });

  it('一直沒出聲才算完全沒有回應', () => {
    expect(isNoResponse({ now: NO_RESPONSE_MS, turnAt: 0, lastVoiceAt: 0 })).toBe(true);
    expect(isNoResponse({ now: NO_RESPONSE_MS - 1, turnAt: 0, lastVoiceAt: 0 })).toBe(false);
    expect(isNoResponse({ now: NO_RESPONSE_MS, turnAt: 0, lastVoiceAt: 5 })).toBe(false);
  });
});

describe('沒回應時的選項', () => {
  const lines = ['A?', 'B.', 'C!', 'D.', 'b.'];

  it('優先挑隔一句以上的台詞，不重複、不含正確台詞', () => {
    expect(distractorLines(lines, 0)).toEqual(['C!', 'D.']);
    expect(distractorLines(lines, 3)).toEqual(['B.', 'A?']);
    expect(distractorLines(['Hi.', 'Hi.', 'Bye.'], 0)).toEqual(['Bye.']);
    expect(distractorLines(['Only.'], 0)).toEqual([]);
  });

  it('正確台詞的位置依 seq 固定', () => {
    expect(choiceOptions('X', ['a', 'b'], 4)).toEqual({ options: ['a', 'X', 'b'], answer: 1 });
    expect(choiceOptions('X', ['a', 'b'], 4)).toEqual(choiceOptions('X', ['a', 'b'], 4));
    expect(choiceOptions('X', ['a'], 3).options[choiceOptions('X', ['a'], 3).answer]).toBe('X');
  });
});

describe('AI 判斷結果怎麼呈現', () => {
  const line = { en: "They're pineapple cakes. They're popular in Taiwan." };
  const j = (over: Partial<TurnJudgment>): TurnJudgment => ({
    transcript: '', language: 'en', missing: [], wrong: [], issues: [], severity: 'severe', ...over,
  });

  it('正確、輕微不介入；沒有回應交給選項', () => {
    expect(assistFeedback(j({ severity: 'ok' }), line)).toBeNull();
    expect(assistFeedback(j({ severity: 'minor', issues: ['incomplete'] }), line)).toBeNull();
    expect(assistFeedback(j({ language: 'silent', issues: ['noResponse'] }), line)).toBeNull();
  });

  it('說中文：鼓勵用英文，從說到的英文接著給句型開頭', () => {
    expect(assistFeedback(j({ transcript: '這些是鳳梨酥', language: 'zh', issues: ['chinese'] }), line))
      .toEqual({ kind: 'chinese', shown: ["They're"], blanks: 6 });
    expect(assistFeedback(j({ transcript: "They're 鳳梨酥", language: 'mixed', issues: ['chinese', 'incomplete'] }), line))
      .toEqual({ kind: 'chinese', shown: ["They're", 'pineapple'], blanks: 5 });
  });

  it('說錯字：給正確的字', () => {
    expect(assistFeedback(j({ issues: ['wrongWord'], wrong: [{ said: 'apple', expected: 'pineapple' }] }), line))
      .toEqual({ kind: 'wrongWord', pairs: [{ said: 'apple', expected: 'pineapple' }] });
  });

  it('沒說完：從說到的地方多給一個字', () => {
    expect(assistFeedback(j({ transcript: "um they're pineapple", issues: ['incomplete'] }), line))
      .toEqual({ kind: 'incomplete', shown: ["They're", 'pineapple', 'cakes.'], blanks: 4 });
    // 什麼都沒對上：至少給第一個字；全部說完也不給完整句
    expect(assistFeedback(j({ transcript: 'hello', issues: ['incomplete'] }), { en: 'Sure! Thank you!' }))
      .toEqual({ kind: 'incomplete', shown: ['Sure!'], blanks: 2 });
    expect(assistFeedback(j({ transcript: 'sure thank you', issues: ['incomplete'] }), { en: 'Sure! Thank you!' }))
      .toEqual({ kind: 'incomplete', shown: ['Sure!', 'Thank'], blanks: 1 });
  });

  it('spokenPrefix 忽略大小寫、標點、填詞，可跳過一個說錯的字', () => {
    expect(spokenPrefix("I'm from, uh, Los Angeles", "I'm from Los Angeles.")).toBe(4);
    expect(spokenPrefix('I from Los', "I'm from Los Angeles.")).toBe(3);
    expect(spokenPrefix('Toronto', "I'm from Los Angeles.")).toBe(0);
    expect(spokenPrefix("I'm frum Los Angeles", "I'm from Los Angeles.")).toBe(4);
  });
});
