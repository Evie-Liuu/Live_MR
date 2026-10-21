import { optionLabel, optionMark, type StudentPoll } from '../utils/checkpointPoll.ts';
import './CheckpointStudentSheet.css';

interface CheckpointStudentSheetProps {
  poll: StudentPoll;
  /** 自己的選擇（尚未作答為 null） */
  choice: number | null;
  onChoose: (index: number) => void;
}

/**
 * 學生裝置上的台下互動點：老師發布後跳出題目，點選項作答（結束前可以改）。
 * 老師公布答案後顯示對錯與正確答案。
 */
export default function CheckpointStudentSheet({ poll, choice, onChoose }: CheckpointStudentSheetProps) {
  const revealed = poll.status === 'revealed' && poll.answerIndex !== undefined;
  const open = poll.status === 'open';
  const correct = revealed && choice === poll.answerIndex;
  // 舊版老師端沒有這個欄位：視為顯示
  const showText = poll.showQuestionText !== false;

  let message: string;
  if (revealed) message = choice === null ? '沒有作答，看看正確答案吧！' : correct ? '答對了！' : '再接再厲！正確答案已標示';
  else if (!open) message = '作答已結束，等老師公布答案';
  else message = choice === null ? '請點選你的答案' : '已送出，結束前可以更改';

  return (
    <div className="cps-backdrop" role="dialog" aria-modal="true" aria-labelledby="cps-question">
      <div className={`cps-sheet cps-sheet--${poll.kind} ${showText ? '' : 'cps-sheet--no-text'}`}>
        <div className="cps-top">
          <span className="cps-chip">{poll.kind === 'truefalse' ? '是非題' : '選擇題'}</span>
          <span className="cps-title">{poll.title}</span>
        </div>
        {showText
          ? <h2 id="cps-question" className="cps-question">{poll.question}</h2>
          : <h2 id="cps-question" className="cps-question cps-question--listen">
              <span className="material-symbols-outlined" aria-hidden="true">{revealed ? 'campaign' : 'hearing'}</span>
              {revealed ? '答案揭曉' : '仔細聽老師的題目，再選答案'}
            </h2>}
        <div className="cps-options">
          {poll.options.map((opt, i) => {
            const state = revealed
              ? (i === poll.answerIndex ? 'is-correct' : i === choice ? 'is-wrong' : 'is-dim')
              : i === choice ? 'is-chosen' : '';
            return (
              <button
                key={i}
                type="button"
                className={`cps-option ${state}`}
                disabled={!open}
                aria-pressed={i === choice}
                onClick={() => onChoose(i)}
              >
                <span className="cps-mark">{optionMark(poll.kind, i)}</span>
                {showText
                  ? <span className="cps-label">{optionLabel(poll.kind, opt, i)}</span>
                  : poll.kind === 'truefalse' && <span className="cps-label">{i === 0 ? '是' : '非'}</span>}
              </button>
            );
          })}
        </div>
        <p className={`cps-message ${revealed && choice !== null ? (correct ? 'is-correct' : 'is-wrong') : ''}`} role="status">{message}</p>
      </div>
    </div>
  );
}
