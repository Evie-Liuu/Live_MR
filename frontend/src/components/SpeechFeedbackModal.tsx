import { useEffect, useState } from 'react';
import {
  ISSUE_LABELS, SEVERITY_LABELS, fetchSpeechFeedback, type JudgeIssue, type SpeechFeedbackReport,
} from '../types/speechAssist.ts';
import './SpeechFeedbackModal.css';

interface SpeechFeedbackModalProps {
  roomId: string;
  hostToken: string;
  onClose: () => void;
}

const ISSUES: JudgeIssue[] = ['chinese', 'incomplete', 'wrongWord', 'noResponse'];
/** 約略匯率，只用來讓老師對金額有感覺 */
const TWD_PER_USD = 32;

function formatUsd(usd: number): string {
  return usd < 0.01 ? `US$${usd.toFixed(4)}` : `US$${usd.toFixed(3)}`;
}

/**
 * 本堂課的 AI 口說紀錄：每位學生的統計（常見錯誤、常漏與常說錯的字）、逐句紀錄、AI 用量。
 * 資料存在後端，課後也能再打開（房間還在時）。
 */
export default function SpeechFeedbackModal({ roomId, hostToken, onClose }: SpeechFeedbackModalProps) {
  const [report, setReport] = useState<SpeechFeedbackReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'students' | 'lines'>('students');

  useEffect(() => {
    let alive = true;
    fetchSpeechFeedback(roomId, hostToken)
      .then(r => { if (alive) setReport(r); })
      .catch(() => { if (alive) setError('讀取口說紀錄失敗，請稍後再試'); });
    return () => { alive = false; };
  }, [roomId, hostToken]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sfm-backdrop" onClick={onClose}>
      <div className="sfm" role="dialog" aria-modal="true" aria-labelledby="sfm-title" onClick={e => e.stopPropagation()}>
        <header className="sfm-head">
          <h2 id="sfm-title">AI 口說紀錄</h2>
          <button type="button" className="sfm-close" onClick={onClose} aria-label="關閉">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        {error && <p className="sfm-empty">{error}</p>}
        {!error && !report && <p className="sfm-empty">讀取中…</p>}
        {report && report.records.length === 0 && (
          <p className="sfm-empty">還沒有紀錄。在「登台展演」開啟「AI 口說輔助」後，學生停住或說完時會留下紀錄。</p>
        )}

        {report && report.records.length > 0 && (
          <>
            <dl className="sfm-usage">
              <div><dt>判斷次數</dt><dd>{report.usage.calls}</dd></div>
              <div><dt>錄音總長</dt><dd>{Math.round(report.usage.audioSeconds)} 秒</dd></div>
              <div><dt>Token（輸入／輸出）</dt><dd>{report.usage.promptTokens.toLocaleString()}／{report.usage.outputTokens.toLocaleString()}</dd></div>
              <div>
                <dt>估計費用</dt>
                <dd>{formatUsd(report.usage.costUsd)}<small>（約 NT${(report.usage.costUsd * TWD_PER_USD).toFixed(2)}）</small></dd>
              </div>
            </dl>

            <div className="sfm-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'students'} className={tab === 'students' ? 'is-on' : ''} onClick={() => setTab('students')}>
                學生統計
              </button>
              <button type="button" role="tab" aria-selected={tab === 'lines'} className={tab === 'lines' ? 'is-on' : ''} onClick={() => setTab('lines')}>
                逐句紀錄（{report.records.length}）
              </button>
            </div>

            {tab === 'students' ? (
              <div className="sfm-body">
                {report.students.map(s => (
                  <section key={s.studentName} className="sfm-student">
                    <div className="sfm-student-head">
                      <strong>{s.studentName}</strong>
                      <span>{s.lines} 句・正確 {s.ok}・輕微 {s.minor}・需提示 {s.severe}</span>
                    </div>
                    <div className="sfm-issues">
                      {ISSUES.filter(i => s.issues[i] > 0).map(i => (
                        <span key={i} className={`sfm-issue sfm-issue--${i}`}>{ISSUE_LABELS[i]} {s.issues[i]}</span>
                      ))}
                      {ISSUES.every(i => s.issues[i] === 0) && <span className="sfm-issue sfm-issue--none">沒有常見錯誤</span>}
                    </div>
                    {s.wrong.length > 0 && (
                      <p className="sfm-words">常說錯：{s.wrong.map(w => `${w.said} → ${w.expected}${w.count > 1 ? `（${w.count}）` : ''}`).join('、')}</p>
                    )}
                    {s.missing.length > 0 && (
                      <p className="sfm-words">常漏掉：{s.missing.map(w => `${w.word}${w.count > 1 ? `（${w.count}）` : ''}`).join('、')}</p>
                    )}
                  </section>
                ))}
              </div>
            ) : (
              <ol className="sfm-body sfm-lines">
                {[...report.records].reverse().map(r => (
                  <li key={r.id} className={`sfm-line sfm-line--${r.severity}`}>
                    <div className="sfm-line-head">
                      <strong>{r.studentName}</strong>
                      <span>第 {r.stepIndex + 1} 段第 {r.lineIndex + 1} 句</span>
                      <span className={`sfm-sev sfm-sev--${r.severity}`}>{SEVERITY_LABELS[r.severity]}</span>
                    </div>
                    <div className="sfm-line-en">{r.lineEn}</div>
                    <div className="sfm-line-said">“{r.transcript || '（沒有聲音）'}”</div>
                    {r.issues.length > 0 && (
                      <div className="sfm-line-issues">
                        {r.issues.map(i => ISSUE_LABELS[i]).join('、')}
                        {r.wrong.length > 0 && `：${r.wrong.map(w => `${w.said} → ${w.expected}`).join('、')}`}
                        {r.missing.length > 0 && `；漏了 ${r.missing.join(', ')}`}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </div>
  );
}
