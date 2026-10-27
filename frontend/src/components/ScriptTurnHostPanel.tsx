import type { ScriptTurn, TurnPerson } from '../utils/scriptTurn.ts';
import './ScriptTurnHostPanel.css';

/** 發言者目前的狀態（老師端提示要不要代讀或略過） */
export type SpeakerStatus = 'speaking' | 'online' | 'offline' | 'unassigned' | 'teacher';

interface ScriptTurnHostPanelProps {
  /** null＝沒在逐句演練 */
  turn: ScriptTurn | null;
  /** 目前步驟的台詞（併角後） */
  lines: { id: string; en: string; speaker: TurnPerson }[];
  speakerStatus: SpeakerStatus;
  /** 發言者的即時逐字稿 */
  transcript: string;
  /** 不能開始的原因（互動進行中、題目發布中…）；null＝可以開始 */
  blockedReason: string | null;
  isLastStep: boolean;
  onStart: () => void;
  onPrev: () => void;
  onNext: () => void;
  onTogglePause: () => void;
  onJump: (lineIndex: number) => void;
  onNextStep: () => void;
  onEnd: () => void;
}

const STATUS_TEXT: Record<SpeakerStatus, string> = {
  speaking: '說話中',
  online: '等待開口',
  offline: '離線',
  unassigned: '未指派',
  teacher: '老師演出',
};

/**
 * 導師任務卡：逐句輪流演練。學生按「我說完了」換句，老師可以隨時上一句、下一句、跳句或暫停。
 * 發言者離線或角色未指派時提示老師代讀或略過。
 */
export default function ScriptTurnHostPanel(props: ScriptTurnHostPanelProps) {
  const { turn, lines, speakerStatus, transcript, blockedReason, isLastStep } = props;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  if (!turn) {
    return (
      <div className="stp" onClick={stop}>
        <div className="stp-head">
          <span className="stp-title">逐句演練</span>
          <span className="stp-hint">{lines.length} 句</span>
        </div>
        <button
          type="button"
          className="stp-btn stp-btn--primary stp-start"
          onClick={props.onStart}
          disabled={!!blockedReason || lines.length === 0}
          title={blockedReason ?? undefined}
        >
          <span className="material-symbols-outlined" aria-hidden="true">record_voice_over</span>
          開始逐句演練
        </button>
        {blockedReason && <div className="stp-note">{blockedReason}</div>}
      </div>
    );
  }

  const stepEnd = turn.status === 'stepEnd';
  const paused = turn.status === 'paused';
  const warn = speakerStatus === 'offline' || speakerStatus === 'unassigned';

  return (
    <div className="stp" onClick={stop}>
      <div className="stp-head">
        <span className="stp-title">逐句演練</span>
        <span className={`stp-state stp-state--${turn.status}`}>
          {stepEnd ? '本步結束' : paused ? '暫停中' : `第 ${turn.lineIndex + 1} / ${turn.lineCount} 句`}
        </span>
      </div>

      <ol className="stp-lines">
        {lines.map((l, i) => {
          const isCurrent = i === turn.lineIndex && !stepEnd;
          const isDone = i < turn.lineIndex || stepEnd;
          return (
            <li key={l.id}>
              <button
                type="button"
                className={`stp-line${isCurrent ? ' is-current' : ''}${isDone ? ' is-done' : ''}`}
                style={{ ['--role-color' as string]: l.speaker.color }}
                onClick={() => props.onJump(i)}
                title="跳到這一句"
              >
                <span className="stp-line-who">{l.speaker.label}・{l.speaker.name}</span>
                <span className="stp-line-en">{l.en}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {!stepEnd && (
        <div className={`stp-speaker${warn ? ' is-warn' : ''}`} style={{ ['--role-color' as string]: turn.speaker.color }}>
          <span className={`stp-dot stp-dot--${speakerStatus}`} aria-hidden="true" />
          <span className="stp-speaker-name">{turn.speaker.label}・{turn.speaker.name}</span>
          <span className="stp-speaker-status">{STATUS_TEXT[speakerStatus]}</span>
        </div>
      )}
      {!stepEnd && warn && (
        <div className="stp-note">
          {speakerStatus === 'unassigned' ? `${turn.speaker.label}還沒指派，可由老師代讀後按下一句，或直接略過。` : `${turn.speaker.name}離線中，可由老師代讀或略過。`}
        </div>
      )}
      {!stepEnd && transcript && <div className="stp-transcript">“{transcript}”</div>}

      {stepEnd ? (
        <div className="stp-actions">
          <button type="button" className="stp-btn stp-btn--ghost" onClick={props.onPrev}>重演最後一句</button>
          <button type="button" className="stp-btn stp-btn--primary" onClick={isLastStep ? props.onEnd : props.onNextStep}>
            {isLastStep ? '完成演練' : '完成並進入下一步'}
          </button>
        </div>
      ) : (
        <div className="stp-actions">
          <button type="button" className="stp-icon-btn" onClick={props.onPrev} disabled={turn.lineIndex === 0} aria-label="上一句" title="上一句">
            <span className="material-symbols-outlined">skip_previous</span>
          </button>
          <button type="button" className="stp-icon-btn" onClick={props.onTogglePause} aria-label={paused ? '繼續' : '暫停'} title={paused ? '繼續' : '暫停'}>
            <span className="material-symbols-outlined">{paused ? 'play_arrow' : 'pause'}</span>
          </button>
          <button type="button" className="stp-btn stp-btn--primary stp-next" onClick={props.onNext}>
            {warn ? '略過・下一句' : '下一句'}
            <span className="material-symbols-outlined" aria-hidden="true">skip_next</span>
          </button>
          <button type="button" className="stp-btn stp-btn--ghost" onClick={props.onEnd}>結束</button>
        </div>
      )}
    </div>
  );
}
