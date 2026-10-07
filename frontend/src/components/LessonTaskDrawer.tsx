/**
 * 導師任務管理抽屜：只負責挑任務。列出老師「我的任務」中與目前場景相符的對話任務，
 * 點一下就載入（抽屜關閉），各步驟顯示在 HostSession 左側側欄，依序點擊標記完成。
 */
import { useEffect, useState } from 'react';
import type { DialogueTaskRecord, DialogueTaskSummary } from '../types/dialogueTask.ts';
import { getDialogueTask, listDialogueTasks, dialogueTaskErrorText } from '../utils/dialogueTaskClient.ts';
import { levelLabel } from '../types/lessonPlan.ts';
import './LessonTaskDrawer.css';

interface LessonTaskDrawerProps {
  open: boolean;
  onClose: () => void;
  teacherUid: string | null;
  sceneId: string;
  sceneLabel: string;
  /** 目前上課中的任務 id（沒有則為 null） */
  activeTaskId: string | null;
  /** 選中任務：載入到左側並關閉抽屜 */
  onSelect: (record: DialogueTaskRecord) => void;
  onEnd: () => void;
}

export default function LessonTaskDrawer({
  open, onClose, teacherUid, sceneId, sceneLabel, activeTaskId, onSelect, onEnd,
}: LessonTaskDrawerProps) {
  const [tasks, setTasks] = useState<DialogueTaskSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  // 每次打開抽屜重新讀清單（老師可能剛在備課中心新增任務）
  useEffect(() => {
    if (!open || !teacherUid) return;
    let cancelled = false;
    listDialogueTasks(teacherUid)
      .then(list => { if (!cancelled) { setTasks(list); setError(null); } })
      .catch(e => { if (!cancelled) setError(dialogueTaskErrorText(e)); });
    return () => { cancelled = true; };
  }, [open, teacherUid]);

  const sceneTasks = (tasks ?? []).filter(t => t.sceneId === sceneId);

  const select = async (id: string) => {
    if (id === activeTaskId) { onClose(); return; }
    setLoadingId(id);
    setError(null);
    try {
      onSelect(await getDialogueTask(id));
      onClose();
    } catch (e) {
      setError(dialogueTaskErrorText(e));
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className={`panel-drawer ${open ? 'panel-drawer--open' : ''}`}>
      <div className="panel-drawer-header">
        <div className="slot-drawer-title">
          <span className="orange">課程管理</span> <span className="teal">LESSON</span>
        </div>
        <button className="panel-close-btn" onClick={onClose}>
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      <div className="panel-drawer-body ltd-body">
        {error && <div className="ltd-error" role="alert">{error}</div>}

        <p className="ltd-scene">
          <span className="material-symbols-outlined" aria-hidden="true">storefront</span>
          目前場景：<strong>{sceneLabel}</strong>
        </p>
        <p className="ltd-hint">選擇任務後，各步驟會顯示在左側，依序點擊標記完成。</p>

        {!teacherUid ? (
          <p className="ltd-empty">請先登入老師帳號。</p>
        ) : tasks === null && !error ? (
          <p className="ltd-empty">載入中…</p>
        ) : sceneTasks.length === 0 ? (
          <p className="ltd-empty">這個場景還沒有任務。<br />請先到備課中心建立或套用任務並儲存。</p>
        ) : (
          <ul className="ltd-list">
            {sceneTasks.map(t => {
              const isActive = t.id === activeTaskId;
              return (
                <li key={t.id}>
                  <button
                    className={`ltd-item${isActive ? ' is-active' : ''}`}
                    onClick={() => { void select(t.id); }}
                    disabled={loadingId !== null}
                    aria-current={isActive ? 'true' : undefined}
                  >
                    <span className="ltd-item-icon material-symbols-outlined" aria-hidden="true">forum</span>
                    <span className="ltd-item-text">
                      <span className="ltd-item-title">{t.title}</span>
                      <span className="ltd-item-meta">
                        {levelLabel(t.level, true)}｜{t.stepCount} 個步驟｜{new Date(t.updatedAt).toLocaleDateString()}
                      </span>
                    </span>
                    {isActive ? (
                      <span className="ltd-live">上課中</span>
                    ) : (
                      <span className="ltd-item-go material-symbols-outlined" aria-hidden="true">
                        {loadingId === t.id ? 'hourglass_top' : 'chevron_right'}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {activeTaskId && (
          <button className="ltd-end" onClick={() => { onEnd(); onClose(); }}>
            <span className="material-symbols-outlined" aria-hidden="true">stop_circle</span>結束課程
          </button>
        )}
      </div>
    </div>
  );
}
