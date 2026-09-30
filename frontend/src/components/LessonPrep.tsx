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
  const [menuOpen, setMenuOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const refresh = () =>
    listLessonPlans(teacherUid).then(setPlans).catch(e => setError(lessonPlanErrorText(e)));
  const refreshTasks = () =>
    listDialogueTasks(teacherUid).then(setTasks).catch(e => setError(dialogueTaskErrorText(e)));

  useEffect(() => { void refresh(); void refreshTasks(); }, [teacherUid]); // eslint-disable-line react-hooks/exhaustive-deps

  // 新建選單：點選單外或按 Esc 關閉
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const handleNewOption = (key: NewPlanOption['key']) => {
    setMenuOpen(false);
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

  const handleDeleteTask = async (id: string) => {
    setError(null);
    try { await deleteDialogueTask(id); await refreshTasks(); }
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

  const handleDelete = async (id: string) => {
    setError(null);
    try { await deleteLessonPlan(id); await refresh(); }
    catch (e) { setError(lessonPlanErrorText(e)); }
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

  return (
    <div className="lp-screen">
      <div className="lp-header">
        <button className="lp-btn-ghost" onClick={onBack}>← 回主畫面</button>
        <h1>備課</h1>
      </div>
      {error && <div className="lp-error">{error}</div>}

      {view.kind === 'list' && (
        <>
          <div className="lp-new-wrap" ref={menuRef}>
            <button
              className="lp-btn-primary lp-new-btn"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(o => !o)}
            >＋ 新建教案</button>
            {menuOpen && (
              <div className="lp-new-menu" role="menu">
                {NEW_PLAN_OPTIONS.map(o => (
                  <button
                    key={o.key}
                    role="menuitem"
                    className={`lp-new-option lp-new-option--${o.key}`}
                    onClick={() => handleNewOption(o.key)}
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
          {tasks.length > 0 && (
            <>
              <h2 className="lp-section-title">我的任務</h2>
              <ul className="lp-list">
                {tasks.map(t => (
                  <li key={t.id} className="lp-list-item">
                    <button className="lp-list-main" onClick={() => { void handleOpenTask(t.id); }}>
                      <span className="lp-list-title">{t.title}</span>
                      <span className="lp-list-meta">{levelLabel(t.level, true)}｜{t.stepCount} 個步驟｜{new Date(t.updatedAt).toLocaleDateString()}</span>
                    </button>
                    <button className="lp-btn-danger" onClick={() => { void handleDeleteTask(t.id); }}>刪除</button>
                  </li>
                ))}
              </ul>
              <h2 className="lp-section-title">AI 教案</h2>
            </>
          )}
          {plans.length === 0 ? (
            <p className="lp-hint-text">還沒有教案，按「新建教案」開始。</p>
          ) : (
            <ul className="lp-list">
              {plans.map(p => (
                <li key={p.id} className="lp-list-item">
                  <button className="lp-list-main" onClick={() => { void handleOpen(p.id); }}>
                    <span className="lp-list-title">{p.title}</span>
                    <span className="lp-list-meta">{levelLabel(p.level, true)}｜{p.topic}｜{new Date(p.updatedAt).toLocaleDateString()}</span>
                  </button>
                  <button className="lp-btn-danger" onClick={() => { void handleDelete(p.id); }}>刪除</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {libraryOpen && <TemplateLibrary onApply={handleApplyTemplate} onClose={() => setLibraryOpen(false)} />}
      {aiOpen && (
        <AiGenerateModal
          onGenerated={handleGenerated}
          onClose={() => setAiOpen(false)}
        />
      )}
    </div>
  );
}
