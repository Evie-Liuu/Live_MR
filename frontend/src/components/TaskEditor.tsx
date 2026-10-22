import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { THEMES } from '../config/scenes.ts';
import { CEFR_LEVELS, normalizeLevel, type CefrLevel } from '../types/lessonPlan.ts';
import {
  MAX_CAST_OPTIONS, MAX_CHECKPOINTS_PER_STEP, MAX_CHECKPOINT_OPTIONS, MAX_TAGS, MAX_TAG_LEN, MIN_CHECKPOINT_OPTIONS,
  blankTask, castChoices, castSize, cleanCheckpoints, cloneStep, formatClock, newCheckpoint, newLine, newStep, speakingSlots,
  splitTags, stepTimings,
  type AudienceCheckpoint, type CastOption, type DialogueLine, type DialogueStep, type DialogueTask, type DialogueTaskRecord,
} from '../types/dialogueTask.ts';
import { createDialogueTask, dialogueTaskErrorText, updateDialogueTask } from '../utils/dialogueTaskClient.ts';
import { TASK_TEMPLATES, toTemplateSource } from '../config/taskTemplates/index.ts';
import ScriptSimulator from './ScriptSimulator.tsx';
import { GESTURES, isGestureId } from '../config/gestures.ts';
import { checkpointKind, optionMark, resolveCastText } from '../utils/checkpointPoll.ts';
import './TaskEditor.css';

interface TaskEditorProps {
  teacherUid: string;
  institutionId?: string;
  /** null = 新建任務（第一次儲存才寫入資料庫） */
  initial: DialogueTaskRecord | null;
  /** 新建時的起始內容（例如套用模板）；未提供則為空白任務 */
  initialTask?: DialogueTask;
  onSaved: (record: DialogueTaskRecord) => void;
  onClose: () => void;
}

type Tab = 'dialogue' | 'grammar' | 'notes' | 'checkpoints' | 'cast';

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

export default function TaskEditor({ teacherUid, institutionId, initial, initialTask, onSaved, onClose }: TaskEditorProps) {
  const [task, setTask] = useState<DialogueTask>(() => {
    // 舊資料可能是舊版程度值（A2 / B1），載入時轉成新版
    if (initial) return { ...initial.task, level: normalizeLevel(initial.task.level) };
    if (initialTask) return initialTask;
    const scene = SCENES[0];
    return blankTask(scene?.id ?? '', scene?.slots.map(s => s.id) ?? []);
  });
  const [recordId, setRecordId] = useState<string | null>(initial?.id ?? null);
  const [activeStepId, setActiveStepId] = useState<string>(() => task.steps[0]?.id ?? '');
  const [tab, setTab] = useState<Tab>('dialogue');
  // 套用模板產生的草稿尚未存檔，一開始就算有未儲存變更
  const [dirty, setDirty] = useState(!initial && !!initialTask);
  const [notice, setNotice] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
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
    setNotice(null);
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
    // 題目空白的台下互動點不存
    const payload: DialogueTask = { ...cleanCheckpoints(task), title: task.title.trim() || '未命名任務' };
    // 還沒設定任何併角的空白版本不存（後端不接受空的併角）
    const castOptions = (task.castOptions ?? []).filter(c => Object.keys(c.merge).length > 0);
    if (castOptions.length > 0) payload.castOptions = castOptions;
    else delete payload.castOptions;
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

  // 開發工具：把目前任務轉成模板檔原始碼並複製到剪貼簿（流程見 config/taskTemplates/README.md）
  const exportAsTemplate = async () => {
    const suggested = task.sourceTemplate?.id ?? `${task.sceneId}_new`;
    const templateId = window.prompt('模板 id（英數與底線，上線後不可更改）', suggested)?.trim();
    if (!templateId) return;
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(templateId)) { setNotice('模板 id 只能用英數與底線，且以字母開頭'); return; }
    const source = toTemplateSource(task, templateId);
    try {
      await navigator.clipboard.writeText(source);
      setNotice(`已複製 ${templateId}.ts 的內容到剪貼簿`);
    } catch {
      console.log(source);
      setNotice('無法寫入剪貼簿，模板原始碼已輸出到 console');
    }
  };

  const sourceTemplateName = task.sourceTemplate
    ? TASK_TEMPLATES.find(t => t.id === task.sourceTemplate!.id)?.name ?? task.sourceTemplate.id
    : null;

  const requestClose = () => {
    if (dirty) setConfirmClose(true);
    else onClose();
  };

  const changeScene = (sceneId: string) => {
    const nextSlots = SCENES.find(s => s.id === sceneId)?.slots ?? [];
    // 換場景時，舊角色對不上的台詞改指派給新場景的第一個角色；併角規則的角色 id 也對不上，一併清掉
    edit(t => {
      const next: DialogueTask = {
        ...t,
        sceneId,
        steps: t.steps.map(s => ({
          ...s,
          lines: s.lines.map(l => (nextSlots.some(sl => sl.id === l.speakerSlotId) ? l : { ...l, speakerSlotId: nextSlots[0]?.id ?? '' })),
        })),
      };
      delete next.castOptions;
      return next;
    });
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
            {saving ? '儲存中…' : notice ?? (dirty ? '尚未儲存' : savedFlash ? '已儲存' : '')}
          </span>
          {import.meta.env.DEV && (
            <button className="te-btn-outline" onClick={() => { void exportAsTemplate(); }} title="開發模式限定：匯出成內建模板原始碼">
              <span className="material-symbols-outlined" aria-hidden="true">code</span>匯出為模板
            </button>
          )}
          <button className="te-btn-outline" onClick={() => setSimulating(true)} title="用 3D 角色與語音播放目前的劇本（不必先儲存）">
            <span className="material-symbols-outlined te-play" aria-hidden="true">theaters</span>模擬播放
          </button>
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
        <ConfirmLeaveModal
          saving={saving}
          error={error}
          onCancel={() => setConfirmClose(false)}
          onDiscard={onClose}
          onSaveAndLeave={async () => { if (await save()) onClose(); }}
        />
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
                  {CEFR_LEVELS.map(l => <option key={l.value} value={l.value} title={l.label}>{l.short}</option>)}
                </select>
              </label>
            </div>
            <TagEditor
              tags={task.tags ?? []}
              onChange={tags => edit(t => ({ ...t, tags }))}
            />
            <CastSummary task={task} onEdit={() => setTab('cast')} />
            {sourceTemplateName && (
              <span className="te-field">來自模板：{sourceTemplateName}（v{task.sourceTemplate!.version}）</span>
            )}
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
                ['checkpoints', 'quiz', '台下互動'],
                ['cast', 'groups', '演出人數'],
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
                              <select
                                className={`te-gesture${line.gesture ? ' has-gesture' : ''}`}
                                value={line.gesture ?? ''}
                                aria-label="動作"
                                title="說這句時角色做的動作（模擬播放時看得到）"
                                onChange={e => editLine(line.id, { gesture: isGestureId(e.target.value) ? e.target.value : undefined })}
                              >
                                <option value="">無動作</option>
                                {GESTURES.map(g => <option key={g.id} value={g.id}>{g.icon} {g.label}</option>)}
                              </select>
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

              {tab === 'checkpoints' && (
                <CheckpointEditor
                  checkpoints={step.checkpoints ?? []}
                  slots={slots}
                  onChange={checkpoints => editStep(step.id, s => ({ ...s, checkpoints }))}
                />
              )}

              {tab === 'cast' && (
                <CastEditor
                  task={task}
                  slotLabel={id => slots.find(sl => sl.id === id)?.label ?? id}
                  onChange={castOptions => edit(t => ({ ...t, castOptions }))}
                />
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

            {/* 演出人數是整個任務共用，不顯示單一步驟的目的與時長 */}
            {tab !== 'cast' && <footer className="te-step-foot">
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
            </footer>}
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

            <button className="te-side-card" onClick={() => setTab('checkpoints')}>
              <div className="te-side-head">
                <h3><span className="material-symbols-outlined te-cp-icon" aria-hidden="true">quiz</span>台下互動</h3>
              </div>
              {!step.checkpoints?.length ? (
                <p className="te-side-empty">這一步演完後沒有台下互動，點此新增</p>
              ) : (
                <ul>{step.checkpoints.map(c => <li key={c.id}>{c.title}：{c.question || '（題目空白）'}</li>)}</ul>
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
      {simulating && (
        <ScriptSimulator task={task} startStepIndex={activeIndex} onClose={() => setSimulating(false)} />
      )}
    </div>
  );
}

interface ConfirmLeaveModalProps {
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onDiscard: () => void;
  onSaveAndLeave: () => void;
}

/** 有未儲存變更時關閉編輯器的確認視窗；Esc / 點背景 = 繼續編輯 */
function ConfirmLeaveModal({ saving, error, onCancel, onDiscard, onSaveAndLeave }: ConfirmLeaveModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saving, onCancel]);

  return (
    <div className="te-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !saving) onCancel(); }}>
      <div
        className="te-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="te-leave-title"
        aria-describedby="te-leave-desc"
      >
        <button
          type="button"
          className="te-modal-close"
          onClick={onCancel}
          disabled={saving}
          aria-label="關閉"
          title="關閉"
        >
          <span className="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
        <span className="te-modal-icon material-symbols-outlined" aria-hidden="true">warning</span>
        <h2 id="te-leave-title" className="te-modal-title">有尚未儲存的變更</h2>

        <p id="te-leave-desc" className="te-modal-desc">確定要離開嗎？離開前可以先儲存，否則這次的修改會遺失。</p>
        {error && <p className="te-modal-error" role="alert">{error}</p>}
        <div className="te-modal-actions">
          <button className="te-modal-btn te-modal-cancel" onClick={onCancel} disabled={saving} autoFocus>繼續編輯</button>
          <button className="te-modal-btn te-modal-discard" onClick={onDiscard} disabled={saving}>放棄變更並離開</button>
          <button className="te-modal-btn te-modal-save" onClick={onSaveAndLeave} disabled={saving}>
            <span className="material-symbols-outlined" aria-hidden="true">save</span>{saving ? '儲存中…' : '儲存並離開'}
          </button>
        </div>
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

/** 每個角色在某個併角方案下的台詞句數 */
function castLineCounts(task: DialogueTask, merge: Record<string, string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of task.steps.flatMap(s => s.lines)) {
    const id = merge[line.speakerSlotId] ?? line.speakerSlotId;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** 演出人數版本的問題說明；沒問題回 null */
function castProblem(task: DialogueTask, options: CastOption[], index: number): string | null {
  const full = speakingSlots(task).length;
  const sizes = options.map(o => castSize(task, o.merge));
  const size = sizes[index];
  if (Object.keys(options[index].merge).length === 0) return '尚未設定併角（儲存時略過）';
  if (size === null) return '不能把台詞併給已經被併掉的角色';
  if (size >= full) return '與完整人數相同';
  if (sizes.indexOf(size) !== index) return '與其他版本人數相同';
  return null;
}

/** 左欄摘要：目前有哪些演出人數，點擊到「演出人數」分頁編輯 */
function CastSummary({ task, onEdit }: { task: DialogueTask; onEdit: () => void }) {
  const full = speakingSlots(task).length;
  if (full < 2 && !task.castOptions?.length) return null;
  const sizes = castChoices(task).map(c => c.size);
  return (
    <div className="te-field te-cast-field">
      <span>演出人數</span>
      <button type="button" className="te-cast-summary" onClick={onEdit}>
        <span className="te-cast-summary-sizes">{sizes.map(n => `${n} 人`).join('・')}</span>
        <span className="te-cast-summary-edit">
          <span className="material-symbols-outlined" aria-hidden="true">edit</span>編輯
        </span>
      </button>
    </div>
  );
}

/**
 * 演出人數（併角規則）分頁：完整人數之外，可新增較少人數的版本，把某些角色的台詞併給另一個角色。
 * 套用到整個任務；上課時老師在角色配置切換人數，台詞句數與大屏顯示的角色會跟著換算。
 */
function CastEditor({ task, slotLabel, onChange }: {
  task: DialogueTask;
  slotLabel: (id: string) => string;
  onChange: (options: CastOption[]) => void;
}) {
  const options = task.castOptions ?? [];
  const speakers = speakingSlots(task);
  const full = speakers.length;
  const fullCounts = castLineCounts(task, {});

  const setMerge = (index: number, from: string, to: string) => {
    onChange(options.map((o, i) => {
      if (i !== index) return o;
      const merge = { ...o.merge };
      if (to) merge[from] = to; else delete merge[from];
      return { merge };
    }));
  };

  if (full < 2 && options.length === 0) {
    return <p className="te-empty">這個任務只有一個角色有台詞，不需要設定演出人數。</p>;
  }

  return (
    <div className="te-cast-panel">
      <p className="te-cast-intro">
        套用到整個任務的所有步驟。完整 {full} 人各演一角；人數不夠時可新增較少人數的版本，把某些角色的台詞併給別人說。
        上課時在「角色配置」切換演出人數。
      </p>

      <div className="te-cast-grid">
        <section className="te-cast-option te-cast-option--full" aria-label={`完整 ${full} 人`}>
          <div className="te-cast-head"><strong>{full} 人版（完整）</strong></div>
          {speakers.map(id => (
            <div key={id} className="te-cast-row">
              <span>{slotLabel(id)}</span>
              <span className="te-cast-count">{fullCounts.get(id) ?? 0} 句</span>
            </div>
          ))}
        </section>

        {options.map((opt, i) => {
          const err = castProblem(task, options, i);
          const size = castSize(task, opt.merge);
          const counts = castLineCounts(task, opt.merge);
          return (
            <section key={i} className="te-cast-option" aria-label={`演出人數版本 ${i + 1}`}>
              <div className="te-cast-head">
                <strong>{size !== null && !err ? `${size} 人版` : '人數版本'}</strong>
                {err && <span className="te-cast-error">{err}</span>}
                <button
                  type="button"
                  className="te-tag-remove"
                  onClick={() => onChange(options.filter((_, k) => k !== i))}
                  aria-label={`刪除演出人數版本 ${i + 1}`}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">close</span>
                </button>
              </div>
              {speakers.map(id => {
                const merged = opt.merge[id];
                return (
                  <label key={id} className="te-cast-row">
                    <span>{slotLabel(id)}</span>
                    <select value={merged ?? ''} onChange={e => setMerge(i, id, e.target.value)}>
                      <option value="">自己演</option>
                      {speakers.filter(o => o !== id).map(o => <option key={o} value={o}>台詞給 {slotLabel(o)}</option>)}
                    </select>
                    <span className="te-cast-count">{merged ? '—' : `${counts.get(id) ?? 0} 句`}</span>
                  </label>
                );
              })}
            </section>
          );
        })}
      </div>

      {options.length < MAX_CAST_OPTIONS && (
        <button type="button" className="te-cast-add" onClick={() => onChange([...options, { merge: {} }])}>
          ＋ 新增人數版本
        </button>
      )}
    </div>
  );
}

/** 互動點的問題說明（顯示在卡片標題旁）；沒問題回 null */
function checkpointProblem(cp: AudienceCheckpoint): string | null {
  if (!cp.question.trim()) return '題目空白（儲存時略過）';
  if (checkpointKind(cp) === 'choice' && cp.options.some(o => !o.trim())) return '有選項空白';
  return null;
}

/**
 * 台下互動分頁：這一步演完後，老師發布到台下學生裝置作答的選擇題 / 是非題。
 * 題目提到角色時插入角色代號，上課發布時換成演出者名字（少人數併角時換成接手的人）。
 */
function CheckpointEditor({ checkpoints, slots, onChange }: {
  checkpoints: AudienceCheckpoint[];
  slots: SlotOption[];
  onChange: (checkpoints: AudienceCheckpoint[]) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const slotLabels = useMemo(() => Object.fromEntries(slots.map(s => [s.id, s.label])), [slots]);
  /** 編輯器預覽：沒有演出者，代號顯示成角色名稱 */
  const preview = (text: string) => resolveCastText(text, { slotLabels, merge: {}, slotAssignments: {}, names: {} });

  const update = (i: number, patch: Partial<AudienceCheckpoint>) =>
    onChange(checkpoints.map((c, k) => (k === i ? { ...c, ...patch } : c)));

  const setKind = (i: number, kind: 'choice' | 'truefalse') => {
    const cp = checkpoints[i];
    if (checkpointKind(cp) === kind) return;
    if (kind === 'truefalse') {
      update(i, { kind, options: ['True', 'False'], answerIndex: Math.min(cp.answerIndex, 1) });
    } else {
      // 是非題的 True / False 不沿用成選擇題選項
      const next = { ...cp, options: ['', '', ''], answerIndex: 0 };
      delete next.kind;
      onChange(checkpoints.map((c, k) => (k === i ? next : c)));
    }
  };

  const setOption = (i: number, j: number, value: string) =>
    update(i, { options: checkpoints[i].options.map((o, k) => (k === j ? value : o)) });

  const removeOption = (i: number, j: number) => {
    const cp = checkpoints[i];
    const answerIndex = cp.answerIndex === j ? 0 : cp.answerIndex > j ? cp.answerIndex - 1 : cp.answerIndex;
    update(i, { options: cp.options.filter((_, k) => k !== j), answerIndex });
  };

  /** 角色代號插入到游標所在的題目／選項／延伸追問欄位 */
  const insertToken = (slotId: string) => {
    const el = document.activeElement;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || !panelRef.current?.contains(el)) return;
    const i = Number(el.dataset.cp);
    const field = el.dataset.field;
    if (!Number.isInteger(i) || !field) return;
    const token = `{${slotId}}`;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const value = el.value.slice(0, start) + token + el.value.slice(end);
    if (field === 'question') update(i, { question: value });
    else if (field === 'followUp') update(i, { followUp: value });
    else if (field.startsWith('opt-')) setOption(i, Number(field.slice(4)), value);
    requestAnimationFrame(() => el.setSelectionRange(start + token.length, start + token.length));
  };

  return (
    <div className="te-cp-panel" ref={panelRef}>
      <p className="te-cast-intro">
        這一步演完後，老師在任務卡按「發布」，台下學生在自己的裝置作答，大屏顯示統計與正確答案。
        題目提到角色時，先點題目欄位再點下方角色，會插入代號，上課時自動換成演出學生的名字。
      </p>

      {slots.length > 0 && (
        <div className="te-cp-tokens" aria-label="插入角色代號">
          <span className="te-cp-tokens-label">插入角色：</span>
          {slots.map(s => (
            <button
              key={s.id}
              type="button"
              className="te-cp-token"
              // 不搶走輸入欄位的焦點，才知道要插到哪裡
              onMouseDown={e => e.preventDefault()}
              onClick={() => insertToken(s.id)}
              title={`插入 {${s.id}}，上課時換成演出「${s.label}」的學生名字`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {checkpoints.length === 0 && <p className="te-empty">這一步還沒有台下互動，按下方新增選擇題或是非題。</p>}

      {checkpoints.map((cp, i) => {
        const kind = checkpointKind(cp);
        const problem = checkpointProblem(cp);
        const resolved = preview(cp.question);
        return (
          <section key={cp.id} className="te-cp-card" aria-label={`台下互動 ${i + 1}`}>
            <div className="te-cp-head">
              <span className="te-cp-num">{i + 1}</span>
              <div className="te-cp-kind" role="radiogroup" aria-label="題型">
                {(['choice', 'truefalse'] as const).map(k => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={kind === k}
                    className={kind === k ? 'is-active' : ''}
                    onClick={() => setKind(i, k)}
                  >
                    {k === 'choice' ? '選擇題' : '是非題'}
                  </button>
                ))}
              </div>
              <input
                className="te-cp-title"
                value={cp.title}
                maxLength={100}
                placeholder="互動類型，例：聽力理解"
                aria-label="互動類型"
                onChange={e => update(i, { title: e.target.value })}
              />
              {problem && <span className="te-cast-error">{problem}</span>}
              <span className="te-cp-tools">
                <button className="te-mini-btn" onClick={() => onChange(moveItem(checkpoints, i, i - 1))} disabled={i === 0} aria-label="上移互動">
                  <span className="material-symbols-outlined">arrow_upward</span>
                </button>
                <button className="te-mini-btn" onClick={() => onChange(moveItem(checkpoints, i, i + 1))} disabled={i === checkpoints.length - 1} aria-label="下移互動">
                  <span className="material-symbols-outlined">arrow_downward</span>
                </button>
                <button
                  type="button"
                  className="te-cp-delete"
                  onClick={() => onChange(checkpoints.filter((_, k) => k !== i))}
                  aria-label={`刪除第 ${i + 1} 題`}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">delete</span>
                </button>
              </span>
            </div>

            <label className="te-field">
              <span>{kind === 'truefalse' ? '敘述（學生判斷對錯）' : '英文題目'}</span>
              <textarea
                rows={2}
                value={cp.question}
                maxLength={1000}
                data-cp={i}
                data-field="question"
                placeholder={kind === 'truefalse' ? '例：{customer2} wants a red T-shirt.' : '例：Which color does {customer} want?'}
                onChange={e => update(i, { question: e.target.value })}
              />
            </label>
            {resolved !== cp.question && <p className="te-cp-preview">預覽：{resolved}</p>}

            <fieldset className="te-cp-options">
              <legend>選項（點圓圈設定正確答案）</legend>
              {cp.options.map((opt, j) => (
                <div key={j} className={`te-cp-option${cp.answerIndex === j ? ' is-answer' : ''}`}>
                  <label className="te-cp-answer" title="正確答案">
                    <input
                      type="radio"
                      name={`cp-answer-${cp.id}`}
                      checked={cp.answerIndex === j}
                      onChange={() => update(i, { answerIndex: j })}
                      aria-label={`選項 ${optionMark(kind, j)} 是正確答案`}
                    />
                    <span>{optionMark(kind, j)}</span>
                  </label>
                  {kind === 'truefalse' ? (
                    <span className="te-cp-tf">{j === 0 ? '對 True' : '錯 False'}</span>
                  ) : (
                    <>
                      <input
                        value={opt}
                        maxLength={100}
                        data-cp={i}
                        data-field={`opt-${j}`}
                        placeholder={`選項 ${optionMark(kind, j)}`}
                        aria-label={`選項 ${optionMark(kind, j)}`}
                        onChange={e => setOption(i, j, e.target.value)}
                      />
                      <button
                        className="te-mini-btn te-mini-danger"
                        onClick={() => removeOption(i, j)}
                        disabled={cp.options.length <= MIN_CHECKPOINT_OPTIONS}
                        aria-label={`刪除選項 ${optionMark(kind, j)}`}
                      >
                        <span className="material-symbols-outlined">close</span>
                      </button>
                    </>
                  )}
                </div>
              ))}
              {kind === 'choice' && (
                <button
                  className="te-link-btn"
                  onClick={() => update(i, { options: [...cp.options, ''] })}
                  disabled={cp.options.length >= MAX_CHECKPOINT_OPTIONS}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">add</span>新增選項
                </button>
              )}
            </fieldset>

            <label className="te-field">
              <span>延伸追問（選填，公布答案後只有老師看得到）</span>
              <input
                value={cp.followUp ?? ''}
                maxLength={1000}
                data-cp={i}
                data-field="followUp"
                placeholder="例：Which T-shirt is more expensive?"
                onChange={e => {
                  const followUp = e.target.value;
                  if (followUp) update(i, { followUp });
                  else {
                    const next = { ...cp };
                    delete next.followUp;
                    onChange(checkpoints.map((c, k) => (k === i ? next : c)));
                  }
                }}
              />
            </label>
          </section>
        );
      })}

      {checkpoints.length < MAX_CHECKPOINTS_PER_STEP && (
        <div className="te-cp-add">
          <button type="button" className="te-cast-add" onClick={() => onChange([...checkpoints, newCheckpoint('choice')])}>
            ＋ 新增選擇題
          </button>
          <button type="button" className="te-cast-add" onClick={() => onChange([...checkpoints, newCheckpoint('truefalse')])}>
            ＋ 新增是非題
          </button>
        </div>
      )}
    </div>
  );
}

/** 主題標籤：Enter / 逗號 / 頓號新增，Backspace 刪最後一個，可一次貼上「#購物 #詢價」 */
function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const full = tags.length >= MAX_TAGS;

  const add = (text: string) => {
    const next = [...tags];
    for (const tag of splitTags(text)) {
      if (next.length >= MAX_TAGS) break;
      const clipped = tag.slice(0, MAX_TAG_LEN);
      if (!next.includes(clipped)) next.push(clipped);
    }
    if (next.length !== tags.length) onChange(next);
    setDraft('');
  };

  return (
    <div className="te-field te-tags-field">
      <span id="te-tags-label">標籤</span>
      <div className="te-tags" role="group" aria-labelledby="te-tags-label">
        {tags.map(tag => (
          <span key={tag} className="te-tag">
            #{tag}
            <button
              type="button"
              className="te-tag-remove"
              onClick={() => onChange(tags.filter(t => t !== tag))}
              aria-label={`移除標籤 ${tag}`}
            >
              <span className="material-symbols-outlined" aria-hidden="true">close</span>
            </button>
          </span>
        ))}
        {!full && (
          <input
            className="te-tag-input"
            value={draft}
            maxLength={MAX_TAG_LEN + 1}
            placeholder={tags.length === 0 ? '例：購物、詢價，按 Enter 新增' : '新增標籤'}
            aria-label="新增標籤"
            onChange={e => {
              const v = e.target.value;
              // 輸入逗號、頓號或 # 視為分隔，直接把前面的文字變成標籤
              if (/[,，、;；]/.test(v) || (/[#＃]/.test(v.slice(1)))) add(v);
              else setDraft(v);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); add(draft); }
              else if (e.key === 'Backspace' && !draft && tags.length > 0) onChange(tags.slice(0, -1));
            }}
            onPaste={e => {
              const text = e.clipboardData.getData('text');
              if (splitTags(text).length > 1) { e.preventDefault(); add(text); }
            }}
            onBlur={() => { if (draft.trim()) add(draft); }}
          />
        )}
      </div>
      <span className="te-tags-hint">{tags.length}/{MAX_TAGS}・用於任務管理的搜尋與篩選</span>
    </div>
  );
}
