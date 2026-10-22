import type { AudienceCheckpoint, DialogueStep } from '../types/dialogueTask.ts';
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
}

/**
 * 導師任務卡（任務中）的台下互動控制：
 * 發布 → 學生作答（即時人數與分布只有老師看得到）→ 結束作答 → 公布答案（大屏顯示統計）→ 結束。
 * 大屏與學生裝置預設依程度決定是否顯示題目文字（A1-A2 以上只顯示 A、B… 或 O / X），發布後可切換。
 */
export default function CheckpointHostPanel({
  steps, currentIndex, poll, studentIds, level, cast, onPublish, onToggleQuestionText, onClose, onReveal, onEnd,
}: CheckpointHostPanelProps) {
  // 只列出當下正在演出步驟的台下互動
  const candidates = currentIndex >= 0 && currentIndex < steps.length
    ? (steps[currentIndex].checkpoints ?? []).map(raw => ({ step: steps[currentIndex], index: currentIndex, cp: resolveCheckpoint(raw, cast) }))
    : [];

  if (!poll && candidates.length === 0) return null;

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
        {candidates.map(({ step, cp }) => (
          <li key={`${step.id}-${cp.id}`} className="cph-item">
            <span className="cph-item-step">?</span>
            <span className="cph-item-text">
              <span className="cph-item-kind">{checkpointKind(cp) === 'truefalse' ? '是非' : '選擇'}・{cp.title}</span>
              <span className="cph-item-q">{cp.question}</span>
              {hasDuplicateOptions(cp) && (
                <span className="cph-item-warn">目前演出人數下選項重複（同一人演兩個角色），建議改問其他題</span>
              )}
            </span>
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
    </div>
  );
}
