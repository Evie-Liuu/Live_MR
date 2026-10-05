import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SCENE_PRESETS, THEMES } from '../config/scenes.ts';
import { estimateLineSeconds, type DialogueTask } from '../types/dialogueTask.ts';
import { useScriptStage } from '../hooks/useScriptStage.ts';
import { firstCueOfStep, flattenCues, genderFromVrmId, pickRoleVoices, type RoleVoice } from '../utils/scriptPlayback.ts';
import { gestureById } from '../config/gestures.ts';
import './ScriptSimulator.css';

interface ScriptSimulatorProps {
  task: DialogueTask;
  /** 開啟時從哪個步驟開始 */
  startStepIndex?: number;
  onClose: () => void;
}

type Status = 'idle' | 'playing' | 'paused' | 'ended';

const SPEEDS = [0.75, 1, 1.25] as const;
/** 句與句之間的停頓（毫秒，會依速度縮放） */
const LINE_GAP_MS = 700;
/** 與任務編輯器相同的角色輪替色 */
const SPEAKER_COLORS = ['#2BB5A8', '#8B6FD9', '#F59E0B', '#3B82F6'];

function canSpeak() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export default function ScriptSimulator({ task, startStepIndex = 0, onClose }: ScriptSimulatorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stage = useScriptStage(canvasRef, task.sceneId);
  const { setSpeaker, playGesture } = stage;
  const cues = useMemo(() => flattenCues(task), [task]);
  const preset = SCENE_PRESETS[task.sceneId];
  const slots = useMemo(
    () => THEMES.flatMap(t => t.scenes).find(s => s.id === task.sceneId)?.slots ?? [],
    [task.sceneId],
  );

  const [index, setIndex] = useState(() => Math.max(0, firstCueOfStep(cues, startStepIndex)));
  const [status, setStatus] = useState<Status>('idle');
  const [speed, setSpeed] = useState<number>(1);
  const [showZh, setShowZh] = useState(true);
  const [roleVoices, setRoleVoices] = useState<Record<string, RoleVoice>>({});

  // 每次換句 / 暫停都 +1，讓舊的 TTS 回呼與計時器失效
  const tokenRef = useRef(0);
  const timersRef = useRef<number[]>([]);
  const listRef = useRef<HTMLOListElement>(null);
  /** playCue 播完要接下一句，透過 ref 呼叫最新版本 */
  const playCueRef = useRef<(i: number) => void>(() => {});

  // 瀏覽器的聲音清單是非同步載入的
  useEffect(() => {
    if (!canSpeak()) return;
    const load = () => {
      const hints = Object.fromEntries(slots.map(s => [s.id, genderFromVrmId(s.defaultVrmId)]));
      setRoleVoices(pickRoleVoices(window.speechSynthesis.getVoices(), slots.map(s => s.id), hints));
    };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, [slots]);

  const clearTimers = () => {
    for (const t of timersRef.current) window.clearTimeout(t);
    timersRef.current = [];
  };

  const stopAudio = useCallback(() => {
    tokenRef.current += 1;
    clearTimers();
    if (canSpeak()) window.speechSynthesis.cancel();
    setSpeaker(null);
  }, [setSpeaker]);

  // 關閉模擬器時停止語音
  useEffect(() => () => stopAudio(), [stopAudio]);

  /** 播放第 i 句；播完自動接下一句 */
  const playCue = useCallback((i: number) => {
    stopAudio();
    const cue = cues[i];
    if (!cue) { setStatus('ended'); return; }
    const token = tokenRef.current;
    setIndex(i);
    setStatus('playing');

    let finished = false;
    const finish = () => {
      if (finished || token !== tokenRef.current) return;
      finished = true;
      setSpeaker(null);
      const next = window.setTimeout(() => {
        if (token !== tokenRef.current) return;
        if (i + 1 < cues.length) playCueRef.current(i + 1);
        else setStatus('ended');
      }, LINE_GAP_MS / speed);
      timersRef.current.push(next);
    };

    setSpeaker(cue.line.speakerSlotId);
    if (cue.line.gesture) playGesture(cue.line.speakerSlotId, cue.line.gesture);
    const text = cue.line.en.trim();
    const estimateMs = (estimateLineSeconds(text) * 1000) / speed;

    if (!text || !canSpeak()) {
      // 沒有英文台詞或瀏覽器不支援語音：照估計時間播放動作與字幕
      timersRef.current.push(window.setTimeout(finish, estimateMs));
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    const rv = roleVoices[cue.line.speakerSlotId];
    if (rv?.voice) u.voice = rv.voice;
    u.lang = rv?.voice?.lang ?? 'en-US';
    u.pitch = rv?.pitch ?? 1;
    u.rate = 0.9 * speed;
    u.onend = finish;
    u.onerror = finish;
    window.speechSynthesis.speak(u);
    // 保險：部分瀏覽器偶爾不觸發 onend，超過估計時間兩倍就視為播完
    timersRef.current.push(window.setTimeout(finish, estimateMs * 2 + 3000));
  }, [cues, roleVoices, speed, setSpeaker, playGesture, stopAudio]);
  useEffect(() => { playCueRef.current = playCue; }, [playCue]);

  const pause = () => { stopAudio(); setStatus('paused'); };
  const togglePlay = () => {
    if (status === 'playing') pause();
    else playCue(status === 'ended' ? 0 : index);
  };
  const jump = (i: number) => {
    const target = Math.max(0, Math.min(cues.length - 1, i));
    if (status === 'playing') playCue(target);
    else { stopAudio(); setIndex(target); setStatus('idle'); }
  };

  // 鍵盤：空白鍵播放 / 暫停、左右鍵換句、Esc 關閉
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      // 焦點在按鈕 / 表單元件時交給元件本身（避免空白鍵同時觸發按鈕點擊）
      if ((e.target as HTMLElement)?.closest('button, select, input, textarea')) return;
      if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowRight') jump(index + 1);
      else if (e.key === 'ArrowLeft') jump(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // 目前這句捲到清單可視範圍
  useEffect(() => {
    listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [index]);

  const current = cues[index];
  const slotOf = (id: string) => {
    const i = slots.findIndex(s => s.id === id);
    return { slot: slots[i], color: SPEAKER_COLORS[(i < 0 ? 0 : i) % SPEAKER_COLORS.length] };
  };
  const speakerInfo = current ? slotOf(current.line.speakerSlotId) : null;
  const showSubtitle = current && (status === 'playing' || status === 'paused' || status === 'idle');

  return (
    <div className="ss-screen" role="dialog" aria-modal="true" aria-label="劇本模擬器">
      <header className="ss-top">
        <div className="ss-title">
          <span className="ss-title-icon material-symbols-outlined" aria-hidden="true">theaters</span>
          <span className="ss-title-main">劇本模擬器</span>
          <span className="ss-title-task">{task.title || '未命名任務'}</span>
        </div>
        <button className="ss-icon-btn" onClick={onClose} aria-label="關閉模擬器">
          <span className="material-symbols-outlined">close</span>
        </button>
      </header>

      <div className="ss-body">
        <section className="ss-stage-wrap">
          <div className="ss-stage">
            {preset?.backgroundType === 'video' && preset.backgroundValue && (
              <video className="ss-bg" src={preset.backgroundValue} autoPlay muted loop playsInline />
            )}
            {preset?.backgroundType === 'image' && preset.backgroundValue && (
              <img className="ss-bg" src={preset.backgroundValue} alt="" />
            )}
            <canvas ref={canvasRef} className="ss-canvas" />

            {!stage.ready && !stage.error && (
              <div className="ss-overlay">
                <div className="gradient-spinner" />
                <p>載入角色中… {Math.round(stage.progress * 100)}%</p>
              </div>
            )}
            {stage.error && <div className="ss-overlay ss-overlay-error">{stage.error}</div>}

            {stage.ready && showSubtitle && speakerInfo && (
              <div className="ss-subtitle" style={{ ['--speaker' as string]: speakerInfo.color }}>
                <span className="ss-sub-speaker">{speakerInfo.slot?.label ?? current.line.speakerSlotId}</span>
                <span className="ss-sub-en">{current.line.en || '（尚未填寫英文台詞）'}</span>
                {showZh && current.line.zh && <span className="ss-sub-zh">{current.line.zh}</span>}
              </div>
            )}
            {stage.ready && status === 'ended' && (
              <div className="ss-overlay ss-overlay-soft">
                <p>劇本播放完畢</p>
                <button className="ss-btn-primary" onClick={() => playCue(0)}>
                  <span className="material-symbols-outlined" aria-hidden="true">replay</span>從頭播放
                </button>
              </div>
            )}
          </div>

          <div className="ss-controls">
            <button className="ss-ctrl" onClick={() => jump(index - 1)} disabled={index <= 0} aria-label="上一句">
              <span className="material-symbols-outlined">skip_previous</span>
            </button>
            <button className="ss-ctrl ss-ctrl-main" onClick={togglePlay} disabled={!stage.ready || cues.length === 0} aria-label={status === 'playing' ? '暫停' : '播放'}>
              <span className="material-symbols-outlined">{status === 'playing' ? 'pause' : 'play_arrow'}</span>
            </button>
            <button className="ss-ctrl" onClick={() => jump(index + 1)} disabled={index >= cues.length - 1} aria-label="下一句">
              <span className="material-symbols-outlined">skip_next</span>
            </button>
            <span className="ss-counter">{cues.length ? index + 1 : 0} / {cues.length}</span>
            <div className="ss-ctrl-right">
              <label className="ss-toggle">
                <input type="checkbox" checked={showZh} onChange={e => setShowZh(e.target.checked)} />中文字幕
              </label>
              <label className="ss-speed">
                速度
                <select value={speed} onChange={e => setSpeed(Number(e.target.value))}>
                  {SPEEDS.map(s => <option key={s} value={s}>{s}×</option>)}
                </select>
              </label>
            </div>
          </div>
          {!canSpeak() && <p className="ss-note">此瀏覽器不支援語音合成，將只播放動作與字幕。</p>}
        </section>

        <aside className="ss-script" aria-label="劇本">
          {cues.length === 0 && <p className="ss-empty">這份任務還沒有台詞。</p>}
          <ol className="ss-steps" ref={listRef}>
            {task.steps.map((step, si) => {
              const stepCues = cues.filter(c => c.stepIndex === si);
              return (
                <li key={step.id} className="ss-step">
                  <div className="ss-step-head">
                    <span className="ss-step-num">{si + 1}</span>
                    <span className="ss-step-title">{step.title || '未命名步驟'}</span>
                    {step.purpose && <span className="ss-step-purpose">{step.purpose}</span>}
                  </div>
                  <ul className="ss-lines">
                    {stepCues.length === 0 && <li className="ss-line-empty">（沒有台詞）</li>}
                    {stepCues.map(c => {
                      const { slot, color } = slotOf(c.line.speakerSlotId);
                      const active = c.index === index;
                      const g = gestureById(c.line.gesture);
                      return (
                        <li key={c.line.id}>
                          <button
                            className={`ss-line${active ? ' is-active' : ''}${active && status === 'playing' ? ' is-playing' : ''}`}
                            style={{ ['--speaker' as string]: color }}
                            aria-current={active ? 'true' : undefined}
                            onClick={() => jump(c.index)}
                          >
                            <span className="ss-line-speaker">
                              {slot?.icon ?? '🙂'} {slot?.label ?? c.line.speakerSlotId}
                              {g && <span className="ss-line-gesture" title={`動作：${g.label}`}>{g.icon} {g.label}</span>}
                            </span>
                            <span className="ss-line-en">{c.line.en || '（尚未填寫）'}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ol>
        </aside>
      </div>
    </div>
  );
}
