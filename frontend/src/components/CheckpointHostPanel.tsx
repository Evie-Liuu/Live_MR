import type { AudienceCheckpoint, DialogueStep } from '../types/dialogueTask.ts';
import {
  checkpointKind, checkpointOptions, defaultShowQuestionText, optionLabel, optionMark, pollCounts,
  type CheckpointPoll,
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
  steps, currentIndex, poll, studentIds, level, onPublish, onToggleQuestionText, onClose, onReveal, onEnd,
}: CheckpointHostPanelProps) {
  // 只列出當下正在演出步驟的台下互動
  const candidates = currentIndex >= 0 && currentIndex < steps.length
    ? (steps[currentIndex].checkpoints ?? []).map(cp => ({ step: steps[currentIndex], index: currentIndex, cp }))
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
          <button
            type="button"
            className={`cph-btn cph-btn--screen-toggle ${showText ? 'is-active' : ''}`}
            onClick={onToggleQuestionText}
            aria-pressed={showText}
            title={showText ? '大屏與學生裝置目前顯示題目文字，點擊改為只顯示選項代號' : '大屏與學生裝置目前只顯示選項代號，點擊顯示題目文字'}
          >
            <span className="material-symbols-outlined" aria-hidden="true">{showText ? 'subject' : 'format_list_bulleted'}</span>
            題目：{showText ? '顯示文字' : '只顯示選項'}
          </button>
          <div className="cph-actions-right">
            {poll.status === 'open' && <button type="button" className="cph-btn cph-btn--primary" onClick={onClose}>結束作答</button>}
            {poll.status === 'closed' && <button type="button" className="cph-btn cph-btn--primary" onClick={onReveal}>公布答案</button>}
            <button type="button" className="cph-btn" onClick={onEnd}>{poll.status === 'revealed' ? '完成' : '取消'}</button>
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
