import type { ClassNavState } from '../utils/classNavigator.ts';
import './ClassNavigator.css';

/** 課堂導航（唯讀）：進度與下一步提示，不提供操作 */
export default function ClassNavigator({ nav }: { nav: ClassNavState }) {
  return (
    <div className="cnav" role="status" aria-label="課堂導航">
      <ol className="cnav-stages">
        {nav.stages.map(s => (
          <li key={s.id} className={`cnav-stage cnav-stage--${s.status}`} aria-current={s.status === 'current' ? 'step' : undefined}>
            <span className="cnav-dot" aria-hidden="true">
              {s.status === 'done' && <span className="material-symbols-outlined">check</span>}
            </span>
            {s.label}
            {s.status === 'skipped' && <span className="cnav-skipped">未完成</span>}
          </li>
        ))}
      </ol>
      <p className={`cnav-hint${nav.warn ? ' is-warn' : ''}`} title={nav.hint}>
        <span className="material-symbols-outlined" aria-hidden="true">{nav.warn ? 'warning' : 'arrow_forward'}</span>
        <span className="cnav-hint-text">{nav.hint}</span>
      </p>
      {nav.notice && (
        <p className="cnav-notice" title={nav.notice}>
          <span className="material-symbols-outlined" aria-hidden="true">warning</span>
          {nav.notice}
        </p>
      )}
    </div>
  );
}
