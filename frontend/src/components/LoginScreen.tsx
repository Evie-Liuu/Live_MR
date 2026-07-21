import { useState } from 'react';
import { joinRequest } from '../api.ts';
import loginIllustration from '../assets/login_illustration.png';
import './LoginScreen.css';

interface LoginScreenProps {
  onHost: () => void;
  onStudentJoin: (roomId: string, requestId: string, name: string) => void;
}

export default function LoginScreen({ onHost, onStudentJoin }: LoginScreenProps) {
  const [activeTab, setActiveTab] = useState<'teacher' | 'student'>('teacher');

  // Teacher Form state
  const [email, setEmail] = useState('teacher@example.com');
  const [password, setPassword] = useState('password123');
  const [rememberMe, setRememberMe] = useState(true);
  const [teacherLoading, setTeacherLoading] = useState(false);
  const [teacherError, setTeacherError] = useState('');

  // Student Form state
  const [roomId, setRoomId] = useState('');
  const [studentName, setStudentName] = useState('');
  const [studentLoading, setStudentLoading] = useState(false);
  const [studentError, setStudentError] = useState('');

  const handleTeacherSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setTeacherLoading(true);
    setTeacherError('');
    try {
      // In this app, host room creation doesn't require backend login validation,
      // it directly calls createRoom() and transitions to host-lobby.
      await onHost();
    } catch (err) {
      setTeacherError(String(err));
      setTeacherLoading(false);
    }
  };

  const handleStudentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanRoomId = roomId.trim();
    const cleanName = studentName.trim();
    if (!cleanRoomId || !cleanName) return;
    setStudentLoading(true);
    setStudentError('');
    try {
      const { requestId } = await joinRequest(cleanRoomId, cleanName);
      onStudentJoin(cleanRoomId, requestId, cleanName);
    } catch (err) {
      setStudentError(String(err));
      setStudentLoading(false);
    }
  };

  return (
    <div className="login-screen-container">
      {/* Left Column: Illustration & Welcome Banner */}
      <div className="login-left-panel">
        <div className="login-illustration-wrapper">
          <img src={loginIllustration} alt="Educational Illustration" />
        </div>
        <h2 className="login-welcome-banner">歡迎回到知識的樂園！</h2>
      </div>

      {/* Right Column: Login Card */}
      <div className="login-right-panel">
        <div className="login-card">
          <h1 className="login-card-title">
            <span className="text-orange">登入</span>
            <span className="text-teal">系統</span>
          </h1>

          {/* Segmented Control Tabs */}
          <div className="login-tabs">
            <button
              type="button"
              className={`login-tab ${activeTab === 'teacher' ? 'active' : ''}`}
              onClick={() => setActiveTab('teacher')}
            >
              老師登入
            </button>
            <button
              type="button"
              className={`login-tab ${activeTab === 'student' ? 'active' : ''}`}
              onClick={() => setActiveTab('student')}
            >
              學生登入
            </button>
          </div>

          {activeTab === 'teacher' ? (
            <form onSubmit={handleTeacherSubmit} className="login-form">
              <div className="input-group">
                <div className="input-icon-wrapper">
                  <span className="material-symbols-outlined input-icon">mail</span>
                </div>
                <input
                  type="email"
                  placeholder="電郵地址"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={teacherLoading}
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
                  disabled={teacherLoading}
                  required
                />
              </div>

              <div className="form-options">
                <label className="remember-me-label">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    disabled={teacherLoading}
                    className="custom-checkbox"
                  />
                  <span>記住我</span>
                </label>
                <a href="#forgot" className="forgot-password-link" onClick={(e) => e.preventDefault()}>
                  忘記密碼？
                </a>
              </div>

              {teacherError && <p className="login-error-text">{teacherError}</p>}

              <button type="submit" className="login-submit-btn" disabled={teacherLoading}>
                {teacherLoading ? '登入中...' : '登入'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleStudentSubmit} className="login-form">
              <div className="input-group">
                <div className="input-icon-wrapper">
                  <span className="material-symbols-outlined input-icon">tag</span>
                </div>
                <input
                  type="text"
                  placeholder="房間 ID"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  disabled={studentLoading}
                  required
                />
              </div>

              <div className="input-group">
                <div className="input-icon-wrapper">
                  <span className="material-symbols-outlined input-icon">person</span>
                </div>
                <input
                  type="text"
                  placeholder="你的名字"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  disabled={studentLoading}
                  required
                />
              </div>

              {studentError && <p className="login-error-text">{studentError}</p>}

              <button type="submit" className="login-submit-btn" disabled={studentLoading || !roomId.trim() || !studentName.trim()}>
                {studentLoading ? '加入中...' : '加入課堂'}
              </button>
            </form>
          )}

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
