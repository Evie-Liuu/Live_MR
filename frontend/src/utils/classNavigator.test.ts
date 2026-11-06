import { describe, expect, it } from 'vitest';
import { classNavState, type ClassNavInput, type NavTurn } from './classNavigator.ts';

const lesson = (over: Partial<NonNullable<ClassNavInput['lesson']>> = {}): NonNullable<ClassNavInput['lesson']> => ({
  phase: 'pre', allDone: false, unassignedRoles: [], checkpointCount: 0, isLastStep: false, turn: null, ...over,
});
const input = (over: Partial<ClassNavInput> = {}): ClassNavInput => ({
  bigScreenOpen: true, studentCount: 3, pendingCount: 0, lesson: null, pollActive: false, ...over,
});
const turn = (over: Partial<NavTurn> = {}): NavTurn => ({
  status: 'running', lineIndex: 2, lineCount: 12, speakerLabel: 'Staff A', speakerName: 'S01', speakerStatus: 'online', ...over,
});
const statusOf = (s: ReturnType<typeof classNavState>) => Object.fromEntries(s.stages.map(x => [x.id, x.status]));

describe('開課', () => {
  it('asks to open the big screen first', () => {
    const s = classNavState(input({ bigScreenOpen: false, studentCount: 0 }));
    expect(statusOf(s).open).toBe('current');
    expect(s.hint).toContain('大屏');
    expect(s.notice).toBeNull();
  });

  it('points to pending students before asking for more', () => {
    expect(classNavState(input({ studentCount: 0, pendingCount: 2 })).hint).toContain('2 位學生等待核准');
  });

  it('asks students to join when nobody is waiting', () => {
    expect(classNavState(input({ studentCount: 0 })).hint).toContain('掃 QR');
  });
});

describe('準備', () => {
  it('asks to choose a task', () => {
    const s = classNavState(input());
    expect(statusOf(s)).toMatchObject({ open: 'done', setup: 'current', pre: 'todo' });
    expect(s.hint).toContain('任務');
  });

  it('names the roles still missing', () => {
    const s = classNavState(input({ lesson: lesson({ unassignedRoles: ['Staff A', 'Customer A'] }) }));
    expect(statusOf(s).setup).toBe('current');
    expect(s.hint).toContain('還缺 2 位：Staff A、Customer A');
  });
});

describe('任務前', () => {
  it('moves on once everything is ready', () => {
    const s = classNavState(input({ lesson: lesson() }));
    expect(statusOf(s)).toMatchObject({ open: 'done', setup: 'done', pre: 'current', during: 'todo' });
  });
});

describe('任務中', () => {
  const during = (over: Partial<NonNullable<ClassNavInput['lesson']>> = {}) => input({ lesson: lesson({ phase: 'during', ...over }) });

  it('follows the real phase and never drags the teacher back', () => {
    const s = classNavState(input({ bigScreenOpen: false, studentCount: 0, lesson: lesson({ phase: 'during', unassignedRoles: ['Staff A'] }) }));
    expect(statusOf(s)).toMatchObject({ open: 'skipped', setup: 'skipped', pre: 'done', during: 'current', post: 'todo' });
  });

  it('warns when the big screen is closed during class', () => {
    expect(classNavState(input({ bigScreenOpen: false, lesson: lesson({ phase: 'during' }) })).notice).toContain('大屏沒有開啟');
  });

  it('asks to start the performance', () => {
    expect(classNavState(during()).hint).toContain('角色就位');
  });

  it('warns but still allows starting with a missing role', () => {
    const s = classNavState(during({ unassignedRoles: ['Staff A'] }));
    expect(s.warn).toBe(true);
    expect(s.hint).toContain('代讀');
  });

  it('shows who is on for each speaker status', () => {
    expect(classNavState(during({ turn: turn() })).hint).toBe('第 3／12 句：等 S01（Staff A）開口');
    expect(classNavState(during({ turn: turn({ speakerStatus: 'speaking' }) })).hint).toContain('S01說話中');
    expect(classNavState(during({ turn: turn({ speakerStatus: 'teacher' }) })).hint).toContain('輪到老師');
  });

  it('warns about offline or unassigned speakers', () => {
    expect(classNavState(during({ turn: turn({ speakerStatus: 'offline' }) }))).toMatchObject({ warn: true });
    expect(classNavState(during({ turn: turn({ speakerStatus: 'unassigned' }) })).hint).toContain('Staff A還沒指定');
  });

  it('handles pause', () => {
    expect(classNavState(during({ turn: turn({ status: 'paused' }) })).hint).toContain('暫停');
  });

  it('mentions checkpoints at the end of a step', () => {
    const s = classNavState(during({ checkpointCount: 2, turn: turn({ status: 'stepEnd' }) }));
    expect(s.hint).toContain('2 題台下互動');
    expect(s.hint).toContain('完成並進入下一步');
  });

  it('uses the finish wording on the last step', () => {
    expect(classNavState(during({ isLastStep: true, turn: turn({ status: 'stepEnd' }) })).hint).toContain('完成展演');
  });

  it('prioritises an active poll', () => {
    expect(classNavState(input({ pollActive: true, lesson: lesson({ phase: 'during', turn: turn() }) })).hint).toContain('作答中');
  });

  it('sends the teacher to the discussion when all steps are done', () => {
    expect(classNavState(during({ allDone: true })).hint).toContain('任務後');
  });
});

describe('任務後', () => {
  it('explains how to finish the class', () => {
    const s = classNavState(input({ lesson: lesson({ phase: 'post' }) }));
    expect(statusOf(s)).toMatchObject({ during: 'done', post: 'current' });
    expect(s.hint).toContain('離開課堂');
  });
});
