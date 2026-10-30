import { useEffect, useState } from 'react';
import { getLessonPlan, listLessonPlans } from '../utils/lessonPlanClient.ts';
import { getDialogueTask, listDialogueTasks } from '../utils/dialogueTaskClient.ts';
import { levelLabel, type LessonPlanSummary } from '../types/lessonPlan.ts';
import type { DialogueTaskSummary } from '../types/dialogueTask.ts';
import { THEMES } from '../config/scenes.ts';
import AccountMenu from './AccountMenu.tsx';
import './TeacherHome.css';

/** 開課時帶入的內容：「我的任務」或舊版 AI 教案；都沒有表示直接上課 */
export interface StartSelection {
  taskId?: string;
  planId?: string;
}

interface TeacherHomeProps {
  teacherName: string;
  teacherUid: string;
  onPrep: () => void;
  onStart: (selection: StartSelection) => void;
  onLogout: () => void;
}

/** 預覽清單的一組：任務只有一組（步驟），舊版教案依模組分組 */
interface PreviewGroup {
  key: string;
  heading: string;
  items: { key: string; label: string }[];
}

function sceneLabel(sceneId: string): string {
  for (const theme of THEMES) {
    const scene = theme.scenes.find(s => s.id === sceneId);
    if (scene) return `${theme.label}・${scene.label}`;
  }
  return sceneId;
}

export default function TeacherHome({ teacherName, teacherUid, onPrep, onStart, onLogout }: TeacherHomeProps) {
  const [tasks, setTasks] = useState<DialogueTaskSummary[]>([]);
  const [plans, setPlans] = useState<LessonPlanSummary[]>([]);
  /** 下拉值：'task:<id>'、'plan:<id>' 或 ''（不帶內容） */
  const [selected, setSelected] = useState<string>('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  /** 選定內容的預覽；null 表示載入中或未選 */
  const [preview, setPreview] = useState<PreviewGroup[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([listDialogueTasks(teacherUid), listLessonPlans(teacherUid)])
      .then(([taskRes, planRes]) => {
        if (cancelled) return;
        if (taskRes.status === 'fulfilled') setTasks(taskRes.value);
        if (planRes.status === 'fulfilled') setPlans(planRes.value);
        if (taskRes.status === 'rejected') setLoadError('無法載入任務清單，仍可直接開始上課');
      });
    return () => { cancelled = true; };
  }, [teacherUid]);

  useEffect(() => {
    if (!selected) return;
    const [kind, id] = [selected.slice(0, selected.indexOf(':')), selected.slice(selected.indexOf(':') + 1)];
    let cancelled = false;
    const load: Promise<PreviewGroup[]> = kind === 'task'
      ? getDialogueTask(id).then(rec => [{
        key: rec.id,
        heading: `🎬 ${sceneLabel(rec.task.sceneId)}`,
        items: rec.task.steps.map(st => ({ key: st.id, label: st.purpose ? `${st.title}（${st.purpose}）` : st.title })),
      }])
      : getLessonPlan(id).then(rec => rec.plan.modules.map(m => ({
        key: m.id,
        heading: `${m.icon} ${m.label}`,
        items: m.tasks.map(t => ({ key: t.id, label: t.label })),
      })));
    load
      .then(groups => { if (!cancelled) setPreview(groups); })
      .catch(() => { if (!cancelled) setPreviewError('無法載入任務內容'); });
    return () => { cancelled = true; };
  }, [selected]);

  const handleStart = () => {
    if (starting) return;
    setStarting(true);
    const id = selected.slice(selected.indexOf(':') + 1);
    onStart(selected.startsWith('task:') ? { taskId: id } : selected.startsWith('plan:') ? { planId: id } : {});
  };

  return (
    <div className="th-screen">
      <div className="th-deco" aria-hidden="true">
        <span className="th-blob-left" />
        <span className="th-circle-small" />
        <span className="th-circle-hatch" />
        <span className="th-blob-right" />
        <span className="th-dots" />
      </div>

      <header className="th-top">
        <div className="hs-brand th-brand">
          <div className="hs-brand-logo-wrapper">
            <img src="/logo.webp" alt="Logo" />
          </div>
          <span className="hs-brand-title"><span className="orange">MR</span> <span className="teal">雙語角</span></span>
          <Spark className="th-brand-spark" />
        </div>
        <div className="th-account">
          <AccountMenu onLogout={onLogout} />
        </div>
      </header>

      <main className="th-main">
        <div className="th-hero">
          <MegaphoneIcon />
          <h1 className="th-title"><span className="th-orange">Live</span> <span className="th-teal">MR</span></h1>
          <Spark className="th-hero-spark" />
        </div>
        <p className="th-greeting">{teacherName} 老師，今天要做什麼？</p>

        <div className="th-cards">
          <button className="th-card th-card-prep" onClick={onPrep}>
            <span className="th-card-art">
              <ClipboardIcon />
              <Spark className="th-card-spark" />
            </span>
            <span className="th-pill th-pill-orange">備課</span>
            <span className="th-card-desc">一鍵生成 15 分鐘微教案與任務包</span>
            <span className="th-card-go material-symbols-outlined" aria-hidden="true">chevron_right</span>
          </button>

          <div className="th-card th-card-class">
            <span className="th-card-art">
              <PlayIcon />
              <Spark className="th-card-spark" />
            </span>
            <span className="th-pill th-pill-teal">開始上課</span>
            <select
              className="th-select"
              value={selected}
              onChange={e => { setSelected(e.target.value); setPreview(null); setPreviewError(null); }}
              aria-label="選擇任務"
            >
              <option value="">不選擇任務，直接上課</option>
              {tasks.length > 0 && (
                <optgroup label="我的任務">
                  {tasks.map(t => (
                    <option key={t.id} value={`task:${t.id}`}>
                      {t.title}（{levelLabel(t.level, true)}・{t.stepCount} 步）
                    </option>
                  ))}
                </optgroup>
              )}
              {plans.length > 0 && (
                <optgroup label="舊版 AI 教案">
                  {plans.map(p => (
                    <option key={p.id} value={`plan:${p.id}`}>{p.title}（{levelLabel(p.level, true)}）</option>
                  ))}
                </optgroup>
              )}
            </select>
            {loadError && <span className="th-error">{loadError}</span>}
            {selected && (
              <div className="th-tasks" aria-label="任務內容" aria-live="polite">
                {previewError
                  ? <span className="th-error">{previewError}</span>
                  : preview === null
                    ? <span className="th-tasks-hint">載入中…</span>
                    : preview.every(g => g.items.length === 0)
                      ? <span className="th-tasks-hint">沒有任何步驟</span>
                      : preview.map(g => (
                        <section key={g.key} className="th-task-module">
                          <h3>{g.heading}</h3>
                          <ol>
                            {g.items.map(it => <li key={it.key}>{it.label}</li>)}
                          </ol>
                        </section>
                      ))}
              </div>
            )}
            <button className="th-start-btn" onClick={handleStart} disabled={starting}>
              <span className="material-symbols-outlined" aria-hidden="true">play_circle</span>
              {starting ? '建立房間中…' : '建立房間'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

/** 標題旁的黃色小閃光（三道短線） */
function Spark({ className }: { className?: string }) {
  return (
    <svg className={`th-spark ${className ?? ''}`} viewBox="0 0 24 32" width="24" height="32" aria-hidden="true">
      <path d="M14 5 L9 11 M19 14 L11 16.5 M15 25 L10 22" stroke="#FFC93C" strokeWidth="3.4" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** 大聲公 */
function MegaphoneIcon() {
  return (
    <svg className="th-megaphone" viewBox="0 0 80 72" width="80" height="72" aria-hidden="true">
      <path d="M14 30 h12 l34 -18 v48 l-34 -18 h-12 a6 6 0 0 1 -6 -6 v0 a6 6 0 0 1 6 -6 z" fill="#FF8A3D" />
      <path d="M26 30 l34 -18 v48 l-34 -18 z" fill="#F76E12" />
      <rect x="58" y="10" width="10" height="52" rx="5" fill="#FFB547" />
      <path d="M20 46 l6 16 a4 4 0 0 0 7 -3 l-4 -13 z" fill="#E2580B" />
      <ellipse cx="17" cy="36" rx="5" ry="6" fill="#FFD9B8" />
    </svg>
  );
}

/** 寫字板與鉛筆 */
function ClipboardIcon() {
  return (
    <svg viewBox="0 0 84 84" width="84" height="84" aria-hidden="true">
      <rect x="10" y="10" width="54" height="66" rx="10" fill="#8C7BEF" />
      <rect x="15" y="15" width="44" height="56" rx="7" fill="#F3F0FF" />
      <rect x="26" y="5" width="22" height="12" rx="4" fill="#5B47C9" />
      <rect x="31" y="8" width="12" height="4" rx="2" fill="#B9AEF8" />
      <rect x="22" y="28" width="28" height="4.5" rx="2.2" fill="#6E5BDC" />
      <rect x="22" y="39" width="22" height="4.5" rx="2.2" fill="#6E5BDC" />
      <rect x="22" y="50" width="16" height="4.5" rx="2.2" fill="#6E5BDC" />
      <g transform="rotate(40 60 50)">
        <rect x="54" y="22" width="12" height="44" rx="3" fill="#FF9F3D" />
        <rect x="54" y="22" width="12" height="8" rx="3" fill="#F56B8A" />
        <rect x="54" y="29" width="12" height="3" fill="#D9D9E6" />
        <path d="M54 66 l6 11 l6 -11 z" fill="#FFE1B8" />
        <path d="M58.2 73.6 l1.8 3.4 l1.8 -3.4 z" fill="#4B3B2B" />
      </g>
    </svg>
  );
}

/** 播放圓鈕 */
function PlayIcon() {
  return (
    <svg viewBox="0 0 84 84" width="84" height="84" aria-hidden="true">
      <circle cx="42" cy="42" r="38" fill="#14A89B" />
      <circle cx="42" cy="42" r="30" fill="#2BC0B1" stroke="#0E8378" strokeWidth="3" />
      <path d="M35 28 L58 42 L35 56 Z" fill="#fff" stroke="#0E8378" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}
