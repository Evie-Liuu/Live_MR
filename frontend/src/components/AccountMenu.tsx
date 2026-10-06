import { useEffect, useRef, useState } from 'react';
import { useAuth, type UserRole } from '../hooks/useAuth.ts';
import './AccountMenu.css';

interface AccountMenuProps {
  /** 有傳就用呼叫端的登出流程（例如同時切換 App 畫面）；沒傳直接用 useAuth().logout */
  onLogout?: () => void;
}

const ROLE_LABELS: Record<UserRole, string> = {
  teacher: '老師',
  admin: '管理員',
  institution_admin: '機構管理員',
  student: '學生',
  visitor: '訪客',
};

/** 右上角的帳號膠囊：頭像、姓名、身分；點開顯示 Email 與登出 */
export default function AccountMenu({ onLogout }: AccountMenuProps) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  const name = user.full_name || user.email || '使用者';
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? '?';
  const role = ROLE_LABELS[user.role] ?? '';

  const handleLogout = () => {
    setOpen(false);
    if (onLogout) onLogout();
    else void logout();
  };

  return (
    <div className="acct" ref={ref}>
      <button
        className="acct-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        title={user.email ?? name}
      >
        <span className="acct-avatar" aria-hidden="true">{initial}</span>
        <span className="acct-text">
          <span className="acct-name">{name}</span>
          {role && <span className="acct-role">{role}</span>}
        </span>
        <span className="acct-chevron material-symbols-outlined" aria-hidden="true">expand_more</span>
      </button>

      {open && (
        <div className="acct-menu" role="menu">
          <div className="acct-menu-head">
            <span className="acct-avatar acct-avatar-lg" aria-hidden="true">{initial}</span>
            <span className="acct-menu-info">
              <span className="acct-menu-name">{name}</span>
              {user.email && <span className="acct-menu-email">{user.email}</span>}
              {role && <span className="acct-menu-role">{role}</span>}
            </span>
          </div>
          <button className="acct-menu-item" role="menuitem" onClick={handleLogout}>
            <span className="material-symbols-outlined" aria-hidden="true">logout</span>登出
          </button>
        </div>
      )}
    </div>
  );
}
