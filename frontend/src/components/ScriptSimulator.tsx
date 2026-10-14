import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SCENE_PRESETS, THEMES } from '../config/scenes.ts';
import { estimateLineSeconds, formatClock, type DialogueTask } from '../types/dialogueTask.ts';
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
type PanelTab = 'script' | 'grammar' | 'notes';

const SPEEDS = [0.75, 1, 1.25] as const;
/** 句與句之間的停頓（毫秒，會依速度縮放） */
const LINE_GAP_MS = 700;
/** 與任務編輯器相同的角色輪替色 */
const SPEAKER_COLORS = ['#2BB5A8', '#8B6FD9', '#F59E0B', '#3B82F6'];
/** 播放中更新時間軸的間隔（毫秒） */
const TICK_MS = 200;

const PANEL_TABS: { id: PanelTab; label: string; icon: string }[] = [
  { id: 'script', label: '對話劇本', icon: 'forum' },
  { id: 'grammar', label: '語法說明', icon: 'menu_book' },
  { id: 'notes', label: '教學注意點', icon: 'lightbulb' },
];

function canSpeak() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** 時間軸上的秒數取整後顯示 mm:ss */
const clock = (sec: number) => formatClock(Math.max(0, Math.round(sec)));

export default function ScriptSimulator({ task, startStepIndex = 0, onClose }: ScriptSimulatorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const stage = useScriptStage(canvasRef, task.sceneId);
  const { setSpeaker, playGesture } = stage;
  const cues = useMemo(() => flattenCues(task), [task]);
  const preset = SCENE_PRESETS[task.sceneId];
  const theme = useMemo(() => THEMES.find(t => t.scenes.some(s => s.id === task.sceneId)), [task.sceneId]);
  const slots = useMemo(
    () => THEMES.flatMap(t => t.scenes).find(s => s.id === task.sceneId)?.slots ?? [],
    [task.sceneId],
  );

  // 時間軸（以 1× 速度估算）：每句的起點秒數與長度
  const timeline = useMemo(() => {
    const items: { start: number; duration: number }[] = [];
    let cursor = 0;
    for (const [i, c] of cues.entries()) {
      const start = i === 0 ? 0 : cursor + LINE_GAP_MS / 1000;
      const duration = estimateLineSeconds(c.line.en);
      items.push({ start, duration });
      cursor = start + duration;
    }
    return { items, total: cursor };
  }, [cues]);
  const chapters = useMemo(() => task.steps.map((step, si) => {
    const stepCues = cues.filter(c => c.stepIndex === si);
    const first = stepCues[0];
    const last = stepCues[stepCues.length - 1];
    return {
      step,
      stepIndex: si,
      firstCue: first?.index ?? -1,
      start: first ? timeline.items[first.index].start : null,
      end: last ? timeline.items[last.index].start + timeline.items[last.index].duration : null,
    };
  }), [task.steps, cues, timeline]);

  const [index, setIndex] = useState(() => Math.max(0, firstCueOfStep(cues, startStepIndex)));
  const [status, setStatus] = useState<Status>('idle');
  const [speed, setSpeed] = useState<number>(1);
  const [muted, setMuted] = useState(false);
  const [showZh, setShowZh] = useState(true);
  const [showChapters, setShowChapters] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>('script');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [roleVoices, setRoleVoices] = useState<Record<string, RoleVoice>>({});
  /** 目前這句已播放的秒數（1× 時間軸） */
  const [cueElapsed, setCueElapsed] = useState(0);

  // 每次換句 / 暫停都 +1，讓舊的 TTS 回呼與計時器失效
  const tokenRef = useRef(0);
  const timersRef = useRef<number[]>([]);
  const cueStartedAtRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const chapterWrapRef = useRef<HTMLDivElement>(null);
  const chapterBtnRef = useRef<HTMLButtonElement>(null);
  const chapterMenuRef = useRef<HTMLDivElement>(null);
  /** playCue 播完要接下一句，透過 ref 呼叫最新版本 */
  const playCueRef = useRef<(i: number) => void>(() => { });

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
    setCueElapsed(0);
    cueStartedAtRef.current = performance.now();

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
    u.volume = muted ? 0 : 1;
    u.onend = finish;
    u.onerror = finish;
    window.speechSynthesis.speak(u);
    // 保險：部分瀏覽器偶爾不觸發 onend，超過估計時間兩倍就視為播完
    timersRef.current.push(window.setTimeout(finish, estimateMs * 2 + 3000));
  }, [cues, roleVoices, speed, muted, setSpeaker, playGesture, stopAudio]);
  useEffect(() => { playCueRef.current = playCue; }, [playCue]);

  // 播放中推進時間軸（不超過這句的估計長度）
  useEffect(() => {
    if (status !== 'playing') return;
    const duration = timeline.items[index]?.duration ?? 0;
    const id = window.setInterval(() => {
      const sec = ((performance.now() - cueStartedAtRef.current) / 1000) * speed;
      setCueElapsed(Math.min(sec, duration));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [status, index, speed, timeline]);

  const pause = () => { stopAudio(); setStatus('paused'); setCueElapsed(0); };
  const togglePlay = () => {
    if (status === 'playing') pause();
    else playCue(status === 'ended' ? 0 : index);
  };
  const jump = (i: number) => {
    const target = Math.max(0, Math.min(cues.length - 1, i));
    if (status === 'playing') playCue(target);
    else { stopAudio(); setIndex(target); setStatus('idle'); setCueElapsed(0); }
  };
  /** 右側清單的播放鈕：播放中的那句再按一次就暫停 */
  const playLine = (i: number) => {
    if (status === 'playing' && i === index) pause();
    else playCue(i);
  };
  /** 拖曳進度條：跳到該時間點所在的那一句 */
  const seek = (sec: number) => {
    let target = 0;
    timeline.items.forEach((item, i) => { if (item.start <= sec) target = i; });
    jump(target);
  };

  // 全螢幕只放大播放器（舞台＋控制列）
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === playerRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void playerRef.current?.requestFullscreen?.();
  };

  const closeChapterMenu = () => {
    setShowChapters(false);
    chapterBtnRef.current?.focus();
  };
  const pickChapter = (cueIndex: number) => {
    jump(cueIndex);
    closeChapterMenu();
  };

  // 章節選單：開啟時聚焦目前章節；點選單外面就關閉
  useEffect(() => {
    if (!showChapters) return;
    const menu = chapterMenuRef.current;
    const target = menu?.querySelector<HTMLButtonElement>('[aria-current="step"]:not(:disabled)')
      ?? menu?.querySelector<HTMLButtonElement>('button:not(:disabled)');
    target?.focus();
    const onDown = (e: PointerEvent) => {
      if (!chapterWrapRef.current?.contains(e.target as Node)) setShowChapters(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [showChapters]);
  /** 選單內上下鍵移動焦點 */
  const onChapterMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const items = [...(chapterMenuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'Home' ? 0
      : e.key === 'End' ? items.length - 1
        : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };

  // 鍵盤：空白鍵播放 / 暫停、左右鍵換句、Esc 關閉（全螢幕時 Esc 由瀏覽器先退出全螢幕）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showChapters) closeChapterMenu();
        else if (!document.fullscreenElement) onClose();
        return;
      }
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
  }, [index, panelTab]);

  const current = cues[index];
  const slotOf = (id: string) => {
    const i = slots.findIndex(s => s.id === id);
    return { slot: slots[i], color: SPEAKER_COLORS[(i < 0 ? 0 : i) % SPEAKER_COLORS.length] };
  };
  const speakerInfo = current ? slotOf(current.line.speakerSlotId) : null;
  const showSubtitle = current && status !== 'ended';
  const currentStepIndex = current?.stepIndex ?? -1;

  // 對話劇本：各階段可收合台詞；播放到被收合的階段時自動展開
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const currentStepId = task.steps[currentStepIndex]?.id;
  const [expandedFor, setExpandedFor] = useState(currentStepId);
  if (expandedFor !== currentStepId) {
    setExpandedFor(currentStepId);
    if (currentStepId && collapsed.has(currentStepId)) {
      setCollapsed(prev => { const next = new Set(prev); next.delete(currentStepId); return next; });
    }
  }
  const toggleStep = (stepId: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(stepId)) next.delete(stepId); else next.add(stepId);
    return next;
  });
  const allCollapsed = task.steps.length > 0 && task.steps.every(s => collapsed.has(s.id));
  const toggleAllSteps = () => setCollapsed(allCollapsed ? new Set() : new Set(task.steps.map(s => s.id)));
  const currentTime = status === 'ended'
    ? timeline.total
    : (timeline.items[index]?.start ?? 0) + cueElapsed;
  const progressPct = timeline.total > 0 ? Math.min(100, (currentTime / timeline.total) * 100) : 0;

  return (
    <div className="ss-screen" role="dialog" aria-modal="true" aria-label="劇本模擬器">
      <div className="ss-body">
        <section className="ss-main">
          <div className={`ss-player${isFullscreen ? ' is-fullscreen' : ''}`} ref={playerRef}>
            <div className="ss-stage">
              {preset?.backgroundType === 'video' && preset.backgroundValue && (
                <video className="ss-bg" src={preset.backgroundValue} autoPlay muted loop playsInline />
              )}
              {preset?.backgroundType === 'image' && preset.backgroundValue && (
                <img className="ss-bg" src={preset.backgroundValue} alt="" />
              )}
              <canvas ref={canvasRef} className="ss-canvas" />

              {/* 左上：標題 */}
              <div className="ss-title">
                <span className="ss-title-icon material-symbols-outlined" aria-hidden="true">theaters</span>
                <span className="ss-title-main">
                  {theme?.label ? `${theme.label}・` : ''}{task.title || '未命名任務'}
                </span>
                <span className="ss-title-badge">模擬播放</span>
              </div>

              {/* 右上：關閉 */}
              <div className="ss-toolbar">
                <button className="ss-tool ss-tool-icon" onClick={onClose} aria-label="關閉模擬器" title="關閉（Esc）">
                  <span className="material-symbols-outlined" aria-hidden="true">close</span>
                </button>
              </div>

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

            {/* 播放控制列 */}
            <div className="ss-controls">
              <button className="ss-ctrl" onClick={() => jump(index - 1)} disabled={index <= 0} aria-label="上一句" title="上一句（←）">
                <span className="material-symbols-outlined">skip_previous</span>
              </button>
              <button
                className="ss-ctrl ss-ctrl-main"
                onClick={togglePlay}
                disabled={!stage.ready || cues.length === 0}
                aria-label={status === 'playing' ? '暫停' : '播放'}
                title="播放 / 暫停（空白鍵）"
              >
                <span className="material-symbols-outlined">{status === 'playing' ? 'pause' : 'play_arrow'}</span>
              </button>
              <button className="ss-ctrl" onClick={() => jump(index + 1)} disabled={index >= cues.length - 1} aria-label="下一句" title="下一句（→）">
                <span className="material-symbols-outlined">skip_next</span>
              </button>
              <span className="ss-time">{clock(currentTime)} / {clock(timeline.total)}</span>
              <input
                className="ss-progress"
                type="range"
                min={0}
                max={Math.max(timeline.total, 0.1)}
                step={0.1}
                value={currentTime}
                onChange={e => seek(Number(e.target.value))}
                disabled={cues.length === 0}
                aria-label="播放進度"
                style={{ ['--pct' as string]: `${progressPct}%` }}
              />
              <div className="ss-chapter-wrap" ref={chapterWrapRef}>
                <button
                  ref={chapterBtnRef}
                  className={`ss-ctrl ss-ctrl-text${showChapters ? ' is-on' : ''}`}
                  onClick={() => setShowChapters(v => !v)}
                  aria-haspopup="menu"
                  aria-expanded={showChapters}
                  aria-controls="ss-chapter-menu"
                  title="選擇章節"
                >
                  <span className="material-symbols-outlined" aria-hidden="true">video_library</span>章節
                </button>
                {showChapters && (
                  <div
                    className="ss-chapter-menu"
                    id="ss-chapter-menu"
                    role="menu"
                    aria-label="章節"
                    ref={chapterMenuRef}
                    onKeyDown={onChapterMenuKey}
                  >
                    <div className="ss-chapter-menu-head" aria-hidden="true">章節</div>
                    {chapters.map(ch => (
                      <button
                        key={ch.step.id}
                        role="menuitem"
                        className={`ss-chapter${ch.stepIndex === currentStepIndex ? ' is-active' : ''}`}
                        onClick={() => pickChapter(ch.firstCue)}
                        disabled={ch.firstCue < 0}
                        aria-current={ch.stepIndex === currentStepIndex ? 'step' : undefined}
                      >
                        <span className="ss-chapter-num">{ch.stepIndex + 1}</span>
                        <span className="ss-chapter-title">{ch.step.title || '未命名步驟'}</span>
                        <span className="ss-chapter-time">
                          {ch.start === null || ch.end === null ? '沒有台詞' : `${clock(ch.start)} - ${clock(ch.end)}`}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                className={`ss-ctrl ss-ctrl-text${showZh ? ' is-on' : ''}`}
                onClick={() => setShowZh(v => !v)}
                aria-pressed={showZh}
                title={showZh ? '隱藏中文字幕' : '顯示中文字幕'}
              >
                <span className="material-symbols-outlined" aria-hidden="true">subtitles</span>中文字幕
              </button>
              <label className="ss-speed">
                <span className="sr-only">速度</span>
                <select value={speed} onChange={e => setSpeed(Number(e.target.value))} aria-label="播放速度">
                  {SPEEDS.map(s => <option key={s} value={s}>{s}x</option>)}
                </select>
              </label>
              <button className={`ss-ctrl${muted ? ' is-muted' : ''}`} onClick={() => setMuted(v => !v)} aria-pressed={muted} aria-label={muted ? '取消靜音' : '靜音'} title={muted ? '取消靜音' : '靜音'}>
                <span className="material-symbols-outlined">{muted ? 'volume_off' : 'volume_up'}</span>
              </button>
              <button className="ss-ctrl" onClick={toggleFullscreen} aria-label={isFullscreen ? '離開全螢幕' : '全螢幕'} title={isFullscreen ? '離開全螢幕' : '全螢幕'}>
                <span className="material-symbols-outlined">{isFullscreen ? 'fullscreen_exit' : 'fullscreen'}</span>
              </button>
            </div>
          </div>

          {!canSpeak() && <p className="ss-note">此瀏覽器不支援語音合成，將只播放動作與字幕。</p>}
        </section>

        <aside className="ss-panel" aria-label="劇本資訊">
          <div className="ss-tabs" role="tablist">
            {PANEL_TABS.map(t => (
              <button
                key={t.id}
                role="tab"
                aria-selected={panelTab === t.id}
                className={`ss-tab${panelTab === t.id ? ' is-active' : ''}`}
                onClick={() => setPanelTab(t.id)}
              >
                <span className="material-symbols-outlined" aria-hidden="true">{t.icon}</span>{t.label}
              </button>
            ))}
          </div>

          <div className="ss-panel-body" ref={listRef} role="tabpanel">
            {panelTab === 'script' && (
              cues.length === 0 ? <p className="ss-empty">這份任務還沒有台詞。</p> : <>
              <div className="ss-script-bar">
                <button className="ss-script-bar-btn" onClick={toggleAllSteps}>
                  <span className="material-symbols-outlined" aria-hidden="true">{allCollapsed ? 'unfold_more' : 'unfold_less'}</span>
                  {allCollapsed ? '全部展開' : '全部收合'}
                </button>
              </div>
              {chapters.map(ch => {
                const stepCues = cues.filter(c => c.stepIndex === ch.stepIndex);
                const open = !collapsed.has(ch.step.id);
                const linesId = `ss-lines-${ch.step.id}`;
                return (
                  <section key={ch.step.id} className={`ss-step${ch.stepIndex === currentStepIndex ? ' is-current' : ''}${open ? '' : ' is-collapsed'}`}>
                    <button
                      className="ss-step-head ss-step-toggle"
                      onClick={() => toggleStep(ch.step.id)}
                      aria-expanded={open}
                      aria-controls={linesId}
                    >
                      <span className="ss-step-num">{ch.stepIndex + 1}</span>
                      <span className="ss-step-title">{ch.step.title || '未命名步驟'}</span>
                      {ch.step.purpose && <span className="ss-step-purpose">{ch.step.purpose}</span>}
                      <span className="ss-step-count">{stepCues.length} 句</span>
                      <span className="ss-step-chevron material-symbols-outlined" aria-hidden="true">expand_more</span>
                    </button>
                    <ol className="ss-lines" id={linesId} hidden={!open}>
                      {stepCues.length === 0 && <li className="ss-line-empty">（沒有台詞）</li>}
                      {stepCues.map(c => {
                        const { slot, color } = slotOf(c.line.speakerSlotId);
                        const active = c.index === index;
                        const playing = active && status === 'playing';
                        const g = gestureById(c.line.gesture);
                        return (
                          <li
                            key={c.line.id}
                            className={`ss-line${active ? ' is-active' : ''}${playing ? ' is-playing' : ''}`}
                            style={{ ['--speaker' as string]: color }}
                            aria-current={active ? 'true' : undefined}
                          >
                            <span className="ss-line-num">{c.index + 1}</span>
                            <span className="ss-line-avatar" aria-hidden="true">{slot?.icon ?? '🙂'}</span>
                            <button className="ss-line-body" onClick={() => jump(c.index)} title="跳到這一句">
                              <span className="ss-line-speaker">
                                {slot?.label ?? c.line.speakerSlotId}
                                {g && <span className="ss-line-gesture" title={`動作：${g.label}`}>{g.icon} {g.label}</span>}
                              </span>
                              <span className="ss-line-en">{c.line.en || '（尚未填寫）'}</span>
                              {c.line.zh && <span className="ss-line-zh">{c.line.zh}</span>}
                            </button>
                            <button
                              className="ss-line-play"
                              onClick={() => playLine(c.index)}
                              disabled={!stage.ready}
                              aria-label={playing ? '暫停這一句' : '播放這一句'}
                            >
                              <span className="material-symbols-outlined" aria-hidden="true">{playing ? 'pause' : 'play_arrow'}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                );
              })}
              </>
            )}

            {panelTab === 'grammar' && task.steps.map((step, si) => (
              <section key={step.id} className={`ss-info${si === currentStepIndex ? ' is-current' : ''}`}>
                <div className="ss-step-head">
                  <span className="ss-step-num">{si + 1}</span>
                  <span className="ss-step-title">{step.title || '未命名步驟'}</span>
                </div>
                {step.grammarPoints.filter(Boolean).length > 0 && (
                  <div className="ss-info-chips">
                    {step.grammarPoints.filter(Boolean).map(p => <span key={p} className="ss-info-chip">{p}</span>)}
                  </div>
                )}
                {step.grammarNote.trim()
                  ? <p className="ss-info-text">{step.grammarNote}</p>
                  : step.grammarPoints.filter(Boolean).length === 0 && <p className="ss-info-empty">尚未填寫語法說明</p>}
              </section>
            ))}

            {panelTab === 'notes' && task.steps.map((step, si) => (
              <section key={step.id} className={`ss-info${si === currentStepIndex ? ' is-current' : ''}`}>
                <div className="ss-step-head">
                  <span className="ss-step-num">{si + 1}</span>
                  <span className="ss-step-title">{step.title || '未命名步驟'}</span>
                </div>
                {step.teachingNotes.filter(n => n.trim()).length > 0 ? (
                  <ul className="ss-info-list">
                    {step.teachingNotes.filter(n => n.trim()).map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                ) : <p className="ss-info-empty">尚未填寫教學注意點</p>}
              </section>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
