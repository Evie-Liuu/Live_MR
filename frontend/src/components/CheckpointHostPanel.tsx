import { useState } from 'react';
import { MAX_CHECKPOINTS_PER_STEP, type AudienceCheckpoint, type DialogueStep } from '../types/dialogueTask.ts';
import {
  checkpointKind, checkpointOptions, defaultShowQuestionText, hasDuplicateOptions, optionLabel, optionMark, pollCounts,
  resolveCheckpoint, type CheckpointCast, type CheckpointPoll,
} from '../utils/checkpointPoll.ts';
import './CheckpointHostPanel.css';

interface CheckpointHostPanelProps {
  steps: DialogueStep[];
  /** 當下正在演出的步驟 index（= currentStepIndex，不隨 doneCount 超出最後一步） */
  currentIndex: number;
  poll: CheckpointPoll | null;
  /** 目前在線的學生 */
  studentIds: string[];
  /** 任務程度：決定發布後大屏與學生裝置預設是否顯示題目文字（A1-A2 以上預設只顯示選項代號） */
  level?: string;
  /** 題目裡的角色代號換成演出者名字用（發布的是代換後的題目） */
  cast: CheckpointCast;
  onPublish: (stepId: string, checkpoint: AudienceCheckpoint) => void;
  /** 發布後切換大屏與學生裝置是否顯示題目文字 */
  onToggleQuestionText: () => void;
  onClose: () => void;
  onReveal: () => void;
  onEnd: () => void;
  /** AI 為目前步驟出的題（只在這堂課用） */
  aiCheckpoints: AudienceCheckpoint[];
  aiGenerating: boolean;
  aiError: string | null;
  onGenerate: (kind: AiCheckpointKind) => void;
  /** 存入任務中的題目 id；null＝沒有在存 */
  aiSavingId: string | null;
  onSaveAi: (stepId: string, checkpoint: AudienceCheckpoint) => void;
  onRemoveAi: (stepId: string, checkpointId: string) => void;
}

export type AiCheckpointKind = 'mixed' | 'choice' | 'truefalse';
const AI_KINDS: { value: AiCheckpointKind; label: string }[] = [
  { value: 'mixed', label: '混合' },
  { value: 'choice', label: '選擇' },
  { value: 'truefalse', label: '是非' },
];

/**
 * 導師任務卡（任務中）的台下互動控制：
 * 發布 → 學生作答（即時人數與分布只有老師看得到）→ 結束作答 → 公布答案（大屏顯示統計）→ 結束。
 * 大屏與學生裝置預設依程度決定是否顯示題目文字（A1-A2 以上只顯示 A、B… 或 O / X），發布後可切換。
 */
export default function CheckpointHostPanel({
  steps, currentIndex, poll, studentIds, level, cast, onPublish, onToggleQuestionText, onClose, onReveal, onEnd,
  aiCheckpoints, aiGenerating, aiError, onGenerate, aiSavingId, onSaveAi, onRemoveAi,
}: CheckpointHostPanelProps) {
  const [aiKind, setAiKind] = useState<AiCheckpointKind>('mixed');
  // 只列出當下正在演出步驟的台下互動（任務裡的題目＋AI 出的題）
  const step = currentIndex >= 0 && currentIndex < steps.length ? steps[currentIndex] : undefined;
  const candidates = step
    ? [
      ...(step.checkpoints ?? []).map(raw => ({ raw, cp: resolveCheckpoint(raw, cast), ai: false })),
      ...aiCheckpoints.map(raw => ({ raw, cp: resolveCheckpoint(raw, cast), ai: true })),
    ]
    : [];
  const canGenerate = !!step && step.lines.some(l => l.en.trim());
  const canSave = (step?.checkpoints?.length ?? 0) < MAX_CHECKPOINTS_PER_STEP;

  if (!poll && candidates.length === 0 && !canGenerate) return null;

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  if (poll) {
    const kind = checkpointKind(poll.checkpoint);
    const options = checkpointOptions(poll.checkpoint);
    const counts = pollCounts(poll, studentIds);
    const answered = counts.reduce((a, b) => a + b, 0);
    const max = Math.max(1, ...counts);
    const statusText = poll.status === 'open' ? '作答中' : poll.status === 'closed' ? '已結束作答' : '已公布答案';
    const showText = poll.showQuestionText ?? true;
    return (
      <div className="cph" onClick={stop}>
        <div className="cph-head">
          <span className={`cph-status cph-status--${poll.status}`}>{statusText}</span>
          <span className="cph-title">{poll.checkpoint.title}</span>
          <span className="cph-count">{answered}/{studentIds.length} 人</span>
        </div>
        <div className="cph-question">{poll.checkpoint.question}</div>
        <ul className="cph-bars">
          {options.map((opt, i) => (
            <li key={i} className={`cph-bar ${i === poll.checkpoint.answerIndex ? 'is-answer' : ''}`}>
              <span className="cph-mark">{optionMark(kind, i)}</span>
              <span className="cph-opt">{optionLabel(kind, opt, i)}</span>
              <span className="cph-track"><span className="cph-fill" style={{ width: `${(counts[i] / max) * 100}%` }} /></span>
              <span className="cph-num">{counts[i]}</span>
            </li>
          ))}
        </ul>
        {poll.checkpoint.followUp && poll.status === 'revealed' && (
          <div className="cph-follow">延伸追問：{poll.checkpoint.followUp}</div>
        )}
        <div className="cph-actions">
          {/* 題目文字顯示：兩段式切換，一眼看出目前狀態 */}
          <div className="cph-seg" role="group" aria-label="大屏與學生裝置的題目顯示">
            <span className="cph-seg-label">題目</span>
            {([true, false] as const).map(value => (
              <button
                key={String(value)}
                type="button"
                className={`cph-seg-btn ${showText === value ? 'is-active' : ''}`}
                aria-pressed={showText === value}
                onClick={() => { if (showText !== value) onToggleQuestionText(); }}
                title={value ? '大屏與學生裝置顯示題目與選項文字' : '大屏與學生裝置只顯示 A、B… 或 O / X'}
              >
                <span className="material-symbols-outlined" aria-hidden="true">{value ? 'subject' : 'format_list_bulleted'}</span>
                {value ? '顯示文字' : '只顯示選項'}
              </button>
            ))}
          </div>
          <div className="cph-actions-main">
            {poll.status === 'open' && <button type="button" className="cph-btn cph-btn--primary" onClick={onClose}>結束作答</button>}
            {poll.status === 'closed' && <button type="button" className="cph-btn cph-btn--primary" onClick={onReveal}>公布答案</button>}
            <button
              type="button"
              className={`cph-btn ${poll.status === 'revealed' ? 'cph-btn--primary' : 'cph-btn--ghost'}`}
              onClick={onEnd}
            >
              {poll.status === 'revealed' ? '完成' : '取消'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cph" onClick={stop}>
      <div className="cph-head">
        <span className="cph-title">台下互動</span>
        <span className="cph-default-hint">發布後{defaultShowQuestionText(level) ? '顯示題目文字' : '只顯示選項'}</span>
      </div>
      <ul className="cph-list">
        {step && candidates.map(({ raw, cp, ai }) => (
          <li key={`${step.id}-${cp.id}`} className={`cph-item${ai ? ' cph-item--ai' : ''}`}>
            <span className={`cph-item-step${ai ? ' cph-item-step--ai' : ''}`}>{ai ? 'AI' : '?'}</span>
            <span className="cph-item-text">
              <span className="cph-item-kind">{checkpointKind(cp) === 'truefalse' ? '是非' : '選擇'}・{cp.title}</span>
              <span className="cph-item-q">{cp.question}</span>
              {ai && (
                <span className="cph-item-opts">
                  {checkpointOptions(cp).map((o, i) => (
                    <span key={i} className={i === cp.answerIndex ? 'is-answer' : ''}>{optionMark(checkpointKind(cp), i)}. {optionLabel(checkpointKind(cp), o, i)}</span>
                  ))}
                </span>
              )}
              {hasDuplicateOptions(cp) && (
                <span className="cph-item-warn">目前演出人數下選項重複（同一人演兩個角色），建議改問其他題</span>
              )}
            </span>
            {ai && (
              <span className="cph-item-tools">
                <button
                  type="button"
                  className="cph-icon-btn"
                  onClick={() => onSaveAi(step.id, raw)}
                  disabled={!canSave || aiSavingId !== null}
                  title={canSave ? '存入任務（下次上課也能用）' : `每步最多 ${MAX_CHECKPOINTS_PER_STEP} 題，無法再存入`}
                  aria-label="存入任務"
                >
                  <span className="material-symbols-outlined">{aiSavingId === raw.id ? 'hourglass_top' : 'bookmark_add'}</span>
                </button>
                <button type="button" className="cph-icon-btn" onClick={() => onRemoveAi(step.id, raw.id)} title="移除這題" aria-label="移除這題">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </span>
            )}
            <button
              type="button"
              className="cph-btn cph-btn--primary"
              onClick={() => onPublish(step.id, cp)}
            >
              發布
            </button>
          </li>
        ))}
      </ul>
      {canGenerate && (
        <div className="cph-ai">
          <div className="cph-ai-kinds" role="group" aria-label="AI 出題題型">
            {AI_KINDS.map(k => (
              <button
                key={k.value}
                type="button"
                className={`cph-ai-kind${aiKind === k.value ? ' is-active' : ''}`}
                aria-pressed={aiKind === k.value}
                onClick={() => setAiKind(k.value)}
              >
                {k.label}
              </button>
            ))}
          </div>
          <button type="button" className="cph-btn cph-ai-btn" onClick={() => onGenerate(aiKind)} disabled={aiGenerating}>
            <span className="material-symbols-outlined" aria-hidden="true">auto_awesome</span>
            {aiGenerating ? '出題中…' : 'AI 依劇本出題'}
          </button>
        </div>
      )}
      {aiError && <div className="cph-ai-error">{aiError}</div>}
    </div>
  );
}
