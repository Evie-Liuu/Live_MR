/**
 * 台下互動點的即時作答：老師發布 → 學生在自己的裝置作答 → 老師結束作答 → 公布答案（大屏顯示統計）。
 *
 * 狀態只存在教師端（記住每位學生最後一次的選擇）。
 * - 學生端只收到題目與狀態，公布前不帶正確答案（避免從封包看到答案）。
 * - 大屏只收到各選項人數、已作答人數，以及公布後的正確答案。
 * - 「只顯示選項」時，大屏與學生裝置都不顯示題目與選項文字（學生裝置連文字都不會收到），只有 A、B… 或 O / X。
 */
import type { AudienceCheckpoint } from '../types/dialogueTask.ts';
import { isLevelA1A2OrAbove } from '../types/lessonPlan.ts';

export type PollStatus = 'open' | 'closed' | 'revealed';

/** 題型：選擇題，或是非題（固定兩個選項 True / False） */
export type CheckpointKind = 'choice' | 'truefalse';

export const TRUE_FALSE_OPTIONS = ['True', 'False'] as const;

export function checkpointKind(cp: Pick<AudienceCheckpoint, 'kind'>): CheckpointKind {
  return cp.kind === 'truefalse' ? 'truefalse' : 'choice';
}

/** 實際作答用的選項：是非題一律 True / False */
export function checkpointOptions(cp: Pick<AudienceCheckpoint, 'kind' | 'options'>): string[] {
  return checkpointKind(cp) === 'truefalse' ? [...TRUE_FALSE_OPTIONS] : cp.options;
}

/** 教師端保存的作答狀態 */
export interface CheckpointPoll {
  pollId: string;
  stepId: string;
  checkpoint: AudienceCheckpoint;
  status: PollStatus;
  /** 學生 identity → 選項位置（作答期間可以改，以最後一次為準） */
  answers: Record<string, number>;
  /** 大屏與學生裝置是否顯示題目文字（false 時只顯示 A/B 或是非） */
  showQuestionText?: boolean;
}

/** 送到學生裝置的內容（公布前不含正確答案） */
export interface StudentPoll {
  pollId: string;
  kind: CheckpointKind;
  title: string;
  question: string;
  options: string[];
  status: PollStatus;
  answerIndex?: number;
  /** false：只顯示選項代號（此時 question 為空字串、options 只保留數量，文字一律為空） */
  showQuestionText: boolean;
}

/** 送到大屏的內容 */
export interface ScreenPoll {
  pollId: string;
  kind: CheckpointKind;
  title: string;
  question: string;
  options: string[];
  status: PollStatus;
  /** 各選項人數（與 options 同順序） */
  counts: number[];
  answered: number;
  /** 目前在線的學生數 */
  total: number;
  answerIndex?: number;
  /** 是否顯示題目與選項文字（false：只顯示 A、B… 或 O / X，讓學生專心聽老師唸題） */
  showQuestionText: boolean;
}

/** 學生 → 老師的作答訊息 */
export interface CheckpointAnswerMsg {
  type: 'checkpoint-answer';
  pollId: string;
  choice: number;
}

/**
 * 大屏與學生裝置預設是否顯示題目文字：程度 A1-A2 以上預設不顯示（只有選項代號，練習聽力），
 * 較低程度預設顯示。發布後老師可隨時切換。
 */
export function defaultShowQuestionText(level?: string): boolean {
  return !isLevelA1A2OrAbove(level);
}

export function startPoll(checkpoint: AudienceCheckpoint, stepId: string, pollId: string, showQuestionText = true): CheckpointPoll {
  return { pollId, stepId, checkpoint, status: 'open', answers: {}, showQuestionText };
}

/** 切換大屏與學生裝置是否顯示題目文字（舊狀態沒有這個欄位時視為顯示） */
export function toggleQuestionText(poll: CheckpointPoll): CheckpointPoll {
  return { ...poll, showQuestionText: !(poll.showQuestionText ?? true) };
}

/** 記錄作答；不是這一題、已結束作答或選項不存在時不變 */
export function recordAnswer(poll: CheckpointPoll, identity: string, msg: { pollId?: unknown; choice?: unknown }): CheckpointPoll {
  if (poll.status !== 'open' || msg.pollId !== poll.pollId) return poll;
  const choice = msg.choice;
  if (typeof choice !== 'number' || !Number.isInteger(choice)) return poll;
  if (choice < 0 || choice >= checkpointOptions(poll.checkpoint).length) return poll;
  if (poll.answers[identity] === choice) return poll;
  return { ...poll, answers: { ...poll.answers, [identity]: choice } };
}

export function setPollStatus(poll: CheckpointPoll, status: PollStatus): CheckpointPoll {
  return poll.status === status ? poll : { ...poll, status };
}

/** 各選項人數；只算 identities 裡的學生（離線的學生不算），未提供時全部算 */
export function pollCounts(poll: CheckpointPoll, identities?: readonly string[]): number[] {
  const counts = checkpointOptions(poll.checkpoint).map(() => 0);
  for (const [identity, choice] of Object.entries(poll.answers)) {
    if (identities && !identities.includes(identity)) continue;
    if (choice >= 0 && choice < counts.length) counts[choice]++;
  }
  return counts;
}

export function toStudentPoll(poll: CheckpointPoll): StudentPoll {
  const { checkpoint: cp } = poll;
  const showQuestionText = poll.showQuestionText ?? true;
  const options = checkpointOptions(cp);
  return {
    pollId: poll.pollId,
    kind: checkpointKind(cp),
    title: cp.title,
    // 只顯示選項時不送文字：學生要聽老師唸題，不能從裝置看到
    question: showQuestionText ? cp.question : '',
    options: showQuestionText ? options : options.map(() => ''),
    status: poll.status,
    showQuestionText,
    ...(poll.status === 'revealed' ? { answerIndex: cp.answerIndex } : {}),
  };
}

/** identities：目前在線的學生（已作答人數與分母都只算他們） */
export function toScreenPoll(poll: CheckpointPoll, identities: readonly string[]): ScreenPoll {
  const counts = pollCounts(poll, identities);
  // 大屏由教師端直接送出（不經網路），保留完整文字，切回顯示題目時不必重送
  return {
    ...toStudentPoll(poll),
    question: poll.checkpoint.question,
    options: checkpointOptions(poll.checkpoint),
    counts,
    answered: counts.reduce((a, b) => a + b, 0),
    total: identities.length,
    showQuestionText: poll.showQuestionText ?? true,
  };
}

/** 選項代號：選擇題 A B C…；是非題用 O / X */
export function optionMark(kind: CheckpointKind, index: number): string {
  if (kind === 'truefalse') return index === 0 ? 'O' : 'X';
  return String.fromCharCode(65 + index);
}

/** 是非題選項的中文說明 */
export function optionLabel(kind: CheckpointKind, option: string, index: number): string {
  if (kind === 'truefalse') return index === 0 ? '對 True' : '錯 False';
  return option;
}

export const HOST_CHECKPOINT_STORAGE_KEY = 'host-checkpoint';
export const BIGSCREEN_CHECKPOINT_STORAGE_KEY = 'bigscreen-checkpoint';

export function loadHostPoll(): CheckpointPoll | null {
  try {
    const raw = sessionStorage.getItem(HOST_CHECKPOINT_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<CheckpointPoll>;
    if (!p || typeof p.pollId !== 'string' || !p.checkpoint || !p.status || typeof p.answers !== 'object') return null;
    return p as CheckpointPoll;
  } catch {
    return null;
  }
}

export function saveHostPoll(poll: CheckpointPoll | null): void {
  try {
    if (poll) sessionStorage.setItem(HOST_CHECKPOINT_STORAGE_KEY, JSON.stringify(poll));
    else sessionStorage.removeItem(HOST_CHECKPOINT_STORAGE_KEY);
  } catch { /* quota / disabled storage */ }
}

/**
 * 題目裡的角色代號：`{slotId}`（例如 `{customer2}`）發布時換成演出者名字。
 * - 依目前演出人數的併角規則：被併掉的角色換成接手它台詞的角色的演出者。
 * - 還沒指派演出者時用角色名稱（例如「顧客B」）。
 * - 不是場景角色的 `{...}` 保持原樣。
 */
export interface CheckpointCast {
  /** 場景角色 id → 角色名稱 */
  slotLabels: Record<string, string>;
  /** 目前演出人數的併角規則（被併掉的角色 → 接手的角色） */
  merge: Record<string, string>;
  /** 角色 id → 演出者 identity */
  slotAssignments: Record<string, string>;
  /** 演出者 identity → 名字 */
  names: Record<string, string>;
}

const SLOT_TOKEN = /\{([A-Za-z0-9_-]+)\}/g;

export function resolveCastText(text: string, cast: CheckpointCast): string {
  return text.replace(SLOT_TOKEN, (token, raw: string) => {
    if (!(raw in cast.slotLabels)) return token;
    const slotId = cast.merge[raw] ?? raw;
    const identity = cast.slotAssignments[slotId];
    return (identity && cast.names[identity]) || cast.slotLabels[slotId] || token;
  });
}

/** 發布用：題目、選項、延伸追問的角色代號換成演出者名字 */
export function resolveCheckpoint(cp: AudienceCheckpoint, cast: CheckpointCast): AudienceCheckpoint {
  return {
    ...cp,
    question: resolveCastText(cp.question, cast),
    options: cp.options.map(o => resolveCastText(o, cast)),
    ...(cp.followUp !== undefined ? { followUp: resolveCastText(cp.followUp, cast) } : {}),
  };
}

/** 代換後選項重複（例如少人數演出時兩個角色由同一人演）：選擇題無法作答，發布前提醒老師 */
export function hasDuplicateOptions(cp: AudienceCheckpoint): boolean {
  if (checkpointKind(cp) === 'truefalse') return false;
  const seen = cp.options.map(o => o.trim().toLowerCase());
  return new Set(seen).size !== seen.length;
}
