import { useEffect, useRef, useState } from 'react';
import { levelLabel, type LessonPlanRecord, type LessonPlanSummary } from '../types/lessonPlan.ts';
import { listLessonPlans, getLessonPlan, deleteLessonPlan, lessonPlanErrorText } from '../utils/lessonPlanClient.ts';
import type { DialogueTask, DialogueTaskRecord, DialogueTaskSummary } from '../types/dialogueTask.ts';
import { listDialogueTasks, getDialogueTask, deleteDialogueTask, dialogueTaskErrorText } from '../utils/dialogueTaskClient.ts';
import LessonPlanView from './LessonPlanView.tsx';
import TaskEditor from './TaskEditor.tsx';
import TemplateLibrary from './TemplateLibrary.tsx';
import AiGenerateModal from './AiGenerateModal.tsx';
import { applyTemplate, type TaskTemplate } from '../config/taskTemplates/index.ts';
import './LessonPrep.css';

interface LessonPrepProps {
  teacherUid: string;
  institutionId?: string;
  onBack: () => void;
}

type View =
  | { kind: 'list' }
  | { kind: 'view'; record: LessonPlanRecord }
  /** record 為 null 表示新建空白任務 */
  | { kind: 'task-editor'; record: DialogueTaskRecord | null; draft?: DialogueTask };

interface NewPlanOption {
  key: 'manual' | 'ai' | 'template';
  icon: string;
  title: string;
  desc: string;
  isNew?: boolean;
}

const NEW_PLAN_OPTIONS: NewPlanOption[] = [
  { key: 'manual', icon: 'add', title: '自己新增任務', desc: '從零開始建立任務對話流程' },
  { key: 'ai', icon: 'auto_awesome', title: 'AI 生成任務', desc: '輸入需求，AI 幫你生成任務劇本', isNew: true },
  { key: 'template', icon: 'inventory_2', title: '從任務庫中選擇模板', desc: '套用現有模板快速建立任務' },
];

export default function LessonPrep({ teacherUid, institutionId, onBack }: LessonPrepProps) {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [plans, setPlans] = useState<LessonPlanSummary[]>([]);
  const [tasks, setTasks] = useState<DialogueTaskSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  /** 等待確認的刪除對象 */
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const refresh = () =>
    listLessonPlans(teacherUid).then(setPlans).catch(e => setError(lessonPlanErrorText(e)));
  const refreshTasks = () =>
    listDialogueTasks(teacherUid).then(setTasks).catch(e => setError(dialogueTaskErrorText(e)));

  useEffect(() => { void refresh(); void refreshTasks(); }, [teacherUid]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNewOption = (key: NewPlanOption['key']) => {
    if (key === 'ai') setAiOpen(true);
    else if (key === 'manual') setView({ kind: 'task-editor', record: null });
    else setLibraryOpen(true);
  };

  const handleApplyTemplate = (template: TaskTemplate) => {
    setLibraryOpen(false);
    setView({ kind: 'task-editor', record: null, draft: applyTemplate(template) });
  };

  const handleOpenTask = async (id: string) => {
    setError(null);
    try { setView({ kind: 'task-editor', record: await getDialogueTask(id) }); }
    catch (e) { setError(dialogueTaskErrorText(e)); }
  };


  // AI 草稿與套用模板相同：開啟編輯器，老師確認後按儲存才寫入「我的任務」
  const handleGenerated = (task: DialogueTask) => {
    setAiOpen(false);
    setView({ kind: 'task-editor', record: null, draft: task });
  };

  const handleOpen = async (id: string) => {
    setError(null);
    try { setView({ kind: 'view', record: await getLessonPlan(id) }); }
    catch (e) { setError(lessonPlanErrorText(e)); }
  };

  /** 確認視窗按下「刪除」後執行；失敗時拋出錯誤文字，讓視窗留著顯示 */
  const confirmDelete = async (target: PendingDelete) => {
    setError(null);
    if (target.kind === 'task') {
      try { await deleteDialogueTask(target.id); }
      catch (e) { throw new Error(dialogueTaskErrorText(e)); }
      await refreshTasks();
    } else {
      try { await deleteLessonPlan(target.id); }
      catch (e) { throw new Error(lessonPlanErrorText(e)); }
      await refresh();
    }
    setPendingDelete(null);
  };

  if (view.kind === 'task-editor') {
    return (
      <TaskEditor
        teacherUid={teacherUid}
        institutionId={institutionId}
        initial={view.record}
        initialTask={view.draft}
        onSaved={() => { void refreshTasks(); }}
        onClose={() => setView({ kind: 'list' })}
      />
    );
  }

  if (view.kind === 'view') {
    return (
      <div className="lp-screen">
        <LessonPlanView
          record={view.record}
          onSaved={rec => { setView({ kind: 'view', record: rec }); void refresh(); }}
          onBack={() => setView({ kind: 'list' })}
        />
      </div>
    );
  }

  const hasAnything = tasks.length > 0 || plans.length > 0;

  return (
    <div className="lpl-page">
      <div className="lpl-deco-top" aria-hidden="true" />

      <header className="lpl-top">
        {/* <button className="lpl-back" onClick={onBack}>
          <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>回主畫面
        </button> */}
        <div className="lpl-heading">
          {/* <span className="lpl-heading-icon material-symbols-outlined" aria-hidden="true">inventory_2</span> */}
          <div className="hs-brand-logo-wrapper">
            <img src="/logo.webp" alt="Logo" />
          </div>
          <h1><span className="orange">備課</span><span className="teal">中心</span></h1>
          <p>豐富的任務資源，讓教學更輕鬆</p>
        </div>
        <NewPlanMenuButton align="right" onSelect={handleNewOption} />
      </header>

      {error && <div className="lpl-error" role="alert">{error}</div>}

      <main className="lpl-panel">
        <div className="lpl-panel-deco" aria-hidden="true">
          <span className="lpl-blob-orange" />
          <span className="lpl-blob-teal" />
          <span className="lpl-dot-teal" />
          <span className="lpl-dots" />
        </div>

        <div className="lpl-panel-body">
          {tasks.length > 0 && (
            <section aria-label="我的任務">
              <ul className="lpl-list">
                {tasks.map(t => (
                  <li key={t.id} className="lpl-item">
                    <button className="lpl-item-main" onClick={() => { void handleOpenTask(t.id); }}>
                      <TaskTileIcon />
                      <span className="lpl-item-text">
                        <span className="lpl-item-title">{t.title}</span>
                        <span className="lpl-item-meta">
                          <span className="material-symbols-outlined" aria-hidden="true">person</span>
                          {levelLabel(t.level, true)}
                          <span className="lpl-sep" aria-hidden="true">|</span>
                          {t.stepCount} 個步驟
                          <span className="lpl-sep" aria-hidden="true">|</span>
                          {new Date(t.updatedAt).toLocaleDateString()}
                        </span>
                      </span>
                    </button>
                    <button className="lpl-delete" onClick={() => setPendingDelete({ kind: 'task', id: t.id, title: t.title })} aria-label={`刪除「${t.title}」`}>
                      <span className="material-symbols-outlined" aria-hidden="true">delete</span><span className="lpl-delete-text">刪除</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {plans.length > 0 ? (
            <section aria-label="AI 教案">
              <h2 className="lpl-section-title">AI 教案</h2>
              <ul className="lpl-list">
                {plans.map(p => (
                  <li key={p.id} className="lpl-item">
                    <button className="lpl-item-main" onClick={() => { void handleOpen(p.id); }}>
                      <span className="lpl-tile lpl-tile-ai material-symbols-outlined" aria-hidden="true">auto_awesome</span>
                      <span className="lpl-item-text">
                        <span className="lpl-item-title">{p.title}</span>
                        <span className="lpl-item-meta">
                          <span className="material-symbols-outlined" aria-hidden="true">person</span>
                          {levelLabel(p.level, true)}
                          <span className="lpl-sep" aria-hidden="true">|</span>
                          {p.topic}
                          <span className="lpl-sep" aria-hidden="true">|</span>
                          {new Date(p.updatedAt).toLocaleDateString()}
                        </span>
                      </span>
                    </button>
                    <button className="lpl-delete" onClick={() => setPendingDelete({ kind: 'plan', id: p.id, title: p.title })} aria-label={`刪除「${p.title}」`}>
                      <span className="material-symbols-outlined" aria-hidden="true">delete</span><span className="lpl-delete-text">刪除</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <section className="lpl-empty">
              <EmptyIllustration />
              <h2>{hasAnything ? 'AI 教案' : '開始建立第一份教案'}</h2>
              <p>還沒有教案，按「新建教案」開始。</p>
              <NewPlanMenuButton align="center" size="large" onSelect={handleNewOption} />
            </section>
          )}
        </div>
      </main>

      {libraryOpen && <TemplateLibrary onApply={handleApplyTemplate} onClose={() => setLibraryOpen(false)} />}
      {pendingDelete && (
        <ConfirmDeleteModal
          target={pendingDelete}
          onConfirm={() => confirmDelete(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      {aiOpen && (
        <AiGenerateModal
          onGenerated={handleGenerated}
          onClose={() => setAiOpen(false)}
        />
      )}
    </div>
  );
}

interface PendingDelete {
  kind: 'task' | 'plan';
  id: string;
  title: string;
}

interface ConfirmDeleteModalProps {
  target: PendingDelete;
  /** 失敗時 reject，錯誤訊息顯示在視窗裡 */
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

/** 刪除前的確認視窗；預設焦點在「取消」，Esc / 點背景 = 取消 */
function ConfirmDeleteModal({ target, onConfirm, onCancel }: ConfirmDeleteModalProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !deleting) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleting, onCancel]);

  const handleConfirm = async () => {
    setDeleting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  };

  const kindLabel = target.kind === 'task' ? '任務' : '教案';
  return (
    <div className="lpl-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !deleting) onCancel(); }}>
      <div className="lpl-modal" role="alertdialog" aria-modal="true" aria-labelledby="lpl-del-title" aria-describedby="lpl-del-desc">
        <span className="lpl-modal-icon material-symbols-outlined" aria-hidden="true">delete</span>
        <h2 id="lpl-del-title" className="lpl-modal-title">刪除這個{kindLabel}？</h2>
        <p id="lpl-del-desc" className="lpl-modal-desc">
          「<strong>{target.title}</strong>」刪除後就無法復原。
        </p>
        {error && <p className="lpl-modal-error" role="alert">{error}</p>}
        <div className="lpl-modal-actions">
          <button className="lpl-modal-cancel" onClick={onCancel} disabled={deleting} autoFocus>取消</button>
          <button className="lpl-modal-danger" onClick={() => { void handleConfirm(); }} disabled={deleting}>
            <span className="material-symbols-outlined" aria-hidden="true">delete</span>{deleting ? '刪除中…' : '刪除'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface NewPlanMenuButtonProps {
  onSelect: (key: NewPlanOption['key']) => void;
  /** 選單對齊：右上角按鈕靠右、空狀態按鈕置中 */
  align: 'right' | 'center';
  size?: 'normal' | 'large';
}

/** 「＋ 新建教案」按鈕與三選項選單；點選單外或按 Esc 關閉 */
function NewPlanMenuButton({ onSelect, align, size = 'normal' }: NewPlanMenuButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={`lp-new-wrap lp-new-wrap--${align}`} ref={ref}>
      <button
        className={`lpl-btn-new${size === 'large' ? ' lpl-btn-new--large' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <span className="material-symbols-outlined" aria-hidden="true">add</span>新建教案
      </button>
      {open && (
        <div className="lp-new-menu" role="menu">
          {NEW_PLAN_OPTIONS.map(o => (
            <button
              key={o.key}
              role="menuitem"
              className={`lp-new-option lp-new-option--${o.key}`}
              onClick={() => { setOpen(false); onSelect(o.key); }}
            >
              <span className="lp-new-option-icon material-symbols-outlined" aria-hidden="true">{o.icon}</span>
              <span className="lp-new-option-text">
                <span className="lp-new-option-title">{o.title}</span>
                <span className="lp-new-option-desc">{o.desc}</span>
              </span>
              {o.isNew && <span className="lp-new-badge">NEW</span>}
              <span className="lp-new-option-chevron material-symbols-outlined" aria-hidden="true">chevron_right</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 任務卡片左側的圖示：兩張疊起的卡片＋笑臉 */
function TaskTileIcon() {
  return (
    <span className="lpl-tile" aria-hidden="true">
      <svg viewBox="0 0 48 48" width="34" height="34">
        <rect x="14" y="7" width="24" height="30" rx="5" fill="#FFB27A" stroke="#E2661A" strokeWidth="2" />
        <rect x="9" y="12" width="24" height="30" rx="5" fill="#FFF4E8" stroke="#E2661A" strokeWidth="2" />
        <circle cx="21" cy="27" r="6.5" fill="#FFB547" />
        <circle cx="19" cy="25.8" r="0.9" fill="#7A3A0E" />
        <circle cx="23" cy="25.8" r="0.9" fill="#7A3A0E" />
        <path d="M18.6 28.4 q2.4 2.2 4.8 0" fill="none" stroke="#7A3A0E" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/** 空狀態插圖：資料夾裡有一張笑臉任務卡，旁邊點綴星星 */
function EmptyIllustration() {
  return (
    <svg className="lpl-empty-art" viewBox="0 0 240 190" width="220" height="174" aria-hidden="true">
      <defs>
        <radialGradient id="lplGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFE3CC" />
          <stop offset="100%" stopColor="#FFF4EA" stopOpacity="0.2" />
        </radialGradient>
        <linearGradient id="lplFolder" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FF9A4D" />
          <stop offset="100%" stopColor="#F2701C" />
        </linearGradient>
        <linearGradient id="lplFolderFront" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFC08F" />
          <stop offset="100%" stopColor="#FFAA6B" />
        </linearGradient>
      </defs>
      <circle cx="120" cy="96" r="80" fill="url(#lplGlow)" />
      <ellipse cx="120" cy="168" rx="58" ry="7" fill="#F6D9C2" opacity="0.7" />
      <rect x="86" y="30" width="62" height="40" rx="6" fill="#FFD8B8" transform="rotate(-8 117 50)" />
      <rect x="78" y="58" width="92" height="74" rx="10" fill="url(#lplFolder)" transform="rotate(-6 124 95)" />
      <rect x="92" y="62" width="60" height="62" rx="8" fill="#FFF8F1" transform="rotate(-6 122 93)" />
      <rect x="100" y="76" width="22" height="4" rx="2" fill="#F5C9A6" transform="rotate(-6 111 78)" />
      <rect x="100" y="86" width="16" height="4" rx="2" fill="#F5C9A6" transform="rotate(-6 108 88)" />
      <circle cx="132" cy="96" r="12" fill="#FFB547" />
      <circle cx="128" cy="94" r="1.6" fill="#7A3A0E" />
      <circle cx="136" cy="93" r="1.6" fill="#7A3A0E" />
      <path d="M127 99 q5 4 10 -1" fill="none" stroke="#7A3A0E" strokeWidth="2" strokeLinecap="round" />
      <path d="M72 110 h104 l-8 46 a8 8 0 0 1 -8 7 h-72 a8 8 0 0 1 -8 -7 z" fill="url(#lplFolderFront)" />
      <path d="M190 20 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3 z" fill="#F7913D" />
      <path d="M186 140 l2.4 6 6 2.4 -6 2.4 -2.4 6 -2.4 -6 -6 -2.4 6 -2.4 z" fill="#F7913D" />
      <path d="M50 116 l2.6 6.4 6.4 2.6 -6.4 2.6 -2.6 6.4 -2.6 -6.4 -6.4 -2.6 6.4 -2.6 z" fill="#5CC9BC" />
      <rect x="198" y="72" width="9" height="9" rx="2" fill="#D9D5E8" transform="rotate(45 202 76)" />
      <circle cx="68" cy="146" r="3" fill="#F6CDB0" />
    </svg>
  );
}
