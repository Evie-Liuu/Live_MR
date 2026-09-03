import { useState } from 'react';
import loginIllustration from '../assets/login_page.png';
import type { AuthUser } from '../hooks/useAuth.ts';
import { useAuth } from '../hooks/useAuth.ts';
import './LoginScreen.css';

interface LoginScreenProps {
  onLoginSuccess: (user: AuthUser) => void;
}

export default function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const { loginWithEmailAndPassword } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    setError('');
    try {
      const { success, user, message } = await loginWithEmailAndPassword(email, password);

      if (success) {
        localStorage.setItem('user_data', JSON.stringify(user));
        console.log(`[Auth] 登入成功，role: ${user?.role}，user:`, user);
        onLoginSuccess(user!);
      } else {
        setError(message || '登入失敗');
        setLoading(false);
      }
    } catch (err) {
      const error = err as { code?: string; message?: string };
      const msg = firebaseErrorMessage(error.code) || error.message || '登入失敗';
      setError(msg);
      setLoading(false);
    }
  };

  return (
    <div className="login-screen-container">
      <div className="login-left-panel">
        <div className="login-illustration-wrapper">
          <img src={loginIllustration} alt="Educational Illustration" />
        </div>
      </div>

      <div className="login-right-panel">
        <div className="login-card">
          <h1 className="login-card-title">
            <span className="text-orange">登入</span>
            <span className="text-teal">系統</span>
          </h1>

          <form onSubmit={handleSubmit} className="login-form">
            <div className="input-group">
              <div className="input-icon-wrapper">
                <span className="material-symbols-outlined input-icon">mail</span>
              </div>
              <input
                type="email"
                placeholder="電郵地址"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                required
              />
            </div>

            <div className="input-group">
              <div className="input-icon-wrapper">
                <span className="material-symbols-outlined input-icon">lock</span>
              </div>
              <input
                type="password"
                placeholder="密碼"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                required
              />
            </div>

            <div className="form-options">
              <label className="remember-me-label">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  disabled={loading}
                  className="custom-checkbox"
                />
                <span>記住我</span>
              </label>
              <a href="#forgot" className="forgot-password-link" onClick={(e) => e.preventDefault()}>
                忘記密碼？
              </a>
            </div>

            {error && <p className="login-error-text">{error}</p>}

            <button type="submit" className="login-submit-btn" disabled={loading}>
              {loading ? '登入中...' : '登入'}
            </button>
          </form>

          <div className="login-footer">
            <span className="footer-text">還沒有帳戶？</span>
            <a href="#register" className="footer-link" onClick={(e) => e.preventDefault()}>
              立即註冊
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function firebaseErrorMessage(code?: string): string {
  switch (code) {
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return '電子郵件或密碼錯誤';
    case 'auth/invalid-email':
      return '無效的電子郵件格式';
    case 'auth/user-disabled':
      return '此帳號已被停用';
    case 'auth/too-many-requests':
      return '登入嘗試次數過多，請稍後再試';
    default:
      return '';
  }
}
