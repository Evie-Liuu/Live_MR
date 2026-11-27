import React from 'react';
import type { ScriptTurn, TurnPerson } from '../utils/scriptTurn.ts';
import { HINT_LABELS, type HintLevel, type TurnHintMode } from '../utils/turnHints.ts';
import { ISSUE_LABELS, SEVERITY_LABELS, type TurnJudgment } from '../types/speechAssist.ts';
import './ScriptTurnHostPanel.css';

/** 發言者目前的狀態（老師端提示要不要代讀或略過） */
export type SpeakerStatus = 'speaking' | 'online' | 'offline' | 'unassigned' | 'teacher';

interface ScriptTurnHostPanelProps {
  /** null＝沒在逐句演練 */
  turn: ScriptTurn | null;
  /** 目前步驟的台詞（併角後） */
  lines: { id: string; en: string; zh?: string; speaker: TurnPerson }[];
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
  /** AI 口說輔助（學生停住時送錄音判斷） */
  speechAssist: boolean;
  onSpeechAssistChange: (on: boolean) => void;
  /** 目前這一句最新的 AI 判斷；null＝還沒有 */
  judgment: TurnJudgment | null;
  /** 打開本堂課的口說紀錄 */
  onOpenSpeechReport: () => void;
}

/** 發言者這一句的 AI 判斷結果 */
function JudgmentBadge({ judgment }: { judgment: TurnJudgment }) {
  const detail = [
    ...judgment.wrong.map(w => `${w.said}→${w.expected}`),
    ...(judgment.missing.length > 0 ? [`漏了 ${judgment.missing.join(', ')}`] : []),
  ].join('；');
  return (
    <div className={`stp-judge stp-judge--${judgment.severity}`}>
      <span className="stp-judge-sev">AI・{SEVERITY_LABELS[judgment.severity]}</span>
      {judgment.issues.length > 0 && <span className="stp-judge-issues">{judgment.issues.map(i => ISSUE_LABELS[i]).join('、')}</span>}
      {judgment.transcript && <span className="stp-judge-said">“{judgment.transcript}”</span>}
      {detail && <span className="stp-judge-detail">{detail}</span>}
    </div>
  );
}

const HINT_STEPS: HintLevel[] = [0, 1, 2, 3];

const STATUS_TEXT: Record<SpeakerStatus, string> = {
  speaking: '說話中',
  online: '等待開口',
  offline: '離線',
  unassigned: '未指派',
  teacher: '老師演出',
};

function playTts(text: string) {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  }
}

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
        {/* 頂部 MR 雙語角小標題 */}
        <div className="stp-super-head">
          <span className="stp-super-title">MR 雙語角</span>
          <span className="material-symbols-outlined stp-super-icon" aria-hidden="true">chevron_left</span>
        </div>

        <div className="stp-head">
          <span className="stp-title">登台展演</span>
          <span className="stp-hint">{lines.length} 句</span>
        </div>

        {/* 雙開關列 */}
        <div className="stp-toggles-row">
          <div className="stp-toggle-item">
            <span className="stp-toggle-label"><span className="material-symbols-outlined" style={{ fontSize: '20px' }}>wb_incandescent</span> 台詞提示</span>
            <label className="stp-ios-switch" title="點擊切換台詞提示模式">
              <input
                type="checkbox"
                checked={props.hintMode === 'tiered'}
                onChange={e => props.onHintModeChange(e.target.checked ? 'tiered' : 'full')}
              />
              <span className="stp-switch-track">
                <span className="stp-switch-thumb"></span>
              </span>
            </label>
          </div>
          <div className="stp-toggle-item">
            <span className="stp-toggle-label" onClick={props.onOpenSpeechReport} title="查看紀錄" style={{ cursor: 'pointer' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>mobile_speaker</span> 口說輔助
            </span>
            <label className="stp-ios-switch">
              <input
                type="checkbox"
                checked={props.speechAssist}
                onChange={e => props.onSpeechAssistChange(e.target.checked)}
              />
              <span className="stp-switch-track">
                <span className="stp-switch-thumb"></span>
              </span>
            </label>
          </div>
        </div>

        <button
          type="button"
          className="stp-btn stp-btn--primary stp-start"
          onClick={props.onStart}
          disabled={!!blockedReason || lines.length === 0}
          title={blockedReason ?? undefined}
        >
          <span className="material-symbols-outlined" aria-hidden="true">record_voice_over</span>
          角色就位
        </button>
        {blockedReason && <div className="stp-note">{blockedReason}</div>}
      </div>
    );
  }

  const stepEnd = turn.status === 'stepEnd';
  const paused = turn.status === 'paused';
  const warn = speakerStatus === 'offline' || speakerStatus === 'unassigned';
  const current = lines[turn.lineIndex];
  const upNext = lines[turn.lineIndex + 1];

  return (
    <div className="stp" onClick={stop}>
      {/* 頂部 MR 雙語角小標題 */}
      <div className="stp-super-head">
        <span className="stp-super-title">MR 雙語角</span>
        <span className="material-symbols-outlined stp-super-icon" aria-hidden="true">chevron_left</span>
      </div>

      <div className="stp-head">
        <span className="stp-title">登台展演</span>
        <span className={`stp-state stp-state--${turn.status}`}>
          {stepEnd ? '本步結束' : paused ? '暫停中' : `${turn.lineIndex + 1} / ${turn.lineCount} 句`}
        </span>
      </div>

      {/* 雙開關列 */}
      <div className="stp-toggles-row">
        <div className="stp-toggle-item">
          <span className="stp-toggle-label"><span className="material-symbols-outlined" style={{ fontSize: '20px' }}>wb_incandescent</span> 台詞提示</span>
          <label className="stp-ios-switch">
            <input
              type="checkbox"
              checked={props.hintMode === 'tiered'}
              onChange={e => props.onHintModeChange(e.target.checked ? 'tiered' : 'full')}
            />
            <span className="stp-switch-track">
              <span className="stp-switch-thumb"></span>
            </span>
          </label>
        </div>
        <div className="stp-toggle-item">
          <span className="stp-toggle-label" onClick={props.onOpenSpeechReport} title="點擊查看紀錄" style={{ cursor: 'pointer' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>mobile_speaker</span> 口說輔助
          </span>
          <label className="stp-ios-switch" title="AI 口說輔助開關">
            <input
              type="checkbox"
              checked={props.speechAssist}
              onChange={e => props.onSpeechAssistChange(e.target.checked)}
            />
            <span className="stp-switch-track">
              <span className="stp-switch-thumb"></span>
            </span>
          </label>
        </div>
      </div>

      {/* 當前台詞區 */}
      {!stepEnd && current && (
        <div className={`stp-now${warn ? ' is-warn' : ''}`} style={{ ['--role-color' as string]: turn.speaker.color }}>
          <div className="stp-speaker">
            <span className={`stp-dot stp-dot--${speakerStatus}`} aria-hidden="true" />
            <span className="stp-speaker-name">{turn.speaker.label}・{turn.speaker.name}</span>
            <span className="stp-speaker-status">{STATUS_TEXT[speakerStatus]}</span>
          </div>

          <div className="stp-now-en-wrap">
            <span className="stp-now-en">{current.en}</span>
            <button
              type="button"
              className="stp-tts-btn"
              onClick={() => playTts(current.en)}
              title="播放發音"
              aria-label="播放發音"
            >
              <span className="material-symbols-outlined" aria-hidden="true">volume_up</span>
            </button>
          </div>

          {current.zh && (
            <div className="stp-now-zh">{current.zh}</div>
          )}

          {turn.prop && <div className="stp-prop-cue">✊ 握拳拿起{turn.prop.label}{turn.prop.wear && '，雙手握拳試穿'}</div>}
          {transcript && <div className="stp-transcript">“{transcript}”</div>}
          {props.judgment && <JudgmentBadge judgment={props.judgment} />}
        </div>
      )}

      {/* 警告備注卡片 */}
      {!stepEnd && warn && (
        <div className="stp-note">
          {speakerStatus === 'unassigned'
            ? `${turn.speaker.label} 還沒指派，可由老師代讀後按下一句，或直接略過老師可代讀或按下下一句跳過`
            : `${turn.speaker.name} 離線中，可由老師代讀或按下一句跳過`}
        </div>
      )}

      {/* 大屏提示 */}
      {!stepEnd && !paused && props.hintMode === 'tiered' && (
        <div className="stp-hints-bar">
          <span className="stp-hints-title">大屏提示：</span>
          <div className="stp-hint-options" role="group" aria-label="大屏提示選項">
            {HINT_STEPS.map(l => {
              const isCurrent = props.hintLevel === l || (props.hintLevel === null && l === 0);
              return (
                <button
                  type="button"
                  key={l}
                  className={`stp-hint-opt${isCurrent ? ' is-selected' : ''}`}
                  onClick={() => props.onGiveHint(l)}
                  title={`大屏提示切換至「${HINT_LABELS[l]}」`}
                >
                  {HINT_LABELS[l]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 下一句預覽 */}
      {!stepEnd && upNext && (
        <div className="stp-next-line" style={{ ['--role-color' as string]: upNext.speaker.color }}>
          <span className="stp-next-label">下一句</span>
          <span className="stp-next-who">{upNext.speaker.label}</span>
          <span className="stp-next-en">{upNext.en}</span>
        </div>
      )}

      {/* 全部台詞 */}
      <details className="stp-all">
        <summary>全部台詞（{lines.length} 句）・點一句可跳過</summary>
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
      </details>

      {/* 操作按鈕列 */}
      {stepEnd ? (
        <div className="stp-actions">
          <button type="button" className="stp-btn stp-btn--ghost" onClick={props.onPrev}>重演最後一句</button>
          <button type="button" className="stp-btn stp-btn--primary" onClick={isLastStep ? props.onEnd : props.onNextStep}>
            {isLastStep ? '完成展演' : '完成並進入下一步'}
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
            <span className="material-symbols-outlined stp-arrow-icon" aria-hidden="true">arrow_right</span>
          </button>
          <button type="button" className="stp-btn stp-btn--text" onClick={props.onEnd}>結束展演</button>
        </div>
      )}
    </div>
  );
}
