import { describe, it, expect } from 'vitest';
import { currentStepIndex, isLessonDone, toLessonScreen, toggleStepDone, type HostLessonState } from './lessonSession.ts';
import type { DialogueTaskRecord } from '../types/dialogueTask.ts';

const record: DialogueTaskRecord = {
  id: 'r1', teacherUid: 't', institutionId: null, createdAt: '', updatedAt: '',
  task: {
    title: '服飾店購物', sceneId: 'clothingStore_cashier', level: 'A1',
    steps: [
      { id: 's1', title: '招呼', purpose: '問候引導', grammarPoints: [], grammarNote: '', teachingNotes: [], lines: [
        { id: 'a', speakerSlotId: 'cashier', en: 'Hello!', zh: '你好' },
        { id: 'b', speakerSlotId: 'customer', en: 'Hi.', zh: '嗨' },
        { id: 'c', speakerSlotId: 'cashier', en: '  ', zh: '（空白）' },
      ] },
      { id: 's2', title: '報價', purpose: '價格查詢', grammarPoints: [], grammarNote: '', teachingNotes: [], lines: [
        { id: 'd', speakerSlotId: 'customer', en: 'How much?', zh: '多少錢' },
        { id: 'e', speakerSlotId: 'ghost', en: '???', zh: '' },
      ] },
      { id: 's3', title: '結帳', purpose: '', grammarPoints: [], grammarNote: '', teachingNotes: [], lines: [] },
    ],
  },
};
const labels = { cashier: '收銀員', customer: '顧客' };
const lesson = (doneCount: number, showLines = false): HostLessonState => ({ record, doneCount, showLines });

describe('toLessonScreen', () => {
  it('只帶情境：目前步驟名稱、目的、角色與進度，不帶台詞', () => {
    expect(toLessonScreen(lesson(0), labels)).toEqual({
      taskTitle: '服飾店購物', stepIndex: 0, stepCount: 3, doneCount: 0, allDone: false,
      stepTitle: '招呼', purpose: '問候引導', roles: ['收銀員', '顧客'],
    });
  });

  it('老師開提示時才帶英文台詞，並略過空白台詞', () => {
    expect(toLessonScreen(lesson(0, true), labels)?.lines).toEqual([
      { speaker: '收銀員', en: 'Hello!' }, { speaker: '顧客', en: 'Hi.' },
    ]);
  });

  it('目前步驟 = 第一個未完成的步驟；找不到角色名稱時退回 slot id', () => {
    const screen = toLessonScreen(lesson(1), labels);
    expect(screen?.stepIndex).toBe(1);
    expect(screen?.roles).toEqual(['顧客', 'ghost']);
  });

  it('全部完成時停在最後一步、標記 allDone，且不再帶台詞', () => {
    const screen = toLessonScreen(lesson(3, true), labels);
    expect(screen).toMatchObject({ stepIndex: 2, doneCount: 3, allDone: true });
    expect(screen).not.toHaveProperty('lines');
  });
});

describe('toggleStepDone', () => {
  it('點目前步驟 → 完成並前進', () => {
    expect(toggleStepDone(lesson(0), 0)).toBe(1);
    expect(toggleStepDone(lesson(2), 2)).toBe(3);
  });

  it('點已完成的步驟 → 取消完成，回到那一步', () => {
    expect(toggleStepDone(lesson(2), 0)).toBe(0);
    expect(toggleStepDone(lesson(3), 2)).toBe(2);
  });

  it('不能跳著完成尚未輪到的步驟', () => {
    expect(toggleStepDone(lesson(0), 2)).toBe(0);
  });
});

describe('currentStepIndex / isLessonDone', () => {
  it('依完成數推算目前步驟與是否完成', () => {
    expect(currentStepIndex(lesson(0))).toBe(0);
    expect(currentStepIndex(lesson(2))).toBe(2);
    expect(currentStepIndex(lesson(3))).toBe(2);
    expect(isLessonDone(lesson(2))).toBe(false);
    expect(isLessonDone(lesson(3))).toBe(true);
  });
});
