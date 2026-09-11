import { useEffect, useState } from 'react';
import { listLessonPlans } from '../utils/lessonPlanClient.ts';
import type { LessonPlanSummary } from '../types/lessonPlan.ts';
import './TeacherHome.css';

interface TeacherHomeProps {
  teacherName: string;
  teacherUid: string;
  onPrep: () => void;
  /** planId 為 undefined 表示不帶教案上課 */
  onStart: (planId?: string) => void;
  onLogout: () => void;
}

export default function TeacherHome({ teacherName, teacherUid, onPrep, onStart, onLogout }: TeacherHomeProps) {
  const [plans, setPlans] = useState<LessonPlanSummary[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listLessonPlans(teacherUid)
      .then(list => { if (!cancelled) setPlans(list); })
      .catch(() => { if (!cancelled) setLoadError('無法載入教案清單，仍可直接開始上課'); });
    return () => { cancelled = true; };
  }, [teacherUid]);

  const handleStart = () => {
    if (starting) return;
    setStarting(true);
    onStart(selectedPlanId || undefined);
  };

  return (
    <div className="teacher-home-screen">
      <button className="teacher-home-logout-btn" onClick={onLogout}>
        <span className="material-symbols-outlined">logout</span> 登出
      </button>
      <div className="teacher-home-container">
        <h1 className="teacher-home-title">
          <span className="title-orange">Live</span> <span className="title-teal">MR</span>
        </h1>
        <p className="teacher-home-greeting">{teacherName} 老師，今天要做什麼？</p>

        <div className="teacher-home-cards">
          <button className="teacher-home-card" onClick={onPrep}>
            <span className="material-symbols-outlined teacher-home-card-icon">edit_note</span>
            <span className="teacher-home-card-title">備課</span>
            <span className="teacher-home-card-desc">一鍵生成 15 分鐘微教案與任務包</span>
          </button>

          <div className="teacher-home-card teacher-home-card-static">
            <span className="material-symbols-outlined teacher-home-card-icon">play_circle</span>
            <span className="teacher-home-card-title">開始上課</span>
            <select
              className="teacher-home-select"
              value={selectedPlanId}
              onChange={e => setSelectedPlanId(e.target.value)}
            >
              <option value="">不使用教案</option>
              {plans.map(p => (
                <option key={p.id} value={p.id}>{p.title}（{p.level}）</option>
              ))}
            </select>
            {loadError && <span className="teacher-home-error">{loadError}</span>}
            <button className="teacher-home-start-btn" onClick={handleStart} disabled={starting}>
              {starting ? '建立房間中…' : '建立房間'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
