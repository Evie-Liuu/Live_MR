import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TASK_TEMPLATES } from '../config/taskTemplates/index.ts';
import { SCENE_PRESETS } from '../config/scenes.ts';
import { levelLabel } from '../types/lessonPlan.ts';
import type { ScriptTurn } from '../utils/scriptTurn.ts';
import { ROLE_COLORS } from '../utils/nameplates.ts';
import { HINT_LABELS, type HintLevel } from '../utils/turnHints.ts';
import { MIN_CLIP_SECONDS, assistFeedback, distractorLines } from '../utils/speechAssist.ts';
import { useTurnAudioClip } from '../hooks/useTurnAudioClip.ts';
import { MIN_VOICED_SECONDS, VOICE_RMS } from '../utils/wav.ts';
import {
  ISSUE_LABELS, SEVERITY_LABELS, requestSpeechJudgePreview, type SpeechJudgePreview, type TurnJudgment,
} from '../types/speechAssist.ts';
import ScriptTurnOverlay from './ScriptTurnOverlay.tsx';
import './SpeechSimulator.css';

/** 不用 AI 的畫面預覽：直接套一個判斷結果，看學生 iPad 會顯示什麼 */
type Canned = 'ok' | 'minor' | 'chinese' | 'wrong' | 'incomplete';
const CANNED_LABELS: Record<Canned, string> = { ok: '正確', minor: '輕微', chinese: '說中文', wrong: '說錯字', incomplete: '沒說完' };

function cannedJudgment(kind: Canned, en: string): TurnJudgment {
  const words = en.split(/\s+/).filter(Boolean);
  const key = [...words].sort((a, b) => b.length - a.length)[0]?.replace(/[^\p{L}'-]/gu, '') ?? '';
  const base: TurnJudgment = { transcript: en, language: 'en', missing: [], wrong: [], issues: [], severity: 'ok' };
  switch (kind) {
    case 'ok': return base;
    case 'minor': return { ...base, issues: ['incomplete'], missing: [words[words.length - 1] ?? ''], severity: 'minor' };
    case 'chinese': return { ...base, transcript: '（中文）', language: 'zh', issues: ['chinese'], severity: 'severe' };
    case 'wrong': return { ...base, issues: ['wrongWord'], wrong: [{ said: '（說錯的字）', expected: key }], severity: 'severe' };
    case 'incomplete': return { ...base, transcript: words.slice(0, 2).join(' '), issues: ['incomplete'], missing: words.slice(2, 5), severity: 'severe' };
  }
}

interface HistoryItem extends SpeechJudgePreview {
  id: number;
  lineEn: string;
  seconds: number;
}

/** 錄音裡沒有說話聲：本機直接判「沒有回應」，不送 AI */
const SILENT_JUDGMENT: TurnJudgment = { transcript: '', language: 'silent', missing: [], wrong: [], issues: ['noResponse'], severity: 'severe' };

function formatUsd(usd: number): string {
  return `US$${usd.toFixed(usd < 0.01 ? 5 : 3)}`;
}

/**
 * 模擬學生回答（?screen=speech-sim）：選一句台詞，用電腦麥克風扮演學生回答，
 * 送 AI 口說判斷（試用，不存紀錄），在 iPad 畫面上看學生會收到什麼提示，旁邊列出判斷細節與用量。
 */
export default function SpeechSimulator() {
  const [templateId, setTemplateId] = useState(TASK_TEMPLATES[0]?.id ?? '');
  const template = TASK_TEMPLATES.find(t => t.id === templateId) ?? TASK_TEMPLATES[0];
  const task = template.task;
  const [stepIndex, setStepIndex] = useState(0);
  const [lineIndex, setLineIndex] = useState(0);
  const [level, setLevel] = useState(task.level);
  const [hintLevel, setHintLevel] = useState<HintLevel>(0);
  const [noResponse, setNoResponse] = useState(false);

  const step = task.steps[Math.min(stepIndex, task.steps.length - 1)];
  const lines = step.lines.filter(l => l.en.trim());
  const line = lines[Math.min(lineIndex, lines.length - 1)];
  const slots = SCENE_PRESETS[task.sceneId]?.slots ?? [];
  const slotOf = (id: string) => {
    const i = slots.findIndex(s => s.id === id);
    return { label: slots[i]?.label ?? id, color: ROLE_COLORS[(i < 0 ? 0 : i) % ROLE_COLORS.length] };
  };

  // 換劇本：回到第一段第一句、程度跟著劇本
  const pickTemplate = (id: string) => {
    const next = TASK_TEMPLATES.find(t => t.id === id);
    setTemplateId(id);
    setStepIndex(0);
    setLineIndex(0);
    if (next) setLevel(next.task.level);
  };

  // ── 錄音（電腦麥克風）────────────────────────────────
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const [recording, setRecording] = useState(false);
  const [take, setTake] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  /** 即時音量（RMS），錄音時顯示音量條 */
  const [micLevel, setMicLevel] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const getTrack = useCallback(() => trackRef.current, []);
  const { clip, level: readLevel } = useTurnAudioClip(recording, take, getTrack);

  const [judging, setJudging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** note：沒有呼叫 AI 時的說明（不用 AI 預覽、或錄音沒有聲音） */
  const [result, setResult] = useState<{ judgment: TurnJudgment; preview: SpeechJudgePreview | null; note?: string } | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // 換句：清掉畫面上的結果
  const lineKey = `${templateId}:${stepIndex}:${lineIndex}`;
  const [shownKey, setShownKey] = useState(lineKey);
  if (shownKey !== lineKey) {
    setShownKey(lineKey);
    setResult(null);
    setNoResponse(false);
    setError(null);
    setHintLevel(0);
  }

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      setElapsed((Date.now() - startedAt) / 1000);
      setMicLevel(readLevel());
    }, 150);
    return () => { window.clearInterval(timer); setMicLevel(0); };
  }, [recording, startedAt, readLevel]);

  useEffect(() => () => { trackRef.current?.stop(); }, []);

  const startRecording = async () => {
    setMicError(null);
    setError(null);
    try {
      if (!trackRef.current || trackRef.current.readyState !== 'live') {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        trackRef.current = stream.getAudioTracks()[0] ?? null;
      }
      setResult(null);
      setNoResponse(false);
      setTake(t => t + 1);
      setStartedAt(Date.now());
      setElapsed(0);
      setRecording(true);
    } catch {
      setMicError('無法使用麥克風，請在瀏覽器允許麥克風權限');
    }
  };

  const stopAndJudge = async () => {
    if (!recording) return;
    setRecording(false);
    const audio = clip();
    if (!audio || audio.seconds < MIN_CLIP_SECONDS) {
      setError(audio ? '錄音太短，請再說一次' : '沒有錄到任何音訊：這台裝置的錄音沒有啟動，請重新整理頁面後再試');
      return;
    }
    if (audio.peak === 0) {
      setError('錄到的全是靜音：麥克風沒有把聲音送進來。請確認瀏覽器的麥克風權限，或重新整理頁面後再試');
      return;
    }
    if (audio.voicedSeconds < MIN_VOICED_SECONDS) {
      setResult({
        judgment: SILENT_JUDGMENT,
        preview: null,
        note: `錄音裡沒有偵測到說話聲（最大音量 ${(audio.peak * 100).toFixed(1)}%），所以沒有送 AI。上課時也一樣：沒開口不會送 AI 判斷。`,
      });
      return;
    }
    setJudging(true);
    try {
      const preview = await requestSpeechJudgePreview({
        line: { en: line.en, zh: line.zh },
        prevLine: lines[lineIndex - 1]?.en ?? null,
        level,
        audio: { data: audio.data, mimeType: 'audio/wav' },
        audioSeconds: Math.round(audio.seconds * 10) / 10,
      });
      setResult({ judgment: preview.judgment, preview });
      setHistory(h => [{ ...preview, id: Date.now(), lineEn: line.en, seconds: audio.seconds }, ...h].slice(0, 50));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setJudging(false);
    }
  };

  const speaker = slotOf(line.speakerSlotId);
  const turn: ScriptTurn = useMemo(() => ({
    seq: lineIndex + stepIndex * 100,
    status: 'running',
    stepIndex,
    lineIndex,
    lineCount: lines.length,
    speaker: { slotId: line.speakerSlotId, label: speaker.label, color: speaker.color, identity: 'sim', name: '模擬學生' },
    next: null,
    line: { en: line.en, zh: line.zh },
    prop: null,
    nextLine: null,
    hintMode: 'tiered',
    hintAuto: false,
    speechAssist: true,
    taskTitle: task.title,
    level,
    prevLine: lines[lineIndex - 1]?.en ?? null,
    choices: distractorLines(lines.map(l => l.en), lineIndex),
  }), [line, lines, lineIndex, stepIndex, speaker.label, speaker.color, task.title, level]);

  const feedback = result ? assistFeedback(result.judgment, line) : null;
  const totalCost = history.reduce((n, h) => n + h.costUsd, 0);

  return (
    <div className="ssim">
      <header className="ssim-top">
        <h1>模擬學生回答</h1>
        <p>選一句台詞，用電腦麥克風扮演學生回答，看 AI 口說輔助的判斷與學生 iPad 會出現的提示。試用判斷不會存成課堂紀錄。</p>
      </header>

      <div className="ssim-body">
        {/* 左：劇本與台詞 */}
        <aside className="ssim-panel ssim-script" aria-label="劇本">
          <label className="ssim-field">
            <span>劇本</span>
            <select value={templateId} onChange={e => pickTemplate(e.target.value)}>
              {TASK_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="ssim-field">
            <span>學生程度</span>
            <select value={level} onChange={e => setLevel(e.target.value as typeof level)}>
              {['preA1-A1', 'A1', 'A1-A2', 'A2-B1'].map(l => <option key={l} value={l}>{levelLabel(l)}（{l}）</option>)}
            </select>
          </label>
          <div className="ssim-steps" role="tablist" aria-label="段落">
            {task.steps.map((s, i) => (
              <button
                type="button" role="tab" key={s.id} aria-selected={i === stepIndex}
                className={i === stepIndex ? 'is-on' : ''}
                onClick={() => { setStepIndex(i); setLineIndex(0); }}
                title={s.title}
              >
                第 {i + 1} 段
              </button>
            ))}
          </div>
          <p className="ssim-step-title">{step.title}</p>
          <ol className="ssim-lines">
            {lines.map((l, i) => {
              const who = slotOf(l.speakerSlotId);
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    className={`ssim-line${i === lineIndex ? ' is-on' : ''}`}
                    style={{ ['--role-color' as string]: who.color }}
                    onClick={() => setLineIndex(i)}
                  >
                    <span className="ssim-line-who">{who.label}</span>
                    <span className="ssim-line-en">{l.en}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>

        {/* 中：學生 iPad 畫面與錄音 */}
        <section className="ssim-stage" aria-label="學生畫面">
          <div className="ssim-ipad">
            <ScriptTurnOverlay
              turn={turn}
              role="speaking"
              transcript=""
              sttEnabled={false}
              speakerTalking={recording}
              myLevel={micLevel}
              doneSent={judging}
              onDone={() => { void stopAndJudge(); }}
              hintLevel={hintLevel}
              isNext={false}
              assistFeedback={feedback}
              assistPending={judging}
              noResponse={noResponse && !result}
            />
          </div>

          <div className="ssim-controls">
            {recording ? (
              <button type="button" className="ssim-rec is-recording" onClick={() => { void stopAndJudge(); }}>
                <span className="material-symbols-outlined" aria-hidden="true">stop_circle</span>
                停止並判斷（{elapsed.toFixed(1)} 秒）
              </button>
            ) : (
              <button type="button" className="ssim-rec" onClick={() => { void startRecording(); }} disabled={judging}>
                <span className="material-symbols-outlined" aria-hidden="true">mic</span>
                {judging ? 'AI 判斷中…' : '開始回答（錄音）'}
              </button>
            )}
            {recording && (
              <div className="ssim-meter" aria-label="麥克風音量">
                <span className="ssim-meter-label">{micLevel >= VOICE_RMS ? '有聲音' : '聽不到聲音'}</span>
                <span className="ssim-meter-track">
                  <span
                    className={`ssim-meter-fill${micLevel >= VOICE_RMS ? ' is-voice' : ''}`}
                    style={{ width: `${Math.min(100, Math.sqrt(micLevel / 0.2) * 100)}%` }}
                  />
                </span>
              </div>
            )}
            {(micError || error) && <p className="ssim-error" role="alert">{micError ?? error}</p>}

            <div className="ssim-row">
              <span className="ssim-row-label">分級提示</span>
              {([0, 1, 2, 3] as HintLevel[]).map(l => (
                <button type="button" key={l} className={`ssim-chip${l === hintLevel ? ' is-on' : ''}`} onClick={() => setHintLevel(l)}>
                  {HINT_LABELS[l]}
                </button>
              ))}
            </div>
            <div className="ssim-row">
              <span className="ssim-row-label">不用 AI 預覽</span>
              {(Object.keys(CANNED_LABELS) as Canned[]).map(k => (
                <button
                  type="button" key={k} className="ssim-chip"
                  onClick={() => { setNoResponse(false); setResult({ judgment: cannedJudgment(k, line.en), preview: null }); }}
                >
                  {CANNED_LABELS[k]}
                </button>
              ))}
              <button type="button" className="ssim-chip" onClick={() => { setResult(null); setNoResponse(true); }}>沒有回應</button>
              <button type="button" className="ssim-chip ssim-chip--ghost" onClick={() => { setResult(null); setNoResponse(false); }}>清除</button>
            </div>
          </div>
        </section>

        {/* 右：判斷細節與用量 */}
        <aside className="ssim-panel ssim-result" aria-label="判斷結果" aria-live="polite">
          <h2>判斷結果</h2>
          {!result ? (
            <p className="ssim-empty">按「開始回答」說這句台詞（也可以故意說中文、說錯字或只說一半），說完按「停止並判斷」。</p>
          ) : (
            <>
              <div className={`ssim-sev ssim-sev--${result.judgment.severity}`}>
                {SEVERITY_LABELS[result.judgment.severity]}
                <small>
                  {result.judgment.severity === 'ok' ? '不介入' : result.judgment.severity === 'minor' ? '只記錄、不打斷' : '學生 iPad 顯示提示'}
                </small>
              </div>
              <dl className="ssim-dl">
                <dt>聽到</dt><dd>“{result.judgment.transcript || '（沒有聲音）'}”</dd>
                <dt>語言</dt><dd>{{ en: '英文', zh: '中文', mixed: '中英混用', silent: '沒有聲音' }[result.judgment.language]}</dd>
                <dt>問題</dt><dd>{result.judgment.issues.length ? result.judgment.issues.map(i => ISSUE_LABELS[i]).join('、') : '無'}</dd>
                {result.judgment.wrong.length > 0 && (<><dt>說錯</dt><dd>{result.judgment.wrong.map(w => `${w.said} → ${w.expected}`).join('、')}</dd></>)}
                {result.judgment.missing.length > 0 && (<><dt>漏掉</dt><dd>{result.judgment.missing.join(', ')}</dd></>)}
              </dl>
              {result.preview ? (
                <dl className="ssim-dl ssim-dl--usage">
                  <dt>模型</dt><dd>{result.preview.model}</dd>
                  <dt>延遲</dt><dd>{(result.preview.latencyMs / 1000).toFixed(1)} 秒</dd>
                  <dt>Token</dt><dd>輸入 {result.preview.usage.prompt}（音訊 {result.preview.usage.audio}）／輸出 {result.preview.usage.output}</dd>
                  <dt>費用</dt><dd>{formatUsd(result.preview.costUsd)}</dd>
                </dl>
              ) : (
                <p className="ssim-note">{result.note ?? '這是「不用 AI 預覽」的範例結果，沒有呼叫 AI。'}</p>
              )}
            </>
          )}

          {history.length > 0 && (
            <>
              <h3>本次試用（{history.length} 次・共 {formatUsd(totalCost)}）</h3>
              <ol className="ssim-history">
                {history.map(h => (
                  <li key={h.id}>
                    <span className={`ssim-dot ssim-dot--${h.judgment.severity}`} aria-hidden="true" />
                    <span className="ssim-history-line">{h.lineEn}</span>
                    <span className="ssim-history-meta">
                      {SEVERITY_LABELS[h.judgment.severity]}・{h.seconds.toFixed(1)} 秒・{(h.latencyMs / 1000).toFixed(1)} 秒回應
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
