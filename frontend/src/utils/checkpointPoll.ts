/**
 * 台下互動點的即時作答：老師發布 → 學生在自己的裝置作答 → 老師結束作答 → 公布答案（大屏顯示統計）。
 *
 * 狀態只存在教師端（記住每位學生最後一次的選擇）。
 * - 學生端只收到題目與狀態，公布前不帶正確答案（避免從封包看到答案）。
 * - 大屏只收到各選項人數、已作答人數，以及公布後的正確答案。
 */
import type { AudienceCheckpoint } from '../types/dialogueTask.ts';

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
}

/** 學生 → 老師的作答訊息 */
export interface CheckpointAnswerMsg {
  type: 'checkpoint-answer';
  pollId: string;
  choice: number;
}

export function startPoll(checkpoint: AudienceCheckpoint, stepId: string, pollId: string): CheckpointPoll {
  return { pollId, stepId, checkpoint, status: 'open', answers: {} };
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
  return {
    pollId: poll.pollId,
    kind: checkpointKind(cp),
    title: cp.title,
    question: cp.question,
    options: checkpointOptions(cp),
    status: poll.status,
    ...(poll.status === 'revealed' ? { answerIndex: cp.answerIndex } : {}),
  };
}

/** identities：目前在線的學生（已作答人數與分母都只算他們） */
export function toScreenPoll(poll: CheckpointPoll, identities: readonly string[]): ScreenPoll {
  const counts = pollCounts(poll, identities);
  return {
    ...toStudentPoll(poll),
    counts,
    answered: counts.reduce((a, b) => a + b, 0),
    total: identities.length,
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
