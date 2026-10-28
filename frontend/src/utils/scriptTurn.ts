/**
 * 逐句輪流演練：老師端保存「目前步驟的第幾句」，由這裡推導出這一輪的發言者與下一位，
 * 廣播給學生 iPad（發言／聆聽畫面）與大屏。
 *
 * 台詞取自併角後的劇本（lessonTask），所以少人數演出時接手的人自然變成發言者；
 * 英文空白的台詞跳過。seq 每次換句、換發言者都 +1，學生回報「說完了」時帶回，用來丟掉過期回報。
 */
import type { DialogueLine } from '../types/dialogueTask.ts';
import { ROLE_COLORS } from './nameplates.ts';
import type { TurnHintMode } from './turnHints.ts';
import { currentStepIndex, isLessonDone, lessonTask, type HostLessonState } from './lessonSession.ts';

/** 大屏重開時讀取目前這一輪 */
export const BIGSCREEN_TURN_STORAGE_KEY = 'bigscreen-script-turn';
/** 大屏重開時讀取目前的提示等級 */
export const BIGSCREEN_TURN_HINT_STORAGE_KEY = 'bigscreen-turn-hint';

export interface ScriptTurnState {
  /** 目前步驟內的台詞序號（跳過英文空白的台詞後，0 起算） */
  lineIndex: number;
  seq: number;
  /** running：演練中；paused：暫停（全員回一般畫面、麥克風恢復）；stepEnd：本步最後一句說完 */
  status: 'running' | 'paused' | 'stepEnd';
}

export interface TurnPerson {
  /** 併角後的角色 */
  slotId: string;
  label: string;
  color: string;
  /** 未指派時為 null */
  identity: string | null;
  name: string;
}

/** 廣播給學生與大屏的這一輪 */
export interface ScriptTurn {
  seq: number;
  status: ScriptTurnState['status'];
  stepIndex: number;
  lineIndex: number;
  lineCount: number;
  speaker: TurnPerson;
  /** 下一句的發言者；本步最後一句時為 null */
  next: TurnPerson | null;
  line: { en: string; zh: string };
  /** 下一句的英文（給下一位先準備） */
  nextLine: string | null;
  /** 發言者畫面的台詞提示方式 */
  hintMode: TurnHintMode;
  /** 分級提示依沉默時間自動升級；false＝只由老師手動給 */
  hintAuto: boolean;
}

export interface TurnCast {
  slots: readonly { id: string; label: string }[];
  slotAssignments: Record<string, string>;
  /** identity → 顯示名稱 */
  names: Record<string, string>;
}

/** 目前步驟要演的台詞（併角後、跳過英文空白的） */
export function stepLines(lesson: HostLessonState): DialogueLine[] {
  const step = lessonTask(lesson).steps[currentStepIndex(lesson)];
  return step ? step.lines.filter(l => l.en.trim()) : [];
}

export function startTurn(lesson: HostLessonState, prev?: ScriptTurnState): ScriptTurnState {
  return { lineIndex: 0, seq: (prev?.seq ?? 0) + 1, status: stepLines(lesson).length > 0 ? 'running' : 'stepEnd' };
}

/**
 * 步驟、階段或演出人數改變後：演練中就從該步第一句重來；離開「任務中」或全部完成時結束演練。
 */
export function restartTurnIfActive(lesson: HostLessonState): HostLessonState {
  if (!lesson.turn) return lesson;
  if (lesson.phase !== 'during' || isLessonDone(lesson)) {
    const next = { ...lesson };
    delete next.turn;
    return next;
  }
  return { ...lesson, turn: startTurn(lesson, lesson.turn) };
}

/** 下一句；最後一句說完 → stepEnd（停在最後一句） */
export function advanceTurn(lesson: HostLessonState, turn: ScriptTurnState): ScriptTurnState {
  const count = stepLines(lesson).length;
  if (turn.lineIndex + 1 >= count) return { ...turn, lineIndex: Math.max(0, count - 1), seq: turn.seq + 1, status: 'stepEnd' };
  return { lineIndex: turn.lineIndex + 1, seq: turn.seq + 1, status: 'running' };
}

export function backTurn(lesson: HostLessonState, turn: ScriptTurnState): ScriptTurnState {
  // 本步結束時按上一句：回到最後一句重演
  const lineIndex = turn.status === 'stepEnd' ? turn.lineIndex : Math.max(0, turn.lineIndex - 1);
  return jumpTurn(lesson, turn, lineIndex);
}

export function jumpTurn(lesson: HostLessonState, turn: ScriptTurnState, lineIndex: number): ScriptTurnState {
  const count = stepLines(lesson).length;
  if (count === 0) return { ...turn, lineIndex: 0, seq: turn.seq + 1, status: 'stepEnd' };
  return { lineIndex: Math.min(Math.max(0, lineIndex), count - 1), seq: turn.seq + 1, status: 'running' };
}

export function setTurnPaused(turn: ScriptTurnState, paused: boolean): ScriptTurnState {
  if (turn.status === 'stepEnd') return turn;
  return { ...turn, seq: turn.seq + 1, status: paused ? 'paused' : 'running' };
}

function person(slotId: string, cast: TurnCast): TurnPerson {
  const index = cast.slots.findIndex(s => s.id === slotId);
  const identity = cast.slotAssignments[slotId] || null;
  return {
    slotId,
    label: cast.slots[index]?.label ?? slotId,
    color: ROLE_COLORS[(index < 0 ? 0 : index) % ROLE_COLORS.length],
    identity,
    name: identity ? (cast.names[identity] || identity) : '未指派',
  };
}

/** 目前步驟每句的發言者與英文（老師端台詞清單） */
export function stepCastLines(lesson: HostLessonState, cast: TurnCast): { id: string; en: string; speaker: TurnPerson }[] {
  return stepLines(lesson).map(l => ({ id: l.id, en: l.en, speaker: person(l.speakerSlotId, cast) }));
}

/** 推導這一輪；步驟沒有台詞時回 null */
export function resolveTurn(lesson: HostLessonState, turn: ScriptTurnState, cast: TurnCast): ScriptTurn | null {
  const lines = stepLines(lesson);
  if (lines.length === 0) return null;
  const lineIndex = Math.min(Math.max(0, turn.lineIndex), lines.length - 1);
  const line = lines[lineIndex];
  const nextLine = turn.status === 'stepEnd' ? undefined : lines[lineIndex + 1];
  return {
    seq: turn.seq,
    status: turn.status,
    stepIndex: currentStepIndex(lesson),
    lineIndex,
    lineCount: lines.length,
    speaker: person(line.speakerSlotId, cast),
    next: nextLine ? person(nextLine.speakerSlotId, cast) : null,
    line: { en: line.en, zh: line.zh },
    nextLine: nextLine?.en ?? null,
    hintMode: lesson.turnHintMode ?? 'tiered',
    hintAuto: lesson.turnHintAuto === true,
  };
}

/** 學生端：這一輪自己的狀態 */
export type TurnRole = 'speaking' | 'listening' | 'idle';

export function turnRoleOf(turn: ScriptTurn | null, identity: string | null | undefined): TurnRole {
  if (!turn || turn.status !== 'running' || !identity) return 'idle';
  return turn.speaker.identity === identity ? 'speaking' : 'listening';
}
