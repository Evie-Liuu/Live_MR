import { describe, it, expect } from 'vitest';
import {
  advanceTurn, backTurn, jumpTurn, resolveTurn, setTurnPaused, startTurn, stepLines, turnRoleOf, type TurnCast,
} from './scriptTurn.ts';
import type { HostLessonState } from './lessonSession.ts';
import type { DialogueTaskRecord } from '../types/dialogueTask.ts';
import { ROLE_COLORS } from './nameplates.ts';

const record: DialogueTaskRecord = {
  id: 'r1', teacherUid: 't', institutionId: null, createdAt: '', updatedAt: '',
  task: {
    title: '服飾店', sceneId: 'clothingStore_cashier', level: 'A1',
    castOptions: [{ merge: { customer2: 'customer' } }],
    steps: [
      { id: 's1', title: '招呼', purpose: '', grammarPoints: [], grammarNote: '', teachingNotes: [], lines: [
        { id: 'a', speakerSlotId: 'staff', en: 'Hello!', zh: '你好' },
        { id: 'b', speakerSlotId: 'customer', en: '  ', zh: '（空白）' },
        { id: 'c', speakerSlotId: 'customer2', en: 'Hi.', zh: '嗨' },
        { id: 'd', speakerSlotId: 'customer', en: 'I need a shirt.', zh: '我要襯衫' },
      ] },
      { id: 's2', title: '空', purpose: '', grammarPoints: [], grammarNote: '', teachingNotes: [], lines: [] },
    ],
  },
};
const lesson = (extra: Partial<HostLessonState> = {}): HostLessonState => (
  { record, doneCount: 0, showLines: false, phase: 'during', questionIndex: 0, ...extra }
);
const cast: TurnCast = {
  slots: [{ id: 'staff', label: '店員' }, { id: 'customer', label: '顧客A' }, { id: 'customer2', label: '顧客B' }],
  slotAssignments: { staff: 'host-1', customer: 'stu-a', customer2: 'stu-b' },
  names: { 'host-1': '王老師', 'stu-a': '小明', 'stu-b': '小華' },
};

describe('scriptTurn', () => {
  it('跳過英文空白的台詞', () => {
    expect(stepLines(lesson()).map(l => l.id)).toEqual(['a', 'c', 'd']);
  });

  it('推導發言者、下一位與角色色', () => {
    const turn = resolveTurn(lesson(), startTurn(lesson()), cast)!;
    expect(turn.speaker).toEqual({ slotId: 'staff', label: '店員', color: ROLE_COLORS[0], identity: 'host-1', name: '王老師' });
    expect(turn.next?.name).toBe('小華');
    expect(turn.nextLine).toBe('Hi.');
    expect(turn.lineCount).toBe(3);
  });

  it('併角後由接手的人說', () => {
    const merged = lesson({ castSize: 2 });
    const t = jumpTurn(merged, startTurn(merged), 1);
    const turn = resolveTurn(merged, t, cast)!;
    expect(turn.speaker.slotId).toBe('customer');
    expect(turn.speaker.name).toBe('小明');
    expect(turn.next?.identity).toBe('stu-a');
  });

  it('最後一句說完變 stepEnd，上一句回到最後一句重演', () => {
    let t = startTurn(lesson());
    t = advanceTurn(lesson(), t);
    t = advanceTurn(lesson(), t);
    expect(t).toMatchObject({ lineIndex: 2, status: 'running' });
    t = advanceTurn(lesson(), t);
    expect(t).toMatchObject({ lineIndex: 2, status: 'stepEnd' });
    expect(resolveTurn(lesson(), t, cast)?.next).toBeNull();
    expect(backTurn(lesson(), t)).toMatchObject({ lineIndex: 2, status: 'running' });
  });

  it('每次變化 seq 都會增加', () => {
    const a = startTurn(lesson());
    const seqs = [a, advanceTurn(lesson(), a), backTurn(lesson(), a), jumpTurn(lesson(), a, 2), setTurnPaused(a, true)].map(t => t.seq);
    expect(seqs[0]).toBe(1);
    expect(seqs.slice(1).every(s => s === 2)).toBe(true);
  });

  it('沒有台詞的步驟直接 stepEnd，推導結果為 null', () => {
    const empty = lesson({ doneCount: 1 });
    expect(startTurn(empty).status).toBe('stepEnd');
    expect(resolveTurn(empty, startTurn(empty), cast)).toBeNull();
  });

  it('未指派的角色', () => {
    const turn = resolveTurn(lesson(), startTurn(lesson()), { ...cast, slotAssignments: {} })!;
    expect(turn.speaker).toMatchObject({ identity: null, name: '未指派' });
  });

  it('學生端狀態：只有 running 時分發言／聆聽', () => {
    const turn = resolveTurn(lesson(), jumpTurn(lesson(), startTurn(lesson()), 1), cast)!;
    expect(turnRoleOf(turn, 'stu-b')).toBe('speaking');
    expect(turnRoleOf(turn, 'stu-a')).toBe('listening');
    expect(turnRoleOf({ ...turn, status: 'paused' }, 'stu-b')).toBe('idle');
    expect(turnRoleOf(null, 'stu-b')).toBe('idle');
  });
});
