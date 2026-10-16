/**
 * 導師任務管理抽屜：左側列出老師「我的任務」中與目前場景相符的對話任務，
 * 點選後右側預覽課程內容（流程、步驟、句型、台詞），確認後按「開始課程」載入到 HostSession 左側側欄。
 */
import { useEffect, useMemo, useState } from 'react';
import type { DialogueTaskRecord, DialogueTaskSummary } from '../types/dialogueTask.ts';
import { stepTimings } from '../types/dialogueTask.ts';
import { getDialogueTask, listDialogueTasks, dialogueTaskErrorText } from '../utils/dialogueTaskClient.ts';
import { CEFR_LEVELS, levelLabel, normalizeLevel, type CefrLevel } from '../types/lessonPlan.ts';
import { THEMES } from '../config/scenes.ts';
import { LESSON_PHASES, phaseContent } from '../config/lessonPhases.ts';
import './LessonTaskDrawer.css';

interface LessonTaskDrawerProps {
  open: boolean;
  onClose: () => void;
  teacherUid: string | null;
  sceneId: string;
  sceneLabel: string;
  /** 目前上課中的任務 id（沒有則為 null） */
  activeTaskId: string | null;
  /** 開始課程：載入到左側並關閉抽屜 */
  onSelect: (record: DialogueTaskRecord) => void;
  onEnd: () => void;
  /** 前往備課中心（帶 taskId 則直接編輯該任務）；課堂保持進行 */
  onOpenPrep?: (taskId?: string) => void;
}

/** 步驟之間預留的轉場時間（秒），用於估算整份任務長度 */
const STEP_GAP_SEC = 5;

export default function LessonTaskDrawer({
  open, onClose, teacherUid, sceneId, sceneLabel, activeTaskId, onSelect, onEnd, onOpenPrep,
}: LessonTaskDrawerProps) {
  const [tasks, setTasks] = useState<DialogueTaskSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  /** 左側點選的任務（null = 預設選上課中的任務或第一個） */
  const [pickedId, setPickedId] = useState<string | null>(null);
  /** 已載入的完整任務（右側預覽用） */
  const [records, setRecords] = useState<Record<string, DialogueTaskRecord>>({});
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});

  // 每次打開抽屜重新讀清單（老師可能剛在備課中心新增或修改任務）
  useEffect(() => {
    if (!open || !teacherUid) return;
    let cancelled = false;
    listDialogueTasks(teacherUid)
      .then(list => {
        if (cancelled) return;
        setTasks(list);
        setListError(null);
        setRecords({});
        setDetailErrors({});
      })
      .catch(e => { if (!cancelled) setListError(dialogueTaskErrorText(e)); });
    return () => { cancelled = true; };
  }, [open, teacherUid]);

  const sceneTasks = useMemo(() => (tasks ?? []).filter(t => t.sceneId === sceneId), [tasks, sceneId]);

  // 篩選：關鍵字（標題）＋程度標籤
  const [query, setQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState<CefrLevel | null>(null);
  const levelTags = useMemo(() => CEFR_LEVELS
    .map(l => ({ ...l, count: sceneTasks.filter(t => normalizeLevel(t.level) === l.value).length }))
    .filter(l => l.count > 0), [sceneTasks]);
  const keyword = query.trim().toLowerCase();
  const visibleTasks = sceneTasks.filter(t =>
    (!levelFilter || normalizeLevel(t.level) === levelFilter)
    && (!keyword || t.title.toLowerCase().includes(keyword)));
  const filtering = !!keyword || !!levelFilter;
  const clearFilters = () => { setQuery(''); setLevelFilter(null); };
  const selectedId = [pickedId, activeTaskId, sceneTasks[0]?.id]
    .find(id => id && sceneTasks.some(t => t.id === id)) ?? null;
  const record = selectedId ? records[selectedId] : undefined;
  const detailError = selectedId ? detailErrors[selectedId] : undefined;

  // 右側預覽需要完整任務內容：選到尚未載入的任務時讀取
  useEffect(() => {
    if (!open || !selectedId || records[selectedId] || detailErrors[selectedId]) return;
    let cancelled = false;
    getDialogueTask(selectedId)
      .then(rec => { if (!cancelled) setRecords(prev => ({ ...prev, [rec.id]: rec })); })
      .catch(e => { if (!cancelled) setDetailErrors(prev => ({ ...prev, [selectedId]: dialogueTaskErrorText(e) })); });
    return () => { cancelled = true; };
  }, [open, selectedId, records, detailErrors]);

  const retryDetail = () => {
    if (!selectedId) return;
    setDetailErrors(prev => { const next = { ...prev }; delete next[selectedId]; return next; });
  };

  const start = () => {
    if (!record) return;
    onSelect(record);
    onClose();
  };

  return (
    <div className={`panel-drawer panel-drawer--wide ${open ? 'panel-drawer--open' : ''}`}>
      <div className="panel-drawer-header">
        <div className="slot-drawer-title">
          <span className="orange">任務管理</span> <span className="teal">TASKS</span>
        </div>
        <button className="panel-close-btn" onClick={onClose} aria-label="關閉">
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      <div className="panel-drawer-body ltd-body">
        {/* ── 左側：課程清單 ─────────────────────────────────────────── */}
        <aside className="ltd-side" aria-label="課程清單">
          <p className="ltd-scene">
            <span className="material-symbols-outlined" aria-hidden="true">storefront</span>
            目前場景：<strong>{sceneLabel}</strong>
          </p>
          {listError && <div className="ltd-error" role="alert">{listError}</div>}
          {onOpenPrep && teacherUid && (
            <button type="button" className="ltd-prep-link" onClick={() => onOpenPrep()}>
              <span className="material-symbols-outlined" aria-hidden="true">edit_note</span>
              <span className="ltd-prep-link-text">
                <strong>前往備課中心</strong>
                <small>新增或修改任務，課堂會保持進行</small>
              </span>
              <span className="material-symbols-outlined" aria-hidden="true">chevron_right</span>
            </button>
          )}

          {!teacherUid ? (
            <p className="ltd-empty">請先登入老師帳號。</p>
          ) : tasks === null && !listError ? (
            <p className="ltd-empty">載入中…</p>
          ) : sceneTasks.length === 0 ? (
            <p className="ltd-empty">這個場景還沒有任務。<br />請先到備課中心建立或套用任務並儲存。</p>
          ) : (
            <>
              <div className="ltd-filter">
                <label className="ltd-search">
                  <span className="material-symbols-outlined" aria-hidden="true">search</span>
                  <input
                    type="search"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="搜尋課程名稱"
                    aria-label="搜尋課程名稱"
                  />
                  {query && (
                    <button type="button" className="ltd-search-clear" onClick={() => setQuery('')} aria-label="清除搜尋">
                      <span className="material-symbols-outlined" aria-hidden="true">close</span>
                    </button>
                  )}
                </label>
                <div className="ltd-tags" role="group" aria-label="依程度篩選">
                  <button
                    type="button"
                    className={`ltd-tag${!levelFilter ? ' is-on' : ''}`}
                    aria-pressed={!levelFilter}
                    onClick={() => setLevelFilter(null)}
                  >
                    全部<span className="ltd-tag-count">{sceneTasks.length}</span>
                  </button>
                  {levelTags.map(l => (
                    <button
                      key={l.value}
                      type="button"
                      className={`ltd-tag ltd-tag--${l.value}${levelFilter === l.value ? ' is-on' : ''}`}
                      aria-pressed={levelFilter === l.value}
                      onClick={() => setLevelFilter(levelFilter === l.value ? null : l.value)}
                      title={l.label}
                    >
                      {l.short}<span className="ltd-tag-count">{l.count}</span>
                    </button>
                  ))}
                </div>
              </div>

              {visibleTasks.length === 0 ? (
                <div className="ltd-empty">
                  沒有符合條件的課程。
                  {filtering && <button type="button" className="ltd-btn-ghost ltd-clear" onClick={clearFilters}>清除篩選</button>}
                </div>
              ) : (
                <ul className="ltd-list">
                  {visibleTasks.map(t => {
                    const isActive = t.id === activeTaskId;
                    const isSelected = t.id === selectedId;
                    const level = normalizeLevel(t.level);
                    return (
                      <li key={t.id}>
                        <button
                          className={`ltd-item${isSelected ? ' is-selected' : ''}${isActive ? ' is-active' : ''}`}
                          onClick={() => setPickedId(t.id)}
                          aria-pressed={isSelected}
                        >
                          <span className="ltd-item-icon material-symbols-outlined" aria-hidden="true">forum</span>
                          <span className="ltd-item-text">
                            <span className="ltd-item-title">{t.title || '未命名任務'}</span>
                            <span className="ltd-item-tags">
                              <span className={`ltd-item-tag ltd-tag--${level}`}>{levelLabel(level, true)}</span>
                              <span className="ltd-item-tag">{t.stepCount} 步驟</span>
                            </span>
                          </span>
                          {isActive && <span className="ltd-live">上課中</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </aside>

        {/* ── 右側：課程內容預覽 ─────────────────────────────────────── */}
        <section className="ltd-detail" aria-label="課程內容" aria-live="polite">
          {!selectedId ? (
            <div className="ltd-detail-empty">
              <span className="material-symbols-outlined" aria-hidden="true">menu_book</span>
              <p>從左側選擇一個課程，查看內容後再開始上課。</p>
            </div>
          ) : detailError ? (
            <div className="ltd-detail-empty">
              <div className="ltd-error" role="alert">{detailError}</div>
              <button className="ltd-btn-ghost" onClick={retryDetail}>重新載入</button>
            </div>
          ) : !record ? (
            <div className="ltd-detail-empty">
              <div className="gradient-spinner" />
              <p>載入課程內容…</p>
            </div>
          ) : (
            <TaskPreview
              record={record}
              isActive={record.id === activeTaskId}
              hasOtherActive={!!activeTaskId && record.id !== activeTaskId}
              onStart={start}
              onEnd={() => { onEnd(); onClose(); }}
              onEdit={onOpenPrep ? () => onOpenPrep(record.id) : undefined}
            />
          )}
        </section>
      </div>
    </div>
  );
}

interface TaskPreviewProps {
  record: DialogueTaskRecord;
  isActive: boolean;
  /** 已有其他課程正在進行（開始新課程會取代它） */
  hasOtherActive: boolean;
  onStart: () => void;
  onEnd: () => void;
  /** 到備課中心編輯此任務 */
  onEdit?: () => void;
}

function TaskPreview({ record, isActive, hasOtherActive, onStart, onEnd, onEdit }: TaskPreviewProps) {
  const { task } = record;
  const slots = useMemo(
    () => THEMES.flatMap(t => t.scenes).find(s => s.id === task.sceneId)?.slots ?? [],
    [task.sceneId],
  );
  const slotLabel = (id: string) => slots.find(s => s.id === id)?.label ?? id;

  const roles = useMemo(() => {
    const ids: string[] = [];
    for (const step of task.steps) for (const l of step.lines) if (!ids.includes(l.speakerSlotId)) ids.push(l.speakerSlotId);
    return ids.map(id => {
      const slot = slots.find(s => s.id === id);
      return { id, label: slot?.label ?? id, icon: slot?.icon ?? '🙂' };
    });
  }, [task.steps, slots]);

  const totalSec = task.steps.reduce((sum, s) => sum + stepTimings(s.lines).total, 0)
    + Math.max(0, task.steps.length - 1) * STEP_GAP_SEC;
  const minutes = Math.max(1, Math.round(totalSec / 60));
  const lineCount = task.steps.reduce((n, s) => n + s.lines.length, 0);
  const pre = phaseContent(task, 'pre');
  const post = phaseContent(task, 'post');

  return (
    <div className="ltd-preview">
      <div className="ltd-preview-scroll">
        {/* 標題與基本資訊 */}
        <header className="ltd-hero">
          <span className="ltd-hero-icon material-symbols-outlined" aria-hidden="true">forum</span>
          <div className="ltd-hero-text">
            <h3 className="ltd-hero-title">{task.title || '未命名任務'}</h3>
            <div className="ltd-chips">
              <span className="ltd-chip ltd-chip--level">{levelLabel(task.level)}</span>
              <span className="ltd-chip"><span className="material-symbols-outlined" aria-hidden="true">format_list_numbered</span>{task.steps.length} 個步驟</span>
              <span className="ltd-chip"><span className="material-symbols-outlined" aria-hidden="true">chat</span>{lineCount} 句台詞</span>
              <span className="ltd-chip"><span className="material-symbols-outlined" aria-hidden="true">schedule</span>對話約 {minutes} 分鐘</span>
            </div>
            <p className="ltd-hero-updated">最後更新：{new Date(record.updatedAt).toLocaleDateString()}</p>
          </div>
          {onEdit && (
            <button type="button" className="ltd-edit" onClick={onEdit} title="到備課中心編輯此任務，課堂會保持進行">
              <span className="material-symbols-outlined" aria-hidden="true">edit</span>編輯任務
            </button>
          )}
        </header>

        {roles.length > 0 && (
          <div className="ltd-section">
            <h4 className="ltd-section-title">角色</h4>
            <div className="ltd-roles">
              {roles.map((r, i) => (
                <span key={r.id} className="ltd-role-wrap">
                  {i > 0 && <span className="ltd-role-arrow" aria-hidden="true">⇄</span>}
                  <span className="ltd-role"><span aria-hidden="true">{r.icon}</span>{r.label}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 課程流程：任務前 → 任務中 → 任務後 */}
        <div className="ltd-section">
          <h4 className="ltd-section-title">課程流程</h4>
          <ol className="ltd-flow">
            {LESSON_PHASES.map(p => (
              <li key={p.id} className={`ltd-flow-item ltd-flow-item--${p.id}`}>
                <span className="ltd-flow-label">{p.label}</span>
                <span className="ltd-flow-sub">{p.sub}</span>
                <span className="ltd-flow-desc">
                  {p.id === 'pre' && (pre.questions[0]?.en ?? '觀察場景')}
                  {p.id === 'during' && `${task.steps.length} 個步驟的情境對話`}
                  {p.id === 'post' && (post.questions[0]?.en ?? '討論回顧')}
                </span>
              </li>
            ))}
          </ol>
        </div>

        {/* 任務中的步驟 */}
        <div className="ltd-section">
          <h4 className="ltd-section-title">對話步驟<span className="ltd-section-hint">點步驟可展開台詞</span></h4>
          <ol className="ltd-steps">
            {task.steps.map((step, si) => (
              <li key={step.id} className="ltd-step">
                <details>
                  <summary className="ltd-step-head">
                    <span className="ltd-step-num">{si + 1}</span>
                    <span className="ltd-step-title">{step.title || '未命名步驟'}</span>
                    {step.purpose && <span className="ltd-step-purpose">{step.purpose}</span>}
                    <span className="ltd-step-count">{step.lines.length} 句</span>
                    <span className="ltd-step-chevron material-symbols-outlined" aria-hidden="true">expand_more</span>
                  </summary>
                  <ul className="ltd-lines">
                    {step.lines.length === 0 && <li className="ltd-line-empty">（沒有台詞）</li>}
                    {step.lines.map(l => (
                      <li key={l.id} className="ltd-line">
                        <span className="ltd-line-speaker">{slotLabel(l.speakerSlotId)}</span>
                        <span className="ltd-line-text">
                          <span className="ltd-line-en">{l.en || '（尚未填寫）'}</span>
                          {l.zh && <span className="ltd-line-zh">{l.zh}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
                {step.grammarPoints.filter(Boolean).length > 0 && (
                  <div className="ltd-grammar">
                    {step.grammarPoints.filter(Boolean).map(g => <span key={g} className="ltd-grammar-chip">{g}</span>)}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* 底部動作列 */}
      <footer className="ltd-actions">
        {isActive ? (
          <>
            <span className="ltd-live">上課中</span>
            <span className="ltd-actions-note">這個課程正在進行，進度顯示在左側課程卡片。</span>
            <button className="ltd-end" onClick={onEnd}>
              <span className="material-symbols-outlined" aria-hidden="true">stop_circle</span>結束課程
            </button>
          </>
        ) : (
          <>
            {hasOtherActive && (
              <span className="ltd-actions-note">
                <span className="material-symbols-outlined" aria-hidden="true">info</span>
                開始後會取代目前進行中的課程。
              </span>
            )}
            <button className="ltd-start" onClick={onStart} disabled={task.steps.length === 0}>
              <span className="material-symbols-outlined" aria-hidden="true">play_arrow</span>開始課程
            </button>
          </>
        )}
      </footer>
    </div>
  );
}
