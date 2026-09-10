import { useReducer, useState } from 'react';
import type { LessonPlanRecord } from '../types/lessonPlan.ts';
import { editReducer, initEditState } from '../utils/lessonPlanEdit.ts';
import { updateLessonPlan, lessonPlanErrorText } from '../utils/lessonPlanClient.ts';
import { lessonPlanToMarkdown } from '../utils/lessonPlanMarkdown.ts';

interface LessonPlanViewProps {
  record: LessonPlanRecord;
  onSaved: (rec: LessonPlanRecord) => void;
  onBack: () => void;
}

export default function LessonPlanView({ record, onSaved, onBack }: LessonPlanViewProps) {
  const plan = record.plan;
  const [edit, dispatch] = useReducer(editReducer, plan, initEditState);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true); setError(null);
    try {
      const rec = await updateLessonPlan(record.id, { title: edit.title, modules: edit.modules });
      dispatch({ type: 'reset', plan: rec.plan });
      onSaved(rec);
    } catch (e) {
      setError(lessonPlanErrorText(e));
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(lessonPlanToMarkdown({ ...plan, title: edit.title, modules: edit.modules }));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('無法存取剪貼簿，請改用列印');
    }
  };

  return (
    <div className="lp-view">
      <div className="lp-view-toolbar lp-no-print">
        <button className="lp-btn-ghost" onClick={onBack}>← 返回清單</button>
        <div className="lp-view-actions">
          <button className="lp-btn-ghost" onClick={handleCopy}>{copied ? '已複製' : '複製為 Markdown'}</button>
          <button className="lp-btn-ghost" onClick={() => window.print()}>列印</button>
          <button className="lp-btn-primary" onClick={handleSave} disabled={!edit.dirty || saving}>
            {saving ? '儲存中…' : '儲存'}
          </button>
        </div>
      </div>
      {error && <div className="lp-error">{error}</div>}

      <input
        className="lp-title-input"
        value={edit.title}
        onChange={e => dispatch({ type: 'set-title', title: e.target.value })}
        aria-label="教案標題"
      />
      <p className="lp-meta">主題：{plan.topic}｜程度：{plan.level}｜{plan.durationMin} 分鐘｜場景：{plan.sceneId}</p>

      <section className="lp-card">
        <h2>學習目標</h2>
        <ul>{plan.objectives.map((o, i) => <li key={i}>{o}</li>)}</ul>
      </section>

      <section className="lp-card">
        <h2>教學流程與逐字腳本</h2>
        {plan.timeline.map((p, i) => (
          <div className="lp-phase" key={i}>
            <h3>{p.phase} <span className="lp-minutes">{p.minutes} 分鐘</span></h3>
            <p className="lp-activity">{p.activity}</p>
            <pre className="lp-script">{p.teacherScript}</pre>
          </div>
        ))}
      </section>

      <section className="lp-card">
        <h2>語法說明</h2>
        {plan.grammarNotes.map((g, i) => (
          <div className="lp-grammar" key={i}>
            <strong>{g.point}</strong>
            <p>{g.explanation}</p>
            <ul>{g.examples.map((ex, j) => <li key={j}>{ex}</li>)}</ul>
          </div>
        ))}
      </section>

      <section className="lp-card">
        <h2>教學注意點</h2>
        <ul>{plan.teachingNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>
      </section>

      <section className="lp-card">
        <h2>任務包 <span className="lp-hint-text lp-no-print">可改文字、刪單題；儲存後課堂即可載入</span></h2>
        {edit.modules.map(m => (
          <div className="lp-module" key={m.id}>
            <h3>{m.icon} {m.label}</h3>
            {m.tasks.map(t => (
              <div className="lp-task" key={t.id}>
                <input
                  className="lp-task-input"
                  value={t.label}
                  onChange={e => dispatch({ type: 'edit-task-label', taskId: t.id, label: e.target.value })}
                  aria-label="任務文字"
                />
                <button className="lp-btn-danger lp-no-print" onClick={() => dispatch({ type: 'delete-task', taskId: t.id })}>刪除</button>
                <div className="lp-task-hint">
                  <div>完整句：{t.hint.completeSentence}</div>
                  <div>句型：{t.hint.keyStructure}</div>
                  <div>半句：{t.hint.partialSentence}</div>
                  <div>重組：{t.hint.unscramble.join(' ')}</div>
                  <div>延伸：{t.hint.extraPhrases.join(' / ')}</div>
                </div>
              </div>
            ))}
          </div>
        ))}
        {edit.modules.length === 0 && <p className="lp-hint-text">任務包已清空，儲存後課堂不會出現教案任務。</p>}
      </section>
    </div>
  );
}
