import { optionLabel, optionMark, type ScreenPoll } from '../utils/checkpointPoll.ts';
import './CheckpointScreenOverlay.css';

/**
 * 大屏的台下互動點：作答中只顯示題目、選項與已作答人數（不顯示分布，避免影響還沒作答的學生）；
 * 老師公布答案後顯示各選項人數長條與正確答案。
 * 當 showQuestionText 為 false 時（高年級/A1-A2以上預設）：
 * 不顯示題目文字，只存在選擇 A、B... 或是非（O / X，是 / 非）。
 */
export default function CheckpointScreenOverlay({ poll }: { poll: ScreenPoll }) {
  const revealed = poll.status === 'revealed' && poll.answerIndex !== undefined;
  const max = Math.max(1, ...poll.counts);
  const status = poll.status === 'open' ? '作答中' : poll.status === 'closed' ? '作答結束' : '公布答案';
  const correctCount = revealed ? poll.counts[poll.answerIndex!] ?? 0 : 0;
  const showText = poll.showQuestionText !== false;

  return (
    <div className={`cpo cpo--${poll.status} ${!showText ? 'cpo--no-text' : ''}`} role="region" aria-label="台下互動">
      <div className="cpo-top">
        <span className={`cpo-status cpo-status--${poll.status}`}>{status}</span>
        <span className="cpo-title">{poll.kind === 'truefalse' ? '是非題' : '選擇題'}・{poll.title}</span>
        <span className="cpo-answered">已作答 <strong>{poll.answered}</strong> / {poll.total}</span>
      </div>
      {showText && <div className="cpo-question">{poll.question}</div>}
      <ul className={`cpo-options cpo-options--${poll.kind}`}>
        {poll.options.map((opt, i) => {
          const isAnswer = revealed && i === poll.answerIndex;
          const count = poll.counts[i] ?? 0;
          const pct = poll.answered > 0 ? Math.round((count / poll.answered) * 100) : 0;
          return (
            <li key={i} className={`cpo-option ${isAnswer ? 'is-answer' : revealed ? 'is-other' : ''}`}>
              <span className="cpo-mark">{optionMark(poll.kind, i)}</span>
              {showText ? (
                <span className="cpo-label">{optionLabel(poll.kind, opt, i)}</span>
              // ) : poll.kind === 'truefalse' ? (
                // <span className="cpo-label cpo-label--tf">{i === 0 ? '是' : '非'}</span>
              ) : null}
              {revealed && (
                <>
                  <span className="cpo-track"><span className="cpo-fill" style={{ width: `${(count / max) * 100}%` }} /></span>
                  <span className="cpo-num">{count} 人・{pct}%</span>
                </>
              )}
              {isAnswer && <span className="cpo-check material-symbols-outlined" aria-label="正確答案">check_circle</span>}
            </li>
          );
        })}
      </ul>
      {revealed && (
        <div className="cpo-summary">
          答對 {correctCount} 人
          {poll.answered > 0 && `（${Math.round((correctCount / poll.answered) * 100)}%）`}
        </div>
      )}
    </div>
  );
}
