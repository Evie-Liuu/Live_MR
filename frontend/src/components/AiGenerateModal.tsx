import { useEffect, useRef, useState } from 'react';
import { THEMES } from '../config/scenes.ts';
import { CEFR_LEVELS, type CefrLevel } from '../types/lessonPlan.ts';
import type { DialogueTask } from '../types/dialogueTask.ts';
import { buildSceneContext } from '../utils/sceneContext.ts';
import { dialogueTaskErrorText, generateDialogueTask } from '../utils/dialogueTaskClient.ts';
import './AiGenerateModal.css';

interface AiGenerateModalProps {
  /** 生成的草稿尚未存檔 */
  onGenerated: (task: DialogueTask) => void;
  onClose: () => void;
}

const GENERATING_STEPS = ['分析主題與教學目標', '設計對話流程', '撰寫中英台詞', '整理語法說明與教學注意點'];
const STEP_INTERVAL_MS = 4000;
/** AI 生成的任務固定為 5 分鐘（與 backend/src/ai/dialogueTaskPrompts.ts 一致），老師不可更改 */
const DURATION_MIN = 5;
const MAX_TOPIC_LEN = 200;
const MAX_GOAL_LEN = 300;

const SCENE_OPTIONS = THEMES.flatMap(t => t.scenes.map(s => ({ id: s.id, label: `${t.label}／${s.label}` })));

export default function AiGenerateModal({ onGenerated, onClose }: AiGenerateModalProps) {
  const [sceneId, setSceneId] = useState<string>(SCENE_OPTIONS[0]?.id ?? '');
  const [topic, setTopic] = useState('');
  const [teachingGoal, setTeachingGoal] = useState('');
  const [level, setLevel] = useState<CefrLevel>('A1');
  const [generating, setGenerating] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const topicRef = useRef<HTMLInputElement>(null);

  useEffect(() => { topicRef.current?.focus(); }, []);

  // 生成中不可關閉（後端仍在跑，關掉會讓老師以為取消了）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !generating) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [generating, onClose]);

  // 生成中：固定文案輪播，不是真實進度
  useEffect(() => {
    if (!generating) return;
    const t = setInterval(() => setStepIdx(i => Math.min(i + 1, GENERATING_STEPS.length - 1)), STEP_INTERVAL_MS);
    return () => clearInterval(t);
  }, [generating]);

  const handleGenerate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = topic.trim();
    if (!trimmed) { setError('請輸入主題'); topicRef.current?.focus(); return; }
    const sceneContext = buildSceneContext(sceneId);
    if (!sceneContext) { setError('找不到所選場景'); return; }
    setError(null);
    setStepIdx(0);
    setGenerating(true);
    try {
      const task = await generateDialogueTask({
        sceneContext, topic: trimmed, level,
        ...(teachingGoal.trim() ? { teachingGoal: teachingGoal.trim() } : {}),
      });
      onGenerated(task);
    } catch (err) {
      setError(dialogueTaskErrorText(err)); // 表單內容保留，可直接重試
      setGenerating(false);
    }
  };

  return (
    <div className="ag-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !generating) onClose(); }}>
      <div className="ag-dialog" role="dialog" aria-modal="true" aria-labelledby="ag-title" aria-busy={generating}>
        <header className="ag-head">
          <h2 id="ag-title">
            <span className="ag-head-icon material-symbols-outlined" aria-hidden="true">auto_awesome</span>AI 生成任務
          </h2>
          <button className="ag-close" onClick={onClose} disabled={generating} aria-label="關閉">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        {generating ? (
          <div className="ag-generating" aria-live="polite">
            <div className="gradient-spinner" />
            <ol className="ag-progress">
              {GENERATING_STEPS.map((s, i) => (
                <li key={s} className={i < stepIdx ? 'is-done' : i === stepIdx ? 'is-current' : ''}>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    {i < stepIdx ? 'check_circle' : i === stepIdx ? 'progress_activity' : 'radio_button_unchecked'}
                  </span>
                  {s}
                </li>
              ))}
            </ol>
            <p className="ag-hint">通常需要 5 到 20 秒，請勿關閉頁面</p>
          </div>
        ) : (
          <form className="ag-form" onSubmit={handleGenerate}>
            {error && <div className="ag-error" role="alert">{error}</div>}

            <label className="ag-field">
              <span className="ag-label">場景</span>
              <select value={sceneId} onChange={e => setSceneId(e.target.value)}>
                {SCENE_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>

            <label className="ag-field">
              <span className="ag-label">主題<span className="ag-required">必填</span></span>
              <input
                ref={topicRef}
                value={topic}
                maxLength={MAX_TOPIC_LEN}
                placeholder="例：退換貨與退款"
                onChange={e => setTopic(e.target.value)}
              />
            </label>

            <label className="ag-field">
              <span className="ag-label">教學目標<span className="ag-optional">選填</span></span>
              <textarea
                rows={3}
                value={teachingGoal}
                maxLength={MAX_GOAL_LEN}
                placeholder="例：學生能禮貌地說明退貨原因，並選擇退款或換貨"
                onChange={e => setTeachingGoal(e.target.value)}
              />
              <span className="ag-counter">{teachingGoal.length} / {MAX_GOAL_LEN}</span>
            </label>

            <div className="ag-field">
              <span className="ag-label">教案長度</span>
              <div className="ag-fixed" title="AI 生成的任務固定為 5 分鐘">
                <span className="material-symbols-outlined" aria-hidden="true">schedule</span>
                <strong>{DURATION_MIN} 分鐘</strong>
                <span className="ag-fixed-note">
                  <span className="material-symbols-outlined" aria-hidden="true">lock</span>固定長度
                </span>
              </div>
            </div>

            <fieldset className="ag-field ag-levels">
              <legend className="ag-label">學生程度</legend>
              <div className="ag-level-grid">
                {CEFR_LEVELS.map(l => (
                  <label key={l.value} className={`ag-level${level === l.value ? ' is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="ag-level"
                      value={l.value}
                      checked={level === l.value}
                      onChange={() => setLevel(l.value)}
                    />
                    <span className="ag-level-name">{l.grade}</span>
                    <span className="ag-level-cefr">{l.cefr}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <footer className="ag-foot">
              <button type="button" className="ag-btn-ghost" onClick={onClose}>取消</button>
              <button type="submit" className="ag-btn-primary">
                <span className="material-symbols-outlined" aria-hidden="true">auto_awesome</span>生成任務
              </button>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}
