/**
 * 任務管理抽屜（舊有任務庫）：左側依模組列出可選任務（場景靜態任務＋舊版 AI 教案模組），
 * 右側為已選任務（可拖曳排序）。由 HostSession 抽出，資料與行為不變；
 * 已選任務與廣播仍由 HostSession 管理（側欄、橫幅、提示、結算都共用）。
 */
import type { DragEvent } from 'react';
import type { SceneModule } from '../types/vrm';
import type { TaskHint } from '../config/taskHints.ts';
import type { TaskEntry } from './BigScreen';

export const MAX_SELECTED_TASKS = 7;

interface TaskBankDrawerProps {
  open: boolean;
  onClose: () => void;
  modules: SceneModule[];
  /** 目前場景對應的舊版 AI 教案標題（沒有則不顯示標籤） */
  planTitle: string | null;
  expandedModuleIds: Set<string>;
  onToggleModule: (moduleId: string) => void;
  selectedTasks: TaskEntry[];
  onToggleTask: (taskId: string, label: string, hint?: TaskHint) => void;
  onClear: () => void;
  dropIndicator: { index: number; position: 'before' | 'after' } | null;
  onDragStart: (index: number) => void;
  onDragOver: (e: DragEvent<HTMLDivElement>, index: number) => void;
  onDrop: (e: DragEvent<HTMLDivElement>, index: number) => void;
  onDragEnd: () => void;
}

export default function TaskBankDrawer({
  open, onClose, modules, planTitle, expandedModuleIds, onToggleModule,
  selectedTasks, onToggleTask, onClear, dropIndicator, onDragStart, onDragOver, onDrop, onDragEnd,
}: TaskBankDrawerProps) {
  return (
    <div className={`panel-drawer panel-drawer--wide ${open ? 'panel-drawer--open' : ''}`}>
      <div className="panel-drawer-header">
        <div className="slot-drawer-title">
          <span className="orange">任務管理</span> <span className="teal">TASKS</span>
        </div>
        <button className="panel-close-btn" onClick={onClose}>
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>
      <div className="panel-drawer-body task-manager-drawer">
        {/* Left: Task Bank */}
        <div className="task-bank">
          <div className="task-bank-header">
            <span>任務庫</span>
            {planTitle && <span className="task-bank-plan-tag">{planTitle}</span>}
          </div>
          <div className="task-bank-tree">
            {modules.map((mod) => (
              <div key={mod.id} className="module-group">
                <div
                  className={`module-header ${expandedModuleIds.has(mod.id) ? 'expanded' : ''}`}
                  onClick={() => onToggleModule(mod.id)}
                >
                  <span className="module-icon">{mod.icon || '📁'}</span>
                  <span className="module-label">{mod.label}</span>
                  <span className="module-arrow material-symbols-outlined">
                    {expandedModuleIds.has(mod.id) ? 'expand_less' : 'expand_more'}
                  </span>
                </div>
                {expandedModuleIds.has(mod.id) && (
                  <div className="module-tasks">
                    {mod.tasks.map((task) => {
                      const isSelected = selectedTasks.some(t => t.id === task.id);
                      return (
                        <button
                          key={task.id}
                          className={`task-select-btn ${isSelected ? 'selected' : ''}`}
                          onClick={() => onToggleTask(task.id, task.label, task.hint)}
                          disabled={!isSelected && selectedTasks.length >= MAX_SELECTED_TASKS}
                        >
                          <div className="btn-check">
                            {isSelected && <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>check</span>}
                          </div>
                          <span className="btn-label">{task.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right: Selected task list + clear */}
        <div className="active-tasks">
          <div className="active-tasks-header">
            <span>已選任務</span>
            <span className={`task-count ${selectedTasks.length >= MAX_SELECTED_TASKS ? 'limit' : ''}`}>
              {selectedTasks.length}/{MAX_SELECTED_TASKS}
            </span>
          </div>
          {selectedTasks.length === 0 ? (
            <div className="active-tasks-empty">
              從左側任務庫點選，<br />最多 {MAX_SELECTED_TASKS} 項
            </div>
          ) : (
            <div className="active-tasks-list">
              {selectedTasks.map((task, idx) => (
                <div
                  key={`${task.id}-${idx}`}
                  className={`active-task-row ${task.completed ? 'completed' : ''} ${dropIndicator?.index === idx ? `drop-${dropIndicator.position}` : ''}`}
                  draggable
                  onDragStart={() => onDragStart(idx)}
                  onDragOver={(e) => onDragOver(e, idx)}
                  onDrop={(e) => onDrop(e, idx)}
                  onDragEnd={onDragEnd}
                >
                  <div className="task-index">{idx + 1}</div>
                  <div className="task-info">
                    <span className="task-label">{task.label}</span>
                  </div>
                  <button
                    className="task-remove-btn"
                    title="移除此任務"
                    onClick={() => onToggleTask(task.id, task.label)}
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>
              ))}
            </div>
          )}
          {selectedTasks.length > 0 && (
            <button className="clear-tasks-btn" onClick={onClear}>
              <span className="material-symbols-outlined">delete_sweep</span>
              清空所有任務
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
