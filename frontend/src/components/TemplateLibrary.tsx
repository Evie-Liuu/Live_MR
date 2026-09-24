import { useEffect, useMemo, useRef, useState } from 'react';
import { THEMES } from '../config/scenes.ts';
import { TASK_TEMPLATES, type TaskTemplate } from '../config/taskTemplates/index.ts';
import { CEFR_LEVELS, levelLabel } from '../types/lessonPlan.ts';
import { formatClock, stepTimings } from '../types/dialogueTask.ts';
import './TemplateLibrary.css';

interface TemplateLibraryProps {
  onApply: (template: TaskTemplate) => void;
  onClose: () => void;
}

const SCENE_INFO = new Map(
  THEMES.flatMap(t => t.scenes.map(s => [s.id, {
    label: `${t.label}／${s.label}`,
    slots: new Map((s.slots ?? []).map((sl, i) => [sl.id, { label: sl.label, icon: sl.icon, index: i }])),
  }] as const)),
);

/** 與任務編輯器相同的角色輪替色 */
const SPEAKER_COLORS = ['#2BB5A8', '#8B6FD9', '#F59E0B', '#3B82F6'];

function totalSeconds(t: TaskTemplate) {
  return t.task.steps.reduce((sum, s) => sum + stepTimings(s.lines).total, 0);
}

function canSpeak() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export default function TemplateLibrary({ onApply, onClose }: TemplateLibraryProps) {
  const [sceneId, setSceneId] = useState('');
  const [level, setLevel] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>(TASK_TEMPLATES[0]?.id ?? '');
  const [stepIdx, setStepIdx] = useState(0);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // 只列出有模板的場景
  const sceneOptions = useMemo(
    () => [...new Set(TASK_TEMPLATES.map(t => t.task.sceneId))].map(id => ({ id, label: SCENE_INFO.get(id)?.label ?? id })),
    [],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TASK_TEMPLATES.filter(t =>
      (!sceneId || t.task.sceneId === sceneId) &&
      (!level || t.task.level === level) &&
      (!q || [t.name, t.description, ...t.tags].some(x => x.toLowerCase().includes(q))),
    );
  }, [sceneId, level, query]);

  const selected = filtered.find(t => t.id === selectedId) ?? filtered[0];
  const step = selected?.task.steps[Math.min(stepIdx, selected.task.steps.length - 1)];
  const slots = selected ? SCENE_INFO.get(selected.task.sceneId)?.slots : undefined;

  useEffect(() => { dialogRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => () => { if (canSpeak()) window.speechSynthesis.cancel(); }, []);

  const select = (id: string) => {
    setSelectedId(id);
    setStepIdx(0);
    if (canSpeak()) window.speechSynthesis.cancel();
    setSpeakingId(null);
  };

  const speak = (id: string, text: string) => {
    if (!canSpeak()) return;
    window.speechSynthesis.cancel();
    if (speakingId === id) { setSpeakingId(null); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.9;
    u.onend = () => setSpeakingId(cur => (cur === id ? null : cur));
    u.onerror = u.onend;
    setSpeakingId(id);
    window.speechSynthesis.speak(u);
  };

  return (
    <div className="tl-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tl-dialog" role="dialog" aria-modal="true" aria-labelledby="tl-title" tabIndex={-1} ref={dialogRef}>
        <header className="tl-head">
          <h2 id="tl-title">
            <span className="tl-head-icon material-symbols-outlined" aria-hidden="true">inventory_2</span>任務庫
          </h2>
          <button className="tl-close" onClick={onClose} aria-label="關閉任務庫">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <div className="tl-filters">
          <select value={sceneId} onChange={e => setSceneId(e.target.value)} aria-label="篩選場景">
            <option value="">全部場景</option>
            {sceneOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <select value={level} onChange={e => setLevel(e.target.value)} aria-label="篩選程度">
            <option value="">全部程度</option>
            {CEFR_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          <label className="tl-search">
            <span className="material-symbols-outlined" aria-hidden="true">search</span>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋模板名稱或標籤" aria-label="搜尋模板" />
          </label>
        </div>

        <div className="tl-body">
          <ul className="tl-cards" aria-label="模板清單">
            {filtered.length === 0 && <li className="tl-empty">沒有符合條件的模板</li>}
            {filtered.map(t => (
              <li key={t.id}>
                <button
                  className={`tl-card${t.id === selected?.id ? ' is-selected' : ''}`}
                  onClick={() => select(t.id)}
                  aria-pressed={t.id === selected?.id}
                >
                  <span className="tl-card-name">{t.name}</span>
                  <span className="tl-card-desc">{t.description}</span>
                  <span className="tl-card-meta">
                    <span className="tl-level">{levelLabel(t.task.level, true)}</span>
                    {t.task.steps.length} 個步驟・約 {formatClock(totalSeconds(t))}
                  </span>
                  <span className="tl-tags">{t.tags.map(tag => <span key={tag}>#{tag}</span>)}</span>
                </button>
              </li>
            ))}
          </ul>

          {selected && step && (
            <section className="tl-preview" aria-label={`${selected.name} 預覽`}>
              <p className="tl-preview-scene">{SCENE_INFO.get(selected.task.sceneId)?.label}</p>
              <ol className="tl-steps">
                {selected.task.steps.map((s, i) => (
                  <li key={s.id}>
                    <button className={`tl-step${s.id === step.id ? ' is-active' : ''}`} onClick={() => setStepIdx(i)}>
                      <span className="tl-step-num">{i + 1}</span>{s.title}
                    </button>
                  </li>
                ))}
              </ol>

              <div className="tl-step-head">
                <strong>{step.title}</strong>
                {step.purpose && <span className="tl-purpose">{step.purpose}</span>}
              </div>
              <ul className="tl-lines">
                {step.lines.map(l => {
                  const slot = slots?.get(l.speakerSlotId);
                  const color = SPEAKER_COLORS[(slot?.index ?? 0) % SPEAKER_COLORS.length];
                  const lineKey = `${selected.id}:${l.id}`;
                  return (
                    <li key={l.id} className="tl-line" style={{ ['--speaker' as string]: color }}>
                      <span className="tl-avatar" aria-hidden="true">{slot?.icon ?? '🙂'}</span>
                      <div className="tl-bubble">
                        <span className="tl-speaker">{slot?.label ?? l.speakerSlotId}</span>
                        <span className="tl-en">{l.en}</span>
                        <span className="tl-zh">{l.zh}</span>
                      </div>
                      {canSpeak() && (
                        <button
                          className={`tl-speak${speakingId === lineKey ? ' is-speaking' : ''}`}
                          onClick={() => speak(lineKey, l.en)}
                          aria-label={speakingId === lineKey ? '停止播放' : '播放英文台詞'}
                        >
                          <span className="material-symbols-outlined">{speakingId === lineKey ? 'stop' : 'volume_up'}</span>
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {step.grammarPoints.length > 0 && (
                <p className="tl-grammar"><span className="material-symbols-outlined" aria-hidden="true">menu_book</span>{step.grammarPoints.join('　／　')}</p>
              )}
            </section>
          )}
        </div>

        <footer className="tl-foot">
          <span className="tl-foot-hint">套用後會開啟任務編輯器，可自由修改，按儲存才會加入「我的任務」。</span>
          <button className="tl-btn-ghost" onClick={onClose}>取消</button>
          <button className="tl-btn-apply" onClick={() => selected && onApply(selected)} disabled={!selected}>
            <span className="material-symbols-outlined" aria-hidden="true">check</span>套用此模板
          </button>
        </footer>
      </div>
    </div>
  );
}
