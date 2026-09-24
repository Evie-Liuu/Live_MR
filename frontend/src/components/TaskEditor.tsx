import { useCallback, useEffect, useMemo, useState } from 'react';
import { THEMES } from '../config/scenes.ts';
import { CEFR_LEVELS, type CefrLevel } from '../types/lessonPlan.ts';
import {
  blankTask, cloneStep, formatClock, newLine, newStep, stepTimings,
  type DialogueLine, type DialogueStep, type DialogueTask, type DialogueTaskRecord,
} from '../types/dialogueTask.ts';
import { createDialogueTask, dialogueTaskErrorText, updateDialogueTask } from '../utils/dialogueTaskClient.ts';
import './TaskEditor.css';

interface TaskEditorProps {
  teacherUid: string;
  institutionId?: string;
  /** null = 新建空白任務（第一次儲存才寫入資料庫） */
  initial: DialogueTaskRecord | null;
  onSaved: (record: DialogueTaskRecord) => void;
  onClose: () => void;
}

type Tab = 'dialogue' | 'grammar' | 'notes';

interface SlotOption { id: string; label: string; icon?: string }

const SCENES = THEMES.flatMap(t => t.scenes.map(s => ({
  id: s.id,
  label: `${t.label}／${s.label}`,
  slots: (s.slots ?? []).map(sl => ({ id: sl.id, label: sl.label, icon: sl.icon })) as SlotOption[],
})));

/** 流程步驟編號輪替色 */
const STEP_COLORS = ['#F76E12', '#00A99D', '#E5484D', '#3B82F6', '#65A30D'];
/** 角色（依場景 slot 順序）輪替色：頭像底色 / 對話框底色 / 對話框邊框 */
const SPEAKER_THEMES = [
  { avatar: '#2BB5A8', bubble: '#EEF9F8', border: '#BFE7E3' },
  { avatar: '#8B6FD9', bubble: '#F4F0FE', border: '#DCD1FA' },
  { avatar: '#F59E0B', bubble: '#FFF7E8', border: '#FBE0AE' },
  { avatar: '#3B82F6', bubble: '#EFF5FF', border: '#C9DCFB' },
];

function stepColor(i: number) { return STEP_COLORS[i % STEP_COLORS.length]; }

function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function canSpeak() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export default function TaskEditor({ teacherUid, institutionId, initial, onSaved, onClose }: TaskEditorProps) {
  const [task, setTask] = useState<DialogueTask>(() => {
    if (initial) return initial.task;
    const scene = SCENES[0];
    return blankTask(scene?.id ?? '', scene?.slots.map(s => s.id) ?? []);
  });
  const [recordId, setRecordId] = useState<string | null>(initial?.id ?? null);
  const [activeStepId, setActiveStepId] = useState<string>(() => task.steps[0]?.id ?? '');
  const [tab, setTab] = useState<Tab>('dialogue');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [speakingLineId, setSpeakingLineId] = useState<string | null>(null);

  const scene = SCENES.find(s => s.id === task.sceneId);
  const slots = useMemo(() => scene?.slots ?? [], [scene]);
  const activeIndex = Math.max(0, task.steps.findIndex(s => s.id === activeStepId));
  const step: DialogueStep | undefined = task.steps[activeIndex];
  const timings = useMemo(() => stepTimings(step?.lines ?? []), [step]);

  const edit = useCallback((fn: (t: DialogueTask) => DialogueTask) => {
    setTask(fn);
    setDirty(true);
    setSavedFlash(false);
  }, []);

  const editStep = useCallback((id: string, fn: (s: DialogueStep) => DialogueStep) => {
    edit(t => ({ ...t, steps: t.steps.map(s => (s.id === id ? fn(s) : s)) }));
  }, [edit]);

  const editLine = (lineId: string, patch: Partial<DialogueLine>) => {
    if (!step) return;
    editStep(step.id, s => ({ ...s, lines: s.lines.map(l => (l.id === lineId ? { ...l, ...patch } : l)) }));
  };

  // ── 步驟操作 ──────────────────────────────────────────────────────────────
  const addStep = () => {
    const created = newStep('', slots.map(s => s.id));
    edit(t => {
      const steps = [...t.steps];
      steps.splice(activeIndex + 1, 0, created);
      return { ...t, steps };
    });
    setActiveStepId(created.id);
    setTab('dialogue');
  };

  const duplicateStep = () => {
    if (!step) return;
    const copy = cloneStep(step);
    edit(t => {
      const steps = [...t.steps];
      steps.splice(activeIndex + 1, 0, copy);
      return { ...t, steps };
    });
    setActiveStepId(copy.id);
  };

  const deleteStep = () => {
    if (!step || task.steps.length <= 1) return;
    const fallback = task.steps[activeIndex + 1] ?? task.steps[activeIndex - 1];
    edit(t => ({ ...t, steps: t.steps.filter(s => s.id !== step.id) }));
    setActiveStepId(fallback.id);
  };

  const moveStep = (delta: number) => {
    edit(t => ({ ...t, steps: moveItem(t.steps, activeIndex, activeIndex + delta) }));
  };

  // ── 台詞操作 ──────────────────────────────────────────────────────────────
  const addLine = () => {
    if (!step) return;
    // 預設換下一個角色說話，模擬一來一往
    const last = step.lines[step.lines.length - 1];
    const lastIdx = last ? slots.findIndex(s => s.id === last.speakerSlotId) : -1;
    const speaker = slots.length ? slots[(lastIdx + 1) % slots.length].id : '';
    editStep(step.id, s => ({ ...s, lines: [...s.lines, newLine(speaker)] }));
  };

  const removeLine = (lineId: string) => {
    if (!step) return;
    editStep(step.id, s => ({ ...s, lines: s.lines.filter(l => l.id !== lineId) }));
  };

  const moveLine = (index: number, delta: number) => {
    if (!step) return;
    editStep(step.id, s => ({ ...s, lines: moveItem(s.lines, index, index + delta) }));
  };

  // ── 語音播放（瀏覽器內建 TTS）────────────────────────────────────────────
  const speak = (line: DialogueLine) => {
    if (!canSpeak()) return;
    window.speechSynthesis.cancel();
    if (speakingLineId === line.id || !line.en.trim()) { setSpeakingLineId(null); return; }
    const u = new SpeechSynthesisUtterance(line.en);
    u.lang = 'en-US';
    u.rate = 0.9;
    u.onend = () => setSpeakingLineId(id => (id === line.id ? null : id));
    u.onerror = u.onend;
    setSpeakingLineId(line.id);
    window.speechSynthesis.speak(u);
  };

  useEffect(() => () => { if (canSpeak()) window.speechSynthesis.cancel(); }, []);

  // ── 儲存 / 關閉 ──────────────────────────────────────────────────────────
  /** 回傳是否儲存成功 */
  const save = useCallback(async (): Promise<boolean> => {
    if (saving) return false;
    const payload: DialogueTask = { ...task, title: task.title.trim() || '未命名任務' };
    setSaving(true);
    setError(null);
    try {
      const rec = recordId
        ? await updateDialogueTask(recordId, payload)
        : await createDialogueTask({ teacherUid, institutionId, task: payload });
      setRecordId(rec.id);
      setTask(rec.task);
      setDirty(false);
      setSavedFlash(true);
      onSaved(rec);
      return true;
    } catch (e) {
      setError(dialogueTaskErrorText(e));
      return false;
    } finally {
      setSaving(false);
    }
  }, [saving, task, recordId, teacherUid, institutionId, onSaved]);

  // Ctrl/⌘ + S 儲存
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  const requestClose = () => {
    if (dirty) setConfirmClose(true);
    else onClose();
  };

  const changeScene = (sceneId: string) => {
    const nextSlots = SCENES.find(s => s.id === sceneId)?.slots ?? [];
    // 換場景時，舊角色對不上的台詞改指派給新場景的第一個角色
    edit(t => ({
      ...t,
      sceneId,
      steps: t.steps.map(s => ({
        ...s,
        lines: s.lines.map(l => (nextSlots.some(sl => sl.id === l.speakerSlotId) ? l : { ...l, speakerSlotId: nextSlots[0]?.id ?? '' })),
      })),
    }));
  };

  return (
    <div className="te-screen">
      {/* ── 頂列 ─────────────────────────────────────────────────────────── */}
      <header className="te-topbar">
        <div className="te-brand">
          <span className="te-brand-icon material-symbols-outlined" aria-hidden="true">assignment</span>
          <span className="te-brand-title"><span className="te-orange">任務管理</span> <span className="te-teal">TASKS</span></span>
          <span className="material-symbols-outlined te-crumb-sep" aria-hidden="true">chevron_right</span>
          <span className="te-crumb">任務編輯器</span>
          <button className="te-pill-ai" disabled title="即將推出">
            <span className="material-symbols-outlined" aria-hidden="true">auto_awesome</span>AI 助教
            <span className="te-soon">即將推出</span>
          </button>
        </div>
        <div className="te-top-actions">
          <span className={`te-save-state${dirty ? ' is-dirty' : ''}`} aria-live="polite">
            {saving ? '儲存中…' : dirty ? '尚未儲存' : savedFlash ? '已儲存' : ''}
          </span>
          <button className="te-btn-outline" disabled title="即將推出">
            <span className="material-symbols-outlined te-play" aria-hidden="true">play_circle</span>預覽（學生端）
          </button>
          <button className="te-btn-save" onClick={() => { void save(); }} disabled={saving} title="儲存（Ctrl+S）">
            <span className="material-symbols-outlined" aria-hidden="true">save</span>儲存
          </button>
          <button className="te-icon-btn" onClick={requestClose} aria-label="關閉編輯器">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      </header>

      {confirmClose && (
        <div className="te-banner" role="alertdialog" aria-label="尚未儲存的變更">
          <span>有尚未儲存的變更，確定要離開嗎？</span>
          <button className="te-btn-ghost" onClick={() => setConfirmClose(false)}>繼續編輯</button>
          <button className="te-btn-danger" onClick={onClose}>放棄變更並離開</button>
          <button className="te-btn-save" onClick={async () => { if (await save()) onClose(); }}>儲存並離開</button>
        </div>
      )}
      {error && <div className="te-error" role="alert">{error}</div>}

      <div className="te-body">
        {/* ── 左欄：任務資訊 + 流程總覽 ─────────────────────────────────── */}
        <aside className="te-left">
          <section className="te-panel te-info">
            <label className="te-field">
              <span>任務名稱</span>
              <input
                value={task.title}
                maxLength={100}
                placeholder="例：服飾店購物"
                onChange={e => { const title = e.target.value; edit(t => ({ ...t, title })); }}
              />
            </label>
            <div className="te-field-row">
              <label className="te-field">
                <span>場景</span>
                <select value={task.sceneId} onChange={e => changeScene(e.target.value)}>
                  {SCENES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
              <label className="te-field te-field-level">
                <span>程度</span>
                <select value={task.level} onChange={e => { const level = e.target.value as CefrLevel; edit(t => ({ ...t, level })); }}>
                  {CEFR_LEVELS.map(l => <option key={l.value} value={l.value} title={l.label}>{l.value}</option>)}
                </select>
              </label>
            </div>
          </section>

          <section className="te-panel te-flow">
            <h2 className="te-panel-title">流程總覽</h2>
            <ol className="te-flow-list">
              {task.steps.map((s, i) => (
                <li key={s.id} className="te-flow-item" style={{ ['--step-color' as string]: stepColor(i) }}>
                  <button
                    className={`te-flow-card${s.id === step?.id ? ' is-active' : ''}`}
                    onClick={() => setActiveStepId(s.id)}
                    aria-current={s.id === step?.id ? 'step' : undefined}
                  >
                    <span className="te-step-num">{i + 1}</span>
                    <span className="te-flow-text">
                      <span className="te-flow-title">{s.title || '未命名步驟'}</span>
                      <span className="te-flow-purpose">{s.purpose || '尚未設定目的'}</span>
                    </span>
                    <span className="te-flow-count" title={`${s.lines.length} 句台詞`}>{s.lines.length}</span>
                  </button>
                </li>
              ))}
            </ol>
            <button className="te-dashed-btn" onClick={addStep}>
              <span className="material-symbols-outlined" aria-hidden="true">add</span>新增步驟
            </button>
          </section>
        </aside>

        {/* ── 中欄：步驟編輯 ─────────────────────────────────────────────── */}
        {step && (
          <main className="te-center te-panel" style={{ ['--step-color' as string]: stepColor(activeIndex) }}>
            <div className="te-step-head">
              <span className="te-step-num te-step-num-lg">{activeIndex + 1}</span>
              <input
                className="te-step-title"
                value={step.title}
                maxLength={100}
                placeholder="步驟名稱，例：招呼"
                aria-label="步驟名稱"
                onChange={e => { const title = e.target.value; editStep(step.id, s => ({ ...s, title })); }}
              />
              {step.purpose && <span className="te-chip-teal">{step.purpose}</span>}
              <div className="te-step-actions">
                <button className="te-tool-btn" onClick={duplicateStep}>
                  <span className="material-symbols-outlined" aria-hidden="true">content_copy</span>複製
                </button>
                <button className="te-tool-btn" onClick={() => moveStep(-1)} disabled={activeIndex === 0} aria-label="上移步驟" title="上移">
                  <span className="material-symbols-outlined" aria-hidden="true">arrow_upward</span>
                </button>
                <button className="te-tool-btn" onClick={() => moveStep(1)} disabled={activeIndex === task.steps.length - 1} aria-label="下移步驟" title="下移">
                  <span className="material-symbols-outlined" aria-hidden="true">arrow_downward</span>
                </button>
                <button className="te-tool-btn te-tool-danger" onClick={deleteStep} disabled={task.steps.length <= 1} title={task.steps.length <= 1 ? '至少要保留一個步驟' : '刪除步驟'}>
                  <span className="material-symbols-outlined" aria-hidden="true">delete</span>刪除
                </button>
              </div>
            </div>

            <div className="te-tabs" role="tablist">
              {([
                ['dialogue', 'forum', '對話內容'],
                ['grammar', 'menu_book', '語法說明'],
                ['notes', 'lightbulb', '教學注意點'],
              ] as const).map(([key, icon, label]) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={tab === key}
                  className={`te-tab${tab === key ? ' is-active' : ''}`}
                  onClick={() => setTab(key)}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">{icon}</span>{label}
                </button>
              ))}
            </div>

            <div className="te-tab-body">
              {tab === 'dialogue' && (
                <>
                  {step.lines.length === 0 && <p className="te-empty">這個步驟還沒有台詞，按下方「新增對話」開始。</p>}
                  <ul className="te-lines">
                    {step.lines.map((line, i) => {
                      const slotIdx = slots.findIndex(s => s.id === line.speakerSlotId);
                      const slot = slots[slotIdx];
                      const theme = SPEAKER_THEMES[(slotIdx < 0 ? 0 : slotIdx) % SPEAKER_THEMES.length];
                      const range = timings.ranges[i];
                      return (
                        <li
                          key={line.id}
                          className="te-line"
                          style={{
                            ['--avatar' as string]: theme.avatar,
                            ['--bubble' as string]: theme.bubble,
                            ['--bubble-border' as string]: theme.border,
                          }}
                        >
                          <span className="te-avatar" aria-hidden="true">{slot?.icon ?? '🙂'}</span>
                          <div className="te-line-main">
                            <div className="te-line-head">
                              <select
                                className="te-speaker"
                                value={slot ? line.speakerSlotId : ''}
                                aria-label="說話角色"
                                onChange={e => editLine(line.id, { speakerSlotId: e.target.value })}
                              >
                                {!slot && <option value="">未指定角色</option>}
                                {slots.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                              </select>
                              <span className="te-chip-soft">台詞</span>
                              <span className="te-line-tools">
                                <button className="te-mini-btn" onClick={() => moveLine(i, -1)} disabled={i === 0} aria-label="上移台詞">
                                  <span className="material-symbols-outlined">arrow_upward</span>
                                </button>
                                <button className="te-mini-btn" onClick={() => moveLine(i, 1)} disabled={i === step.lines.length - 1} aria-label="下移台詞">
                                  <span className="material-symbols-outlined">arrow_downward</span>
                                </button>
                                <button className="te-mini-btn te-mini-danger" onClick={() => removeLine(line.id)} aria-label="刪除台詞">
                                  <span className="material-symbols-outlined">delete</span>
                                </button>
                              </span>
                              {range && <span className="te-time">{formatClock(range.start)} – {formatClock(range.end)}</span>}
                            </div>
                            <div className="te-bubble">
                              <textarea
                                className="te-en"
                                rows={1}
                                value={line.en}
                                maxLength={1000}
                                placeholder="英文台詞，例：Hello! How can I help you today?"
                                aria-label="英文台詞"
                                onChange={e => editLine(line.id, { en: e.target.value })}
                              />
                              <textarea
                                className="te-zh"
                                rows={1}
                                value={line.zh}
                                maxLength={1000}
                                placeholder="中文翻譯"
                                aria-label="中文翻譯"
                                onChange={e => editLine(line.id, { zh: e.target.value })}
                              />
                              {canSpeak() && (
                                <button
                                  className={`te-speak${speakingLineId === line.id ? ' is-speaking' : ''}`}
                                  onClick={() => speak(line)}
                                  disabled={!line.en.trim()}
                                  aria-label={speakingLineId === line.id ? '停止播放' : '播放英文台詞'}
                                  title={speakingLineId === line.id ? '停止播放' : '播放英文台詞'}
                                >
                                  <span className="material-symbols-outlined">{speakingLineId === line.id ? 'stop' : 'volume_up'}</span>
                                </button>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <button className="te-dashed-btn te-add-line" onClick={addLine}>
                    <span className="material-symbols-outlined" aria-hidden="true">add</span>新增對話
                  </button>
                </>
              )}

              {tab === 'grammar' && (
                <div className="te-form">
                  <ListEditor
                    label="本段重點語法"
                    placeholder="例：How can I help you today?"
                    items={step.grammarPoints}
                    onChange={grammarPoints => editStep(step.id, s => ({ ...s, grammarPoints }))}
                  />
                  <label className="te-field">
                    <span>語法說明</span>
                    <textarea
                      rows={4}
                      value={step.grammarNote}
                      maxLength={1000}
                      placeholder="例：用於開場，建立友善互動氛圍。"
                      onChange={e => { const grammarNote = e.target.value; editStep(step.id, s => ({ ...s, grammarNote })); }}
                    />
                  </label>
                </div>
              )}

              {tab === 'notes' && (
                <div className="te-form">
                  <ListEditor
                    label="教學注意點"
                    placeholder="例：引導學生使用完整句子回應。"
                    items={step.teachingNotes}
                    onChange={teachingNotes => editStep(step.id, s => ({ ...s, teachingNotes }))}
                  />
                </div>
              )}
            </div>

            <footer className="te-step-foot">
              <label className="te-purpose">
                <span className="material-symbols-outlined" aria-hidden="true">target</span>目的標籤
                <input
                  value={step.purpose}
                  maxLength={100}
                  placeholder="例：問候引導"
                  onChange={e => { const purpose = e.target.value; editStep(step.id, s => ({ ...s, purpose })); }}
                />
              </label>
              <span className="te-duration" title="依英文字數自動估算">
                <span className="material-symbols-outlined" aria-hidden="true">schedule</span>預計時長
                <strong>{formatClock(timings.total)}</strong>
              </span>
            </footer>
          </main>
        )}

        {/* ── 右欄：教師可見摘要 ─────────────────────────────────────────── */}
        {step && (
          <aside className="te-right">
            <button className="te-side-card" onClick={() => setTab('grammar')}>
              <div className="te-side-head">
                <h3><span className="material-symbols-outlined" aria-hidden="true">menu_book</span>語法說明</h3>
                <TeacherOnlyBadge />
              </div>
              {step.grammarPoints.length === 0 && !step.grammarNote ? (
                <p className="te-side-empty">尚未填寫，點此新增</p>
              ) : (
                <>
                  {step.grammarPoints.length > 0 && (
                    <>
                      <p className="te-side-sub">本段重點語法：</p>
                      <ul>{step.grammarPoints.map((g, i) => <li key={i}>{g}</li>)}</ul>
                    </>
                  )}
                  {step.grammarNote && <p className="te-side-note">{step.grammarNote}</p>}
                </>
              )}
            </button>

            <button className="te-side-card te-side-warm" onClick={() => setTab('notes')}>
              <div className="te-side-head">
                <h3><span className="material-symbols-outlined te-warn" aria-hidden="true">warning</span>教學注意點</h3>
                <TeacherOnlyBadge />
              </div>
              {step.teachingNotes.length === 0 ? (
                <p className="te-side-empty">尚未填寫，點此新增</p>
              ) : (
                <ul>{step.teachingNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>
              )}
            </button>

            <div className="te-side-card te-side-ai" aria-disabled="true">
              <div className="te-side-head">
                <h3><span className="material-symbols-outlined te-ai" aria-hidden="true">auto_awesome</span>AI 助教建議</h3>
                <TeacherOnlyBadge />
              </div>
              <p className="te-side-empty">即將推出：AI 會依這一步的對話給出改進建議，並可一鍵套用。</p>
              <button className="te-btn-apply" disabled>
                <span className="material-symbols-outlined" aria-hidden="true">auto_awesome</span>套用建議
              </button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function TeacherOnlyBadge() {
  return (
    <span className="te-badge-teacher">
      <span className="material-symbols-outlined" aria-hidden="true">visibility</span>教師可見
    </span>
  );
}

interface ListEditorProps {
  label: string;
  placeholder: string;
  items: string[];
  onChange: (items: string[]) => void;
}

/** 可增刪的單行文字清單 */
function ListEditor({ label, placeholder, items, onChange }: ListEditorProps) {
  return (
    <fieldset className="te-list-editor">
      <legend>{label}</legend>
      {items.map((item, i) => (
        <div key={i} className="te-list-row">
          <span className="te-bullet" aria-hidden="true">•</span>
          <input
            value={item}
            maxLength={1000}
            placeholder={placeholder}
            aria-label={`${label} 第 ${i + 1} 項`}
            onChange={e => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <button className="te-mini-btn te-mini-danger" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`刪除第 ${i + 1} 項`}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      ))}
      <button className="te-link-btn" onClick={() => onChange([...items, ''])} disabled={items.length >= 20}>
        <span className="material-symbols-outlined" aria-hidden="true">add</span>新增一項
      </button>
    </fieldset>
  );
}
