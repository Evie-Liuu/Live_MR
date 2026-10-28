import type { ScriptTurn, TurnRole } from '../utils/scriptTurn.ts';
import { HINT_LABELS, shownHintLevel, type HintLevel } from '../utils/turnHints.ts';
import TurnHintBody from './TurnHintBody.tsx';
import './ScriptTurnOverlay.css';

interface ScriptTurnOverlayProps {
  turn: ScriptTurn | null;
  role: TurnRole;
  /** 目前發言者的即時逐字稿 */
  transcript: string;
  /** 自己這台會產生逐字稿 */
  sttEnabled: boolean;
  /** 目前發言者正在出聲（LiveKit ActiveSpeakers） */
  speakerTalking: boolean;
  /** 自己的音量 0–1（發言時麥克風圈縮放） */
  myLevel: number;
  doneSent: boolean;
  onDone: () => void;
  /** 發言時的提示等級（0 意思 → 3 完整） */
  hintLevel: HintLevel;
  /** 自己是下一位（聆聽時提早準備） */
  isNext: boolean;
}

function speak(text: string) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.9;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

/** 發言畫面的台詞區：依提示等級顯示，完整時多一個「聽一次」 */
function TurnHint({ turn, level }: { turn: ScriptTurn; level: HintLevel }) {
  const shown = shownHintLevel(turn.line, level);
  const tiered = turn.hintMode !== 'full';
  return (
    <div key={shown} className="sto-hint">
      {tiered && (
        <span className={`sto-hint-tag${shown > 0 ? ' is-raised' : ''}`}>
          {shown === 0 ? '用英文說說看' : `提示・${HINT_LABELS[shown]}`}
        </span>
      )}
      <TurnHintBody line={turn.line} seq={turn.seq} level={shown} classPrefix="sto" />
      {shown === 3 && (
        <button type="button" className="sto-listen-btn" onClick={() => speak(turn.line.en)}>
          <span className="material-symbols-outlined" aria-hidden="true">volume_up</span>
          聽一次
        </button>
      )}
    </div>
  );
}

/**
 * 逐句演練的學生畫面：輪到自己是角色主題色的「發言狀態」，其他時候是深灰半透明的「聆聽狀態」。
 * 只是疊在上面的遮罩，底下的鏡頭與姿勢偵測照常運作。
 */
export default function ScriptTurnOverlay(props: ScriptTurnOverlayProps) {
  const { turn, role, transcript } = props;
  if (!turn || role === 'idle') return null;

  if (role === 'speaking') {
    const scale = 1 + Math.min(1, props.myLevel * 3) * 0.35;
    return (
      <div
        key={`speak-${turn.seq}`}
        className="sto sto--speaking"
        style={{ ['--turn-color' as string]: turn.speaker.color }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sto-speak-title"
      >
        <div className="sto-top">
          <span className="sto-role-pill">{turn.speaker.label} · 你</span>
          <span className="sto-count">第 {turn.lineIndex + 1} 句 / 共 {turn.lineCount} 句</span>
        </div>
        <div className="sto-center">
          <div id="sto-speak-title" className="sto-your-turn">輪到你了</div>
          <TurnHint turn={turn} level={props.hintLevel} />
          <div className={`sto-mic${props.speakerTalking ? ' is-live' : ''}`} aria-hidden="true">
            <span className="sto-mic-ring" style={{ transform: `scale(${scale})` }} />
            <span className="material-symbols-outlined sto-mic-icon">mic</span>
          </div>
          {props.sttEnabled && transcript && <div className="sto-own-transcript">{transcript}</div>}
        </div>
        <button
          type="button"
          className={`sto-done-btn${props.doneSent ? ' is-sent' : ''}`}
          onClick={props.onDone}
          disabled={props.doneSent}
        >
          {props.doneSent ? '已送出…' : '我說完了'}
          {!props.doneSent && <span className="material-symbols-outlined" aria-hidden="true">check_circle</span>}
        </button>
      </div>
    );
  }

  return (
    <div className="sto sto--listening" style={{ ['--turn-color' as string]: turn.speaker.color }} aria-live="polite">
      <div className="sto-muted">
        <span className="material-symbols-outlined" aria-hidden="true">mic_off</span>
        麥克風已靜音
      </div>
      <div className="sto-center">
        <div className="sto-listening">
          Listening to <span className="sto-speaker">{turn.speaker.label}</span>
          <span className={`sto-wave${props.speakerTalking ? ' is-live' : ''}`} aria-hidden="true"><i /><i /><i /></span>
        </div>
        <div className="sto-speaker-name">{turn.speaker.name}</div>
        {/* {transcript ? (
          <div className="sto-transcript">{transcript}</div>
        ) : (
          <div className="sto-transcript sto-transcript--script">
            <span className="sto-transcript-tag">台詞</span>
            {turn.line.en}
          </div>
        )} */}
      </div>
      {props.isNext && turn.next && (
        <div className="sto-next" style={{ ['--next-color' as string]: turn.next.color }}>
          <span className="sto-next-label">下一句輪到你</span>
          {turn.nextLine && <span className="sto-next-line">{turn.nextLine}</span>}
        </div>
      )}
    </div>
  );
}
