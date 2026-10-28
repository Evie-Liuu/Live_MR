import type { ScriptTurn, TurnPerson } from '../utils/scriptTurn.ts';
import { HINT_LABELS, type HintLevel, type TurnHintMode } from '../utils/turnHints.ts';
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
  hintMode: TurnHintMode;
  /** 目前提示等級（學生演出時由 iPad 回報）；null＝還沒收到 */
  hintLevel: HintLevel | null;
  /** 目前等級是自動升的還是老師給的 */
  hintBy: 'auto' | 'teacher';
  onHintModeChange: (mode: TurnHintMode) => void;
  /** 分級提示依沉默時間自動升級 */
  hintAuto: boolean;
  onHintAutoChange: (auto: boolean) => void;
  /** 指定發言者的提示等級 */
  onGiveHint: (level: HintLevel) => void;
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

const HINT_STEPS: HintLevel[] = [0, 1, 2, 3];

/** 台詞提示方式：分級（沉默時一級一級給）或一開始就顯示完整台詞 */
function HintModeToggle({ mode, onChange, auto, onAutoChange }: {
  mode: TurnHintMode;
  onChange: (mode: TurnHintMode) => void;
  auto: boolean;
  onAutoChange: (auto: boolean) => void;
}) {
  return (
    <div className="stp-mode" role="group" aria-label="台詞提示">
      <span className="stp-mode-label">台詞提示</span>
      {mode === 'tiered' && (
        <label className="stp-auto" title="學生沉默時自動給分級提示；關掉後只由老師點選">
          <input type="checkbox" checked={auto} onChange={e => onAutoChange(e.target.checked)} />
          自動
        </label>
      )}
      <button type="button" className={`stp-mode-btn${mode === 'tiered' ? ' is-on' : ''}`} aria-pressed={mode === 'tiered'} onClick={() => onChange('tiered')}>
        分級
      </button>
      <button type="button" className={`stp-mode-btn${mode === 'full' ? ' is-on' : ''}`} aria-pressed={mode === 'full'} onClick={() => onChange('full')}>
        完整
      </button>
    </div>
  );
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
        <HintModeToggle mode={props.hintMode} onChange={props.onHintModeChange} auto={props.hintAuto} onAutoChange={props.onHintAutoChange} />
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
  // 學生演出時提示送到 iPad 和大屏；老師演出、未指派、離線時只顯示在大屏
  const studentSpeaking = speakerStatus === 'speaking' || speakerStatus === 'online';

  return (
    <div className="stp" onClick={stop}>
      <div className="stp-head">
        <span className="stp-title">逐句演練</span>
        <span className={`stp-state stp-state--${turn.status}`}>
          {stepEnd ? '本步結束' : paused ? '暫停中' : `第 ${turn.lineIndex + 1} / ${turn.lineCount} 句`}
        </span>
      </div>
      <HintModeToggle mode={props.hintMode} onChange={props.onHintModeChange} auto={props.hintAuto} onAutoChange={props.onHintAutoChange} />

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
      {!stepEnd && !paused && props.hintMode === 'tiered' && (
        <div className="stp-hints">
          <span className="stp-hints-label">{studentSpeaking ? '提示' : '大屏提示'}</span>
          <div className="stp-hint-steps" role="group" aria-label={props.hintLevel === null ? '等待學生回報' : `目前提示：${HINT_LABELS[props.hintLevel]}`}>
            {HINT_STEPS.map(l => (
              <button
                type="button"
                key={l}
                className={`stp-hint-step${props.hintLevel !== null && l <= props.hintLevel ? ' is-on' : ''}${l === props.hintLevel ? ' is-current' : ''}`}
                aria-pressed={l === props.hintLevel}
                onClick={() => props.onGiveHint(l)}
                title={`學生畫面切到「${HINT_LABELS[l]}」`}
              >
                {HINT_LABELS[l]}
              </button>
            ))}
          </div>
          {props.hintBy === 'teacher' && <span className="stp-hints-by">老師給</span>}
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
