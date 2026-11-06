/**
 * 課堂導航（唯讀）：依目前課堂狀態告訴老師「現在在哪、下一步做什麼、還缺什麼」。
 * 只讀狀態、不鎖任何功能；老師跳步或手動切換階段時，導航跟著實際狀態走。
 */
import type { LessonPhase } from '../config/lessonPhases.ts';

export type NavStageId = 'open' | 'setup' | 'pre' | 'during' | 'post';
/** skipped＝老師已往後走，但這一步的條件還沒滿足 */
export type NavStageStatus = 'done' | 'current' | 'todo' | 'skipped';

export const NAV_STAGES: readonly { id: NavStageId; label: string }[] = [
  { id: 'open', label: '開課' },
  { id: 'setup', label: '準備' },
  { id: 'pre', label: '任務前' },
  { id: 'during', label: '任務中' },
  { id: 'post', label: '任務後' },
];

export interface NavTurn {
  status: 'running' | 'paused' | 'stepEnd';
  lineIndex: number;
  lineCount: number;
  speakerLabel: string;
  speakerName: string;
  speakerStatus: 'speaking' | 'online' | 'offline' | 'unassigned' | 'teacher';
}

export interface ClassNavInput {
  bigScreenOpen: boolean;
  studentCount: number;
  pendingCount: number;
  /** 沒選任務時為 null */
  lesson: {
    phase: LessonPhase;
    allDone: boolean;
    /** 還沒指定演出者的角色名稱 */
    unassignedRoles: string[];
    /** 目前步驟可發布的台下互動題數 */
    checkpointCount: number;
    isLastStep: boolean;
    turn: NavTurn | null;
  } | null;
  /** 台下互動題作答中 */
  pollActive: boolean;
}

export interface ClassNavState {
  stages: { id: NavStageId; label: string; status: NavStageStatus }[];
  /** 下一步要做什麼 */
  hint: string;
  /** hint 是需要老師處理的問題 */
  warn: boolean;
  /** 額外提醒（例如上課中大屏被關掉） */
  notice: string | null;
}

function openHint(input: ClassNavInput): string {
  if (!input.bigScreenOpen) return '點右下角的大屏按鈕，開啟大屏顯示';
  if (input.pendingCount > 0) return `有 ${input.pendingCount} 位學生等待核准，點右上角「${input.studentCount} 位學生」`;
  return '點右上角「分享」，請學生掃 QR 加入';
}

function setupHint(input: ClassNavInput): string {
  if (!input.lesson) return '點左側「任務」選擇這堂課要演的任務';
  const roles = input.lesson.unassignedRoles;
  return `點左側「角色」指定演出者，還缺 ${roles.length} 位：${roles.join('、')}`;
}

function duringHint(lesson: NonNullable<ClassNavInput['lesson']>, pollActive: boolean): { hint: string; warn: boolean } {
  if (pollActive) return { hint: '台下互動作答中：等學生答完，結束作答後公布答案', warn: false };
  if (lesson.allDone) return { hint: '所有步驟都完成了，切到「任務後」帶討論', warn: false };

  const turn = lesson.turn;
  if (!turn) {
    const roles = lesson.unassignedRoles;
    if (roles.length > 0) return { hint: `還沒指定：${roles.join('、')}。也可以由老師代讀，再按右側「角色就位」`, warn: true };
    return { hint: '按右側「角色就位」，開始逐句演出', warn: false };
  }
  if (turn.status === 'paused') return { hint: '演出已暫停，按右側的繼續鈕接著演', warn: false };
  if (turn.status === 'stepEnd') {
    const next = lesson.isLastStep ? '按「完成展演」' : '按「完成並進入下一步」';
    if (lesson.checkpointCount > 0) return { hint: `這一步演完了，有 ${lesson.checkpointCount} 題台下互動可以發布，之後${next}`, warn: false };
    return { hint: `這一步演完了，${next}`, warn: false };
  }

  const line = `第 ${turn.lineIndex + 1}／${turn.lineCount} 句`;
  switch (turn.speakerStatus) {
    case 'unassigned': return { hint: `${line}：${turn.speakerLabel}還沒指定，可由老師代讀或略過`, warn: true };
    case 'offline': return { hint: `${line}：${turn.speakerName}離線中，可由老師代讀或略過`, warn: true };
    case 'teacher': return { hint: `${line}：輪到老師演${turn.speakerLabel}，說完按「下一句」`, warn: false };
    case 'speaking': return { hint: `${line}：${turn.speakerName}說話中，說完由學生按「我說完了」或老師按「下一句」`, warn: false };
    default: return { hint: `${line}：等 ${turn.speakerName}（${turn.speakerLabel}）開口`, warn: false };
  }
}

export function classNavState(input: ClassNavInput): ClassNavState {
  const { lesson } = input;
  const openDone = input.bigScreenOpen && input.studentCount > 0;
  const setupDone = !!lesson && lesson.unassignedRoles.length === 0;
  const phase = lesson?.phase;

  // 老師切到任務中／任務後就以實際階段為準，前面沒做完的標成跳過，不把他拉回去
  let current: NavStageId;
  if (phase === 'during' || phase === 'post') current = phase;
  else if (!openDone) current = 'open';
  else if (!setupDone) current = 'setup';
  else current = 'pre';

  const currentIndex = NAV_STAGES.findIndex(s => s.id === current);
  const isDone = (id: NavStageId) => (id === 'open' ? openDone : id === 'setup' ? setupDone : true);
  const stages = NAV_STAGES.map((s, i) => {
    let status: NavStageStatus = 'todo';
    if (i === currentIndex) status = 'current';
    else if (i < currentIndex) status = isDone(s.id) ? 'done' : 'skipped';
    return { ...s, status };
  });

  let hint: string;
  let warn = false;
  if (current === 'open') hint = openHint(input);
  else if (current === 'setup') hint = setupHint(input);
  else if (current === 'pre') hint = '點一題提問投到大屏帶暖身，完成後切到「任務中」';
  else if (current === 'during') ({ hint, warn } = duringHint(lesson!, input.pollActive));
  else hint = '點提問帶討論；討論完點左上角 Logo 離開課堂';

  const notice = current !== 'open' && !input.bigScreenOpen ? '大屏沒有開啟，學生看不到畫面' : null;
  return { stages, hint, warn, notice };
}
