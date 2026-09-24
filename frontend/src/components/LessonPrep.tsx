import { useEffect, useRef, useState } from 'react';
import { THEMES } from '../config/scenes.ts';
import { CEFR_LEVELS, type CefrLevel, type LessonPlanRecord, type LessonPlanSummary } from '../types/lessonPlan.ts';
import { buildSceneContext } from '../utils/sceneContext.ts';
import { generateLessonPlan, listLessonPlans, getLessonPlan, deleteLessonPlan, lessonPlanErrorText } from '../utils/lessonPlanClient.ts';
import type { DialogueTaskRecord, DialogueTaskSummary } from '../types/dialogueTask.ts';
import { listDialogueTasks, getDialogueTask, deleteDialogueTask, dialogueTaskErrorText } from '../utils/dialogueTaskClient.ts';
import LessonPlanView from './LessonPlanView.tsx';
import TaskEditor from './TaskEditor.tsx';
import './LessonPrep.css';

interface LessonPrepProps {
  teacherUid: string;
  institutionId?: string;
  onBack: () => void;
}

type View =
  | { kind: 'list' }
  | { kind: 'form' }
  | { kind: 'generating' }
  | { kind: 'view'; record: LessonPlanRecord }
  /** record 為 null 表示新建空白任務 */
  | { kind: 'task-editor'; record: DialogueTaskRecord | null };

const GENERATING_STEPS = ['規劃大綱與學習目標', '撰寫逐字腳本', '產生任務五階層提示', '整理語法說明與注意點'];

interface NewPlanOption {
  key: 'manual' | 'ai' | 'template';
  icon: string;
  title: string;
  desc: string;
  isNew?: boolean;
  /** 尚未實作的選項先顯示但不可點 */
  comingSoon?: boolean;
}

const NEW_PLAN_OPTIONS: NewPlanOption[] = [
  { key: 'manual', icon: 'add', title: '自己新增任務', desc: '從零開始建立任務對話流程' },
  { key: 'ai', icon: 'auto_awesome', title: 'AI 生成任務', desc: '輸入需求，AI 幫你生成任務劇本', isNew: true },
  { key: 'template', icon: 'inventory_2', title: '從任務庫中選擇模板', desc: '套用現有模板快速建立任務', comingSoon: true },
];

const SCENE_OPTIONS = THEMES.flatMap(t => t.scenes.map(s => ({ id: s.id, label: `${t.label}／${s.label}` })));

export default function LessonPrep({ teacherUid, institutionId, onBack }: LessonPrepProps) {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [plans, setPlans] = useState<LessonPlanSummary[]>([]);
  const [tasks, setTasks] = useState<DialogueTaskSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sceneId, setSceneId] = useState<string>(SCENE_OPTIONS[0]?.id ?? '');
  const [topic, setTopic] = useState('');
  const [level, setLevel] = useState<CefrLevel>('A1');
  const [stepIdx, setStepIdx] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const refresh = () =>
    listLessonPlans(teacherUid).then(setPlans).catch(e => setError(lessonPlanErrorText(e)));
  const refreshTasks = () =>
    listDialogueTasks(teacherUid).then(setTasks).catch(e => setError(dialogueTaskErrorText(e)));

  useEffect(() => { void refresh(); void refreshTasks(); }, [teacherUid]); // eslint-disable-line react-hooks/exhaustive-deps

  // 生成中：固定文案輪播，不是真實進度
  useEffect(() => {
    if (view.kind !== 'generating') return;
    const t = setInterval(() => setStepIdx(i => Math.min(i + 1, GENERATING_STEPS.length - 1)), 8000);
    return () => clearInterval(t);
  }, [view.kind]);

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
    if (key === 'ai') setView({ kind: 'form' });
    else if (key === 'manual') setView({ kind: 'task-editor', record: null });
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

  const handleGenerate = async () => {
    const trimmed = topic.trim();
    if (!trimmed) { setError('請輸入主題'); return; }
    const sceneContext = buildSceneContext(sceneId);
    if (!sceneContext) { setError('找不到所選場景'); return; }
    setError(null);
    setStepIdx(0);
    setView({ kind: 'generating' });
    try {
      const record = await generateLessonPlan({ teacherUid, institutionId, sceneId, sceneContext, topic: trimmed, level });
      setView({ kind: 'view', record });
      void refresh();
    } catch (e) {
      setError(lessonPlanErrorText(e));
      setView({ kind: 'form' }); // 表單內容保留
    }
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

      {view.kind === 'generating' && (
        <div className="lp-generating">
          <div className="gradient-spinner" />
          <p>{GENERATING_STEPS[stepIdx]}…</p>
          <p className="lp-hint-text">通常需要 20 到 60 秒</p>
        </div>
      )}

      {view.kind === 'form' && (
        <div className="lp-card lp-form">
          <label>場景
            <select value={sceneId} onChange={e => setSceneId(e.target.value)}>
              {SCENE_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
          <label>主題
            <input value={topic} maxLength={200} placeholder="例：退換貨與退款" onChange={e => setTopic(e.target.value)} />
          </label>
          <label>學生程度
            <select value={level} onChange={e => setLevel(e.target.value as CefrLevel)}>
              {CEFR_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </label>
          <div className="lp-form-actions">
            <button className="lp-btn-ghost" onClick={() => setView({ kind: 'list' })}>取消</button>
            <button className="lp-btn-primary" onClick={handleGenerate}>生成教案</button>
          </div>
        </div>
      )}

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
                    disabled={o.comingSoon}
                    onClick={() => handleNewOption(o.key)}
                  >
                    <span className="lp-new-option-icon material-symbols-outlined" aria-hidden="true">{o.icon}</span>
                    <span className="lp-new-option-text">
                      <span className="lp-new-option-title">{o.title}</span>
                      <span className="lp-new-option-desc">{o.comingSoon ? '即將推出' : o.desc}</span>
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
                      <span className="lp-list-meta">{t.level}｜{t.stepCount} 個步驟｜{new Date(t.updatedAt).toLocaleDateString()}</span>
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
                    <span className="lp-list-meta">{p.level}｜{p.topic}｜{new Date(p.updatedAt).toLocaleDateString()}</span>
                  </button>
                  <button className="lp-btn-danger" onClick={() => { void handleDelete(p.id); }}>刪除</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
