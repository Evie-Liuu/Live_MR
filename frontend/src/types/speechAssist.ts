/** 登台展演 AI 口說輔助（與 backend/src/ai/speechJudge.ts、speechSummary.ts 的形狀一致） */

export type SpokenLanguage = 'en' | 'zh' | 'mixed' | 'silent';
export type JudgeSeverity = 'ok' | 'minor' | 'severe';
/** 中文／中英混用、句子不完整、單字錯誤、完全沒有回應 */
export type JudgeIssue = 'chinese' | 'incomplete' | 'wrongWord' | 'noResponse';

export interface WrongWord {
  said: string;
  expected: string;
}

export interface TurnJudgment {
  transcript: string;
  language: SpokenLanguage;
  missing: string[];
  wrong: WrongWord[];
  issues: JudgeIssue[];
  severity: JudgeSeverity;
}

export const ISSUE_LABELS: Record<JudgeIssue, string> = {
  chinese: '說中文',
  incomplete: '句子不完整',
  wrongWord: '單字錯誤',
  noResponse: '沒有回應',
};

export const SEVERITY_LABELS: Record<JudgeSeverity, string> = {
  ok: '正確',
  minor: '輕微',
  severe: '需提示',
};

export interface SpeechFeedbackRecord {
  id: string;
  studentName: string;
  taskTitle: string;
  stepIndex: number;
  lineIndex: number;
  lineEn: string;
  transcript: string;
  language: SpokenLanguage;
  severity: JudgeSeverity;
  issues: JudgeIssue[];
  missing: string[];
  wrong: WrongWord[];
  audioSeconds: number;
  model: string;
  costUsd: number;
  createdAt: string;
}

export interface StudentSpeechSummary {
  studentName: string;
  lines: number;
  ok: number;
  minor: number;
  severe: number;
  issues: Record<JudgeIssue, number>;
  missing: { word: string; count: number }[];
  wrong: { said: string; expected: string; count: number }[];
}

export interface SpeechUsageSummary {
  calls: number;
  audioSeconds: number;
  promptTokens: number;
  audioTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface SpeechFeedbackReport {
  records: SpeechFeedbackRecord[];
  students: StudentSpeechSummary[];
  usage: SpeechUsageSummary;
}

export interface SpeechJudgeRequest {
  studentId: string;
  studentName: string;
  taskTitle: string;
  stepIndex: number;
  lineIndex: number;
  line: { en: string; zh: string };
  prevLine: string | null;
  level: string;
  audio: { data: string; mimeType: 'audio/wav' };
  audioSeconds: number;
}

export async function requestSpeechJudge(roomId: string, body: SpeechJudgeRequest, signal?: AbortSignal): Promise<TurnJudgment> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/speech-judge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`speech-judge failed: ${res.status}`);
  return ((await res.json()) as { judgment: TurnJudgment }).judgment;
}

export interface SpeechJudgePreview {
  judgment: TurnJudgment;
  model: string;
  costUsd: number;
  latencyMs: number;
  usage: { prompt: number; audio: number; output: number };
}

/** 模擬學生回答頁：試用判斷（不需課堂、不存紀錄） */
export async function requestSpeechJudgePreview(
  body: Pick<SpeechJudgeRequest, 'line' | 'prevLine' | 'level' | 'audio' | 'audioSeconds'>,
  signal?: AbortSignal,
): Promise<SpeechJudgePreview> {
  const res = await fetch('/api/speech-judge/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (res.status === 429) throw new Error('太頻繁了，請稍等一分鐘再試');
  if (!res.ok) {
    // 後端會附上失敗原因（金鑰被停用、模型不能用、額度用完…）
    const reason = await res.json().then((b: { reason?: unknown }) => (typeof b.reason === 'string' ? b.reason : null), () => null);
    throw new Error(reason ? `AI 判斷失敗：${reason}` : res.status === 503 ? '伺服器沒有設定 AI 金鑰' : `AI 判斷失敗（${res.status}）`);
  }
  return (await res.json()) as SpeechJudgePreview;
}

export async function fetchSpeechFeedback(roomId: string, hostToken: string): Promise<SpeechFeedbackReport> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/speech-feedback`, { headers: { 'X-Host-Token': hostToken } });
  if (!res.ok) throw new Error(`speech-feedback failed: ${res.status}`);
  return (await res.json()) as SpeechFeedbackReport;
}

/** 收到的判斷結果是否形狀正確（老師端收學生轉送的資料用） */
export function isTurnJudgment(v: unknown): v is TurnJudgment {
  const j = v as Partial<TurnJudgment> | null;
  return !!j && typeof j.transcript === 'string'
    && ['en', 'zh', 'mixed', 'silent'].includes(j.language as string)
    && ['ok', 'minor', 'severe'].includes(j.severity as string)
    && Array.isArray(j.issues) && Array.isArray(j.missing) && Array.isArray(j.wrong);
}
