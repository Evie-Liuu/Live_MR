/**
 * 上課時「導師任務管理」的狀態：教師端保存整份對話任務與完成進度，
 * 大螢幕只收到情境（步驟名稱、目的、角色），台詞要老師開提示才會帶上。
 *
 * 步驟依序完成：doneCount = 已完成的步驟數，目前步驟 = 第一個未完成的步驟。
 */
import type { DialogueTaskRecord } from '../types/dialogueTask.ts';

/** 教師端的上課狀態（存在 sessionStorage，重整後還原） */
export interface HostLessonState {
  record: DialogueTaskRecord;
  /** 已完成的步驟數（0 ~ 步驟總數） */
  doneCount: number;
  /** 大螢幕是否顯示目前步驟的英文台詞 */
  showLines: boolean;
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
  /** 只有老師開啟台詞提示、且課程尚未完成時才有 */
  lines?: { speaker: string; en: string }[];
}

export const HOST_LESSON_STORAGE_KEY = 'host-lesson';
export const BIGSCREEN_LESSON_STORAGE_KEY = 'bigscreen-lesson';

function stepCount(lesson: HostLessonState): number {
  return lesson.record.task.steps.length;
}

/** 已完成步驟數限制在 0 ~ 步驟總數 */
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

/** 教師端狀態 → 大螢幕狀態；slotLabels 用來把角色 id 轉成中文名稱 */
export function toLessonScreen(lesson: HostLessonState, slotLabels: Record<string, string>): LessonScreenState | null {
  const { task } = lesson.record;
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
    ...(lesson.showLines && !allDone
      ? { lines: step.lines.filter(l => l.en.trim()).map(l => ({ speaker: label(l.speakerSlotId), en: l.en })) }
      : {}),
  };
}

export function loadHostLesson(): HostLessonState | null {
  try {
    const raw = sessionStorage.getItem(HOST_LESSON_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HostLessonState & { stepIndex?: number };
    if (!parsed?.record?.task?.steps) return null;
    // 舊格式只有 stepIndex：視為前面的步驟都已完成
    const doneCount = typeof parsed.doneCount === 'number' ? parsed.doneCount : (parsed.stepIndex ?? 0);
    return { record: parsed.record, doneCount, showLines: !!parsed.showLines };
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
