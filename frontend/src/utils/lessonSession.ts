/**
 * 上課時「導師任務管理」的狀態：教師端保存整份對話任務與完成進度，
 * 大螢幕只收到情境（步驟名稱、目的、角色），台詞要老師開提示才會帶上。
 *
 * 步驟依序完成：doneCount = 已完成的步驟數，目前步驟 = 第一個未完成的步驟。
 * 一堂課分三階段（任務前 / 任務中 / 任務後），由老師手動切換；
 * 任務前、任務後一次聚焦一題提問（questionIndex），大螢幕只顯示該題。
 */
import { applyCastMerge, castChoices, type DialogueTask, type DialogueTaskRecord } from '../types/dialogueTask.ts';
import type { CefrLevel } from '../types/lessonPlan.ts';
import { phaseContent, type LessonPhase } from '../config/lessonPhases.ts';
import type { ScriptTurnState } from './scriptTurn.ts';
import type { TurnHintMode } from './turnHints.ts';

/** 教師端的上課狀態（存在 sessionStorage，重整後還原） */
export interface HostLessonState {
  record: DialogueTaskRecord;
  /** 已完成的步驟數（0 ~ 步驟總數） */
  doneCount: number;
  /** 大螢幕是否顯示目前步驟的英文台詞 */
  showLines: boolean;
  /** 目前階段 */
  phase: LessonPhase;
  /** 任務前 / 任務後目前聚焦的提問（0 起算） */
  questionIndex: number;
  /** 演出人數（任務有併角方案時可選）；未設定＝完整人數 */
  castSize?: number;
  /** 逐句輪流演練（見 utils/scriptTurn.ts）；沒有＝沒在演練 */
  turn?: ScriptTurnState;
  /** 逐句演練的台詞提示；未設定＝分級提示 */
  turnHintMode?: TurnHintMode;
  /** 分級提示是否依沉默時間自動升級；未設定＝不自動（老師手動點選） */
  turnHintAuto?: boolean;
}

/** 送到大螢幕的課程狀態 */
export interface LessonScreenState {
  taskTitle: string;
  /** 目前步驟（0 起算；全部完成時為最後一步） */
  stepIndex: number;
  stepCount: number;
  doneCount: number;
  allDone: boolean;
  stepTitle: string;
  purpose: string;
  /** 這一步出場的角色名稱（依第一次出現的順序） */
  roles: string[];
  /** 所有步驟的名稱與目的（給完成視窗列出，不含台詞） */
  steps: { title: string; purpose: string }[];
  /** 只有老師開啟台詞提示、任務中且課程尚未完成時才有 */
  lines?: { speaker: string; en: string }[];
  phase: LessonPhase;
  /** 任務程度（例如 'preA1-A1' 代表國小中低年級） */
  level?: CefrLevel;
  /** 任務前 / 任務後：目前聚焦的提問 */
  prompt?: { en: string; zh: string; index: number; count: number };
  /** 任務前 / 任務後：句型框架 */
  frames?: string[];
  /** 任務後：語言重點 */
  focusPoints?: string[];
}

export const HOST_LESSON_STORAGE_KEY = 'host-lesson';
export const BIGSCREEN_LESSON_STORAGE_KEY = 'bigscreen-lesson';

function stepCount(lesson: HostLessonState): number {
  return lesson.record.task.steps.length;
}

/** 已完成步驟數限制在 0 ~ 步驟總數 */
/**
 * 任務需要的角色：有台詞的場景 slot 與各自的台詞句數（依第一次出場順序）。
 * 角色指定排在選定任務之後，老師依句數分配學生，沒有台詞的 slot 不必指定。
 */
export function taskCast(task: DialogueTask): { slotId: string; lines: number }[] {
  const counts = new Map<string, number>();
  for (const line of task.steps.flatMap(s => s.lines)) {
    counts.set(line.speakerSlotId, (counts.get(line.speakerSlotId) ?? 0) + 1);
  }
  return [...counts].map(([slotId, lines]) => ({ slotId, lines }));
}

/** 目前演出人數下的任務：被併掉角色的台詞改由對應角色說（找不到該人數時用完整人數） */
export function lessonTask(lesson: HostLessonState): DialogueTask {
  const { task } = lesson.record;
  const choice = lesson.castSize === undefined ? undefined : castChoices(task).find(c => c.size === lesson.castSize);
  return choice ? applyCastMerge(task, choice.merge) : task;
}

export function clampDoneCount(lesson: HostLessonState, doneCount: number): number {
  return Math.min(Math.max(0, doneCount), stepCount(lesson));
}

/** 目前步驟 = 第一個未完成的步驟；全部完成時停在最後一步 */
export function currentStepIndex(lesson: HostLessonState): number {
  return Math.max(0, Math.min(lesson.doneCount, stepCount(lesson) - 1));
}

export function isLessonDone(lesson: HostLessonState): boolean {
  return stepCount(lesson) > 0 && lesson.doneCount >= stepCount(lesson);
}

/**
 * 點擊第 index 步：點目前步驟 → 標記完成；點已完成的步驟 → 取消完成（回到那一步）；
 * 尚未輪到的步驟不能跳著完成。回傳新的 doneCount。
 */
export function toggleStepDone(lesson: HostLessonState, index: number): number {
  if (index < lesson.doneCount) return index;
  if (index === lesson.doneCount) return clampDoneCount(lesson, index + 1);
  return lesson.doneCount;
}

/** 切換階段：提問從第一題開始 */
export function setLessonPhase(lesson: HostLessonState, phase: LessonPhase): HostLessonState {
  return { ...lesson, phase, questionIndex: 0 };
}

/** 選擇任務前 / 任務後的第 index 題（限制在題目範圍內） */
export function setQuestionIndex(lesson: HostLessonState, index: number): HostLessonState {
  const count = phaseContent(lesson.record.task, lesson.phase).questions.length;
  return { ...lesson, questionIndex: Math.min(Math.max(0, index), Math.max(0, count - 1)) };
}

/** 教師端狀態 → 大螢幕狀態；slotLabels 用來把角色 id 轉成中文名稱 */
export function toLessonScreen(lesson: HostLessonState, slotLabels: Record<string, string>): LessonScreenState | null {
  const task = lessonTask(lesson);
  const index = currentStepIndex(lesson);
  const step = task.steps[index];
  if (!step) return null;
  const allDone = isLessonDone(lesson);
  const label = (slotId: string) => slotLabels[slotId] ?? slotId;
  const roles: string[] = [];
  for (const line of step.lines) {
    const name = label(line.speakerSlotId);
    if (!roles.includes(name)) roles.push(name);
  }
  return {
    taskTitle: task.title,
    stepIndex: index,
    stepCount: task.steps.length,
    doneCount: clampDoneCount(lesson, lesson.doneCount),
    allDone,
    stepTitle: step.title,
    purpose: step.purpose,
    roles,
    steps: task.steps.map(s => ({ title: s.title, purpose: s.purpose })),
    phase: lesson.phase,
    level: task.level,
    ...(lesson.phase === 'during' && lesson.showLines && !allDone
      ? { lines: step.lines.filter(l => l.en.trim()).map(l => ({ speaker: label(l.speakerSlotId), en: l.en })) }
      : {}),
    ...phaseScreen(lesson),
  };
}

function phaseScreen(lesson: HostLessonState): Partial<LessonScreenState> {
  if (lesson.phase === 'during') return {};
  const content = phaseContent(lesson.record.task, lesson.phase);
  const count = content.questions.length;
  const index = Math.min(Math.max(0, lesson.questionIndex), Math.max(0, count - 1));
  const q = content.questions[index];
  return {
    ...(q ? { prompt: { en: q.en, zh: q.zh, index, count } } : {}),
    frames: content.frames,
    ...(content.focusPoints.length > 0 ? { focusPoints: content.focusPoints } : {}),
  };
}

export function loadHostLesson(): HostLessonState | null {
  try {
    const raw = sessionStorage.getItem(HOST_LESSON_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HostLessonState> & { stepIndex?: number };
    if (!parsed?.record?.task?.steps) return null;
    // 舊格式只有 stepIndex：視為前面的步驟都已完成
    const doneCount = typeof parsed.doneCount === 'number' ? parsed.doneCount : (parsed.stepIndex ?? 0);
    // 沒有階段資訊的舊狀態：視為正在任務中
    const phase: LessonPhase = parsed.phase === 'pre' || parsed.phase === 'post' ? parsed.phase : 'during';
    const questionIndex = typeof parsed.questionIndex === 'number' ? parsed.questionIndex : 0;
    const castSize = typeof parsed.castSize === 'number' ? parsed.castSize : undefined;
    const t = parsed.turn;
    const turn = t && typeof t.lineIndex === 'number' && typeof t.seq === 'number' && ['running', 'paused', 'stepEnd'].includes(t.status)
      ? { lineIndex: t.lineIndex, seq: t.seq, status: t.status }
      : undefined;
    return {
      record: parsed.record, doneCount, showLines: !!parsed.showLines, phase, questionIndex,
      ...(castSize !== undefined ? { castSize } : {}),
      ...(turn ? { turn } : {}),
      ...(parsed.turnHintMode === 'full' ? { turnHintMode: 'full' as const } : {}),
      ...(parsed.turnHintAuto === true ? { turnHintAuto: true } : {}),
    };
  } catch {
    return null;
  }
}

export function saveHostLesson(lesson: HostLessonState | null): void {
  try {
    if (lesson) sessionStorage.setItem(HOST_LESSON_STORAGE_KEY, JSON.stringify(lesson));
    else sessionStorage.removeItem(HOST_LESSON_STORAGE_KEY);
  } catch { /* quota / disabled storage */ }
}
