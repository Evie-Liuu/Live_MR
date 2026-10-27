import { useState } from 'react';
import type { AIHintMode, AIHintPayload } from '../config/aiAssistant.ts';
import type { TokenUsage } from '../utils/geminiClient.ts';

export type InteractionPhase = 'idle' | 'teacher' | 'generating' | 'student';

interface AiAssistantPanelProps {
  sttSupported: boolean;
  /** 目前場景有 AI 助理約束文件 */
  hasConstraint: boolean;
  interactionPhase: InteractionPhase;
  aiBusy: boolean;
  /** 大屏編輯模式中：不能開始互動 */
  bigScreenEditing: boolean;
  /** 逐句演練中：不能開始互動 */
  scriptActive: boolean;
  onStartInteraction: () => void;
  onTeacherDone: () => void;
  onTeacherTakeover: () => void;
  onEndInteraction: () => void;

  sttRecording: boolean;
  /** 錄音秒數 */
  recordDuration: number;
  sttError: string | null;
  sttInterim: string;
  sttTranscript: string;
  /** 錄到的內容太短 */
  tooShort: boolean;
  /** DEV：直接帶入文字當作錄音結果 */
  onSimulate: (text: string) => void;

  aiModel: string | null;
  latestHint: AIHintPayload | null;
  detectedQuestion: string;
  aiUsage: TokenUsage | null;
  aiCumulativeTokens: number;
  /** 自動廣播重組提示的倒數秒數；null＝沒有倒數 */
  countdown: number | null;
  /** 有可用的 transcript，可以產生提示 */
  canTrigger: boolean;
  onHint: (mode: AIHintMode) => void;
  aiError: string | null;
  lessonPlanNotice: string | null;
  onClearHint: () => void;
}

/**
 * 老師端右側「AI 助理」分頁：開始互動（老師說 → AI 產生學生回覆提示 → 學生說）、
 * 錄音狀態、AI 回覆語句、提示難度（重組／完整／延伸）與清除學生畫面。
 * 狀態與 AI 呼叫都在 HostSession，這裡只負責顯示與回呼。
 */
export default function AiAssistantPanel(props: AiAssistantPanelProps) {
  const {
    sttSupported, hasConstraint, interactionPhase, aiBusy, bigScreenEditing, scriptActive,
    onStartInteraction, onTeacherDone, onTeacherTakeover, onEndInteraction,
    sttRecording, recordDuration, sttError, sttInterim, sttTranscript, tooShort, onSimulate,
    aiModel, latestHint, detectedQuestion, aiUsage, aiCumulativeTokens, countdown, canTrigger, onHint,
    aiError, lessonPlanNotice, onClearHint,
  } = props;
  const [simInput, setSimInput] = useState('');

  return (
    <div className="hs-ai-panel">
      <div className="hs-ai-brand">
        <span className="hs-ai-brand-icon">✨</span>
        <span className="hs-ai-brand-text">
          <span className="hs-ai-brand-ai">AI</span>
          <span className="hs-ai-brand-tag">助理</span>
        </span>
      </div>

      {!sttSupported ? (
        <div className="hs-ai-error">瀏覽器不支援 Web Speech API，請使用 Chrome 或 Edge</div>
      ) : !hasConstraint ? (
        <div className="hs-ai-error">此場景尚無 AI 助理約束文件</div>
      ) : null}

      {/* ── 開始互動（開放式輪流）─────────────────────── */}
      <div className="hs-ai-section">
        {interactionPhase === 'idle' && (
          <button
            className={`hs-ai-start-btn phase-${interactionPhase}`}
            disabled={!sttSupported || !hasConstraint || aiBusy || bigScreenEditing || scriptActive}
            title={bigScreenEditing ? '大屏編輯模式中，無法開始互動' : scriptActive ? '逐句演練中，結束演練後才能開始互動' : undefined}
            onClick={onStartInteraction}
          >
            <span className="material-symbols-outlined">smart_toy</span>
            開始互動
          </button>
        )}
        {interactionPhase === 'teacher' && (
          <button
            className={`hs-ai-start-btn phase-${interactionPhase}`}
            disabled={aiBusy}
            onClick={onTeacherDone}
          >
            <span className="material-symbols-outlined">swap_horiz</span>
            {aiBusy ? '上一輪生成中…' : '換學生'}
          </button>
        )}
        {interactionPhase === 'generating' && (
          <button className={`hs-ai-start-btn phase-${interactionPhase}`} disabled>
            AI 生成中…
          </button>
        )}
        {interactionPhase === 'student' && (
          <button
            className={`hs-ai-start-btn phase-${interactionPhase}`}
            onClick={onTeacherTakeover}
          >
            <span className="material-symbols-outlined">undo</span>
            輪到自己
          </button>
        )}
        {interactionPhase !== 'idle' && (
          <button className="hs-ai-start-cancel" onClick={onEndInteraction}>
            結束互動
          </button>
        )}
        {/* {import.meta.env.DEV && (
          <button
            type="button"
            className="hs-ai-test-audio-btn"
            onClick={handleToggleTestAudio}
            style={{ fontSize: 12 }}
          >
            ▶ 測試音檔
          </button>
        )} */}
      </div>

      {/* ── 音錄 ─────────────────────────────────────── */}
      <div className="hs-ai-section">
        {/* <div className="hs-ai-section-label">音錄</div> */}
        <div className={`hs-ai-record-card ${sttRecording ? 'is-recording' : ''}`}>
          <div className="hs-ai-record-time">
            {String(Math.floor(recordDuration / 60)).padStart(2, '0')}:{String(recordDuration % 60).padStart(2, '0')}
          </div>
          <div className={`hs-ai-waveform ${sttRecording ? 'is-active' : ''}`} aria-hidden="true">
            {[
              15, 20, 25, 45, 60, 50, 35, 40, 75, 90, 80, 65,
              45, 55, 85, 100, 95, 80, 65, 50, 40, 30, 25, 35,
              55, 70, 80, 60, 45, 30, 20, 15, 12, 10, 8, 5
            ].map((h, i) => (
              <span
                key={i}
                className="hs-ai-wave-bar"
                style={{
                  '--bar-h': `${h}%`,
                  animationDelay: `${i * 0.05}s`
                } as React.CSSProperties}
              />
            ))}
          </div>
          {/* <div className="hs-ai-record-actions">
            <button
              className="hs-ai-record-action-btn"
              disabled={!sttSupported}
              onClick={handleToggleRecord}
              title={sttRecording ? '停止錄音' : '備用：點擊開始錄音'}
            >
              <span className="material-symbols-outlined">
                {sttRecording ? 'stop_circle' : 'mic'}
              </span>
              {sttRecording ? '停止' : '備用'}
            </button>
          </div>
          <div className="hs-ai-record-status-row">
            {sttRecording
              ? '錄音中… 放開 Space 即送出'
              : sttSupported
                ? <>
                  按住 <kbd className="hs-ai-kbd">Space</kbd> 開始，放開即發送
                </>
                : '不支援'}
          </div> */}
        </div>
        {sttError && <div className="hs-ai-error">{sttError}</div>}
        {import.meta.env.DEV && (
          <div className="hs-ai-sim" style={{ marginTop: 8, padding: 8, border: '1px dashed #999', borderRadius: 6, fontSize: 12 }}>
            <div style={{ color: '#888', marginBottom: 4 }}>🛠 DEV：模擬錄音（直接帶入文字）</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                value={simInput}
                onChange={(e) => setSimInput(e.target.value)}
                placeholder="例如：How would you like to pay, cash or card?"
                style={{ flex: 1, padding: '4px 6px', fontSize: 12 }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && simInput.trim().length >= 3) {
                    onSimulate(simInput);
                  }
                }}
              />
              <button
                onClick={() => onSimulate(simInput)}
                disabled={simInput.trim().length < 3 || sttRecording}
                style={{ padding: '4px 10px', fontSize: 12 }}
              >
                帶入
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── AI 回覆語句 ──────────────────────────────── */}
      <div className="hs-ai-section">
        <div className="hs-ai-section-label">AI 回覆語句</div>
        <div className="hs-ai-reply-card">
          <div className="hs-ai-reply-row">
            <div className="hs-ai-reply-label">老師原話</div>
            <div className="hs-ai-reply-text">
              {sttRecording && sttInterim
                ? <span className="hs-ai-reply-interim">"{sttInterim}"</span>
                : sttTranscript
                  ? `"${sttTranscript}"`
                  : <span className="hs-ai-reply-placeholder">尚未錄音</span>}
            </div>
          </div>
          <div className="hs-ai-reply-row">
            <div className="hs-ai-reply-label">
              <span>AI 回覆</span>
              {import.meta.env.DEV && aiModel && (
                <span
                  className="hs-ai-model-badge"
                  title="目前使用的 Gemini 模型"
                  style={{ marginLeft: 6, fontSize: 8, opacity: 0.6, fontWeight: 400, lineHeight: '9px' }}
                >
                  {aiModel}
                </span>
              )}
            </div>
            <div className="hs-ai-reply-text">
              {aiBusy
                ? <span className="hs-ai-reply-placeholder">AI 生成中…</span>
                : latestHint && latestHint.content
                  ? latestHint.content
                  : <span className="hs-ai-reply-placeholder">尚未生成提示</span>}
            </div>
            {latestHint?.content && !aiBusy && (
              <button
                className="hs-ai-reply-speak"
                title="朗讀"
                onClick={() => {
                  try {
                    const u = new SpeechSynthesisUtterance(latestHint.content!);
                    u.lang = 'en-US';
                    window.speechSynthesis.cancel();
                    window.speechSynthesis.speak(u);
                  } catch { /* ignore */ }
                }}
              >
                <span className="material-symbols-outlined">volume_up</span>
              </button>
            )}
          </div>
          {!sttRecording && sttTranscript && tooShort && (
            <div className="hs-ai-warn">太短，請再錄一次</div>
          )}
          {import.meta.env.DEV && detectedQuestion && (
            <div className="hs-ai-detected-question" style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>
              偵測問句：{detectedQuestion}
            </div>
          )}
          {import.meta.env.DEV && aiUsage && (
            <div className="hs-ai-usage" style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>
              用量{'　'}本次 in {aiUsage.prompt} / out {aiUsage.output} / 合 {aiUsage.total}{'　·　'}累計 {aiCumulativeTokens}
            </div>
          )}
          {/* {import.meta.env.DEV && heardTranscript && (
            <div className="hs-ai-heard" style={{ fontSize: 12, opacity: 0.7 }}>
              🎧 Gemini 聽到：{heardTranscript}
            </div>
          )} */}
        </div>
      </div>

      {countdown !== null && (
        <div className="hs-ai-countdown">
          <span className="hs-ai-countdown-text">⏱ {countdown} 秒後自動廣播重組提示…</span>
          <div className="hs-ai-countdown-bar">
            <div className="hs-ai-countdown-fill" style={{ width: `${(countdown / 3) * 100}%` }} />
          </div>
        </div>
      )}

      {/* ── 提示難度 ─────────────────────────────────── */}
      <div className="hs-ai-section">
        <div className="hs-ai-section-label">提示難度</div>
        <div className="hs-ai-mode-cards">
          <button
            className={`hs-ai-mode-card hs-ai-mode-card--rearrange ${countdown !== null ? 'is-auto-target' : ''} ${latestHint?.mode === 'rearrange' ? 'is-active' : ''}`}
            disabled={aiBusy || !(canTrigger || latestHint !== null)}
            onClick={() => onHint('rearrange')}
          >
            <span className="hs-ai-mode-card-icon">
              <span className="material-symbols-outlined">shuffle</span>
            </span>
            <span className="hs-ai-mode-card-label">重組{countdown !== null ? '（自動）' : ''}</span>
          </button>
          <button
            className={`hs-ai-mode-card hs-ai-mode-card--complete ${latestHint?.mode === 'complete' ? 'is-active' : ''}`}
            disabled={aiBusy || !(canTrigger || latestHint !== null)}
            onClick={() => onHint('complete')}
          >
            <span className="hs-ai-mode-card-icon">
              <span className="material-symbols-outlined">check_circle</span>
            </span>
            <span className="hs-ai-mode-card-label">完整</span>
          </button>
          <button
            className={`hs-ai-mode-card hs-ai-mode-card--extend ${latestHint?.mode === 'extend' ? 'is-active' : ''}`}
            disabled={aiBusy || !(canTrigger || latestHint !== null)}
            onClick={() => onHint('extend')}
          >
            <span className="hs-ai-mode-card-icon">
              <span className="material-symbols-outlined">open_in_new</span>
            </span>
            <span className="hs-ai-mode-card-label">延伸</span>
          </button>
        </div>
      </div>

      {aiError && <div className="hs-ai-error">{aiError}</div>}
      {lessonPlanNotice && <div className="hs-ai-error">{lessonPlanNotice}</div>}

      {/* ── 重組提示 chips（僅 rearrange 模式顯示）─────── */}
      {latestHint && latestHint.content && latestHint.mode === 'rearrange' && (
        <div className="hs-ai-section">
          <div className="hs-ai-section-label">重組提示</div>
          <div className="hs-ai-chips">
            {latestHint.content.split(' ').map((w, i) => (
              <span key={i} className="ai-chip">{w}</span>
            ))}
          </div>
        </div>
      )}

      {latestHint && latestHint.content && (
        <button className="hs-ai-clear-btn" onClick={onClearHint}>✕ 清除學生畫面</button>
      )}
    </div>
  );
}
