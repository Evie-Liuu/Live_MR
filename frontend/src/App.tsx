import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import type { AppState } from './state.ts';
import { resolveAuthRoute } from './state.ts';
import type { AuthUser } from './hooks/useAuth.ts';
import { useAuth } from './hooks/useAuth.ts';
import { createRoom, joinRequest } from './api.ts';
import LoginScreen from './components/LoginScreen.tsx';
import BigScreen from './components/BigScreen.tsx';
import HostSession from './components/HostSession.tsx';
import './App.css';

const ShareScreen = lazy(() => import('./components/ShareScreen.tsx'));
const HostLobby = lazy(() => import('./components/HostLobby.tsx'));
const StudentHome = lazy(() => import('./components/StudentHome.tsx'));
const StudentWaiting = lazy(() => import('./components/StudentWaiting.tsx'));
const StudentSession = lazy(() => import('./components/StudentSession.tsx'));
const TeacherHome = lazy(() => import('./components/TeacherHome.tsx'));
const LessonPrep = lazy(() => import('./components/LessonPrep.tsx'));

function AppSpinner() {
  return (
    <div className='loading-container'>
      <div className='waiting-inner'>
        <div className="gradient-spinner" />
        <h2 className="waiting-text">載入中...</h2>
      </div>
    </div>
  );
}

const APP_STATE_STORAGE_KEY = 'live-mr-app-state';

function loadPersistedState(): AppState | null {
  try {
    const raw = sessionStorage.getItem(APP_STATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppState;
    if (parsed && typeof parsed === 'object' && typeof parsed.screen === 'string') {
      return parsed;
    }
  } catch { /* ignore corrupt storage */ }
  return null;
}

function getInitialState(): AppState {
  const params = new URLSearchParams(window.location.search);
  const urlRoomId = params.get('roomId');
  const persisted = loadPersistedState();

  // 若 refresh 時 URL 仍帶著同一個房號、且已有進行中的 student-waiting/student-session，直接恢復
  if (urlRoomId && persisted && 'roomId' in persisted && persisted.roomId === urlRoomId &&
    (persisted.screen === 'student-waiting' || persisted.screen === 'student-session')) {
    return persisted;
  }

  if (persisted) return persisted;
  return { screen: 'select-role' };
}

/** 顯示用名稱：優先用帳號的 full_name，其餘依序退回 email / id / uid。 */
function displayNameOf(user: AuthUser): string {
  return user.full_name || user.email || (typeof user.id === 'string' ? user.id : user.uid) || '學生';
}

/** SDGs 帳號的穩定識別；後端只用它分組教案。 */
function teacherUidOf(user: AuthUser): string {
  return (typeof user.uid === 'string' && user.uid) || (typeof user.id === 'string' && user.id) || user.email || 'unknown';
}

// Detect specific screen modes before mounting any hook-bearing components
const screenParam = new URLSearchParams(window.location.search).get('screen');
const isBigScreen = screenParam === 'bigscreen';
const isShareScreen = screenParam === 'share';

function App() {
  const [state, setState] = useState<AppState>(getInitialState);
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  // 外部 QR/連結帶進站的房號只在開機當下讀一次；登入成功後才會用到（見 routeUser）
  const [pendingRoomId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('roomId'),
  );
  const hasAutoRoutedRef = useRef(false);

  // Handle host room creation
  const handleHost = async (planId?: string) => {
    try {
      const { roomId, hostToken, livekitToken } = await createRoom();
      setState({ screen: 'host-session', roomId, hostToken, livekitToken, ...(planId ? { planId } : {}) });
    } catch (err) {
      setState({ screen: 'error', message: String(err) });
    }
  };

  // 外部深連結（roomId 已知）登入成功後自動送出加入請求；student-home 手動輸入/
  // 掃 QR 走 StudentHome 自己內部呼叫 joinRequest，不經過這個函式。
  const autoJoinRoom = async (roomId: string, name: string) => {
    setState({ screen: 'student-joining', roomId });
    try {
      const { requestId } = await joinRequest(roomId, name);
      setState({ screen: 'student-waiting', roomId, requestId, name });
    } catch (err) {
      setState({ screen: 'error', message: String(err) });
    }
  };

  /**
   * 登入成功（或開機時偵測到既有 session）後的統一分流入口，規則見 resolveAuthRoute：
   *   - teacher / admin / institution_admin → teacher-home（備課 / 開始上課）
   *   - student / visitor + 有 pendingRoomId → 自動送出加入請求
   *   - student / visitor + 無 pendingRoomId → student-home（手動輸入房號或掃 QR）
   */
  const routeUser = (loggedInUser: AuthUser) => {
    const route = resolveAuthRoute(loggedInUser.role, pendingRoomId);
    if (route.action === 'teacher-home') {
      setState({ screen: 'teacher-home' });
    } else if (route.action === 'auto-join') {
      void autoJoinRoom(route.roomId, displayNameOf(loggedInUser));
    } else {
      setState({ screen: 'student-home' });
    }
  };

  const handleLoginSuccess = (loggedInUser: AuthUser) => {
    routeUser(loggedInUser);
  };

  // 開機時若已有有效 session（Firebase 持久化），自動依 role 導向，不必重新登入。
  // 只在「當前畫面還是登入表單」時才導向——避免蓋掉 refresh 後恢復的進行中 session
  // （host-session/student-waiting 等）。這段刻意不寫依賴陣列、每次 render 都跑，
  // 靠 hasAutoRoutedRef 保證只在開機當下真正執行一次：之後使用者從房間畫面按
  // 「離開」回到 select-role 不會被立刻導回去（否則老師離開房間會馬上被彈進新房間）。
  useEffect(() => {
    if (isLoading || hasAutoRoutedRef.current) return;
    hasAutoRoutedRef.current = true;
    if (isAuthenticated && user && state.screen === 'select-role') {
      routeUser(user);
    }
  });

  // Clear roomId from URL when on select-role
  useEffect(() => {
    if (state.screen === 'select-role') {
      const url = new URL(window.location.href);
      if (url.searchParams.has('roomId')) {
        url.searchParams.delete('roomId');
        window.history.replaceState({}, '', url.toString());
      }
    }
  }, [state.screen]);

  // Persist AppState to sessionStorage so a page refresh restores the user back
  // to the same screen (and auto-rejoins their LiveKit room when applicable).
  // sessionStorage scope = current tab only, so closing the tab still resets.
  // select-role/error/student-rejected/student-home/student-joining/teacher-home/lesson-prep
  // 都不持久化——這些畫面在 refresh 後可以靠開機時的 routeUser 自行正確地重新導向。
  useEffect(() => {
    try {
      if (state.screen === 'select-role' || state.screen === 'error' ||
        state.screen === 'student-rejected' || state.screen === 'student-home' ||
        state.screen === 'student-joining' || state.screen === 'teacher-home' ||
        state.screen === 'lesson-prep') {
        sessionStorage.removeItem(APP_STATE_STORAGE_KEY);
      } else {
        sessionStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state));
      }
    } catch { /* quota / disabled storage — ignore */ }
  }, [state]);

  const renderScreen = () => {
    switch (state.screen) {
      case 'select-role':
        return <LoginScreen onLoginSuccess={handleLoginSuccess} />;

      case 'teacher-home':
        return (
          <TeacherHome
            teacherName={user ? displayNameOf(user) : '老師'}
            teacherUid={user ? teacherUidOf(user) : 'unknown'}
            onPrep={() => setState({ screen: 'lesson-prep' })}
            onStart={(planId) => { void handleHost(planId); }}
            onLogout={() => { void logout(); setState({ screen: 'select-role' }); }}
          />
        );

      case 'lesson-prep':
        return (
          <LessonPrep
            teacherUid={user ? teacherUidOf(user) : 'unknown'}
            institutionId={user?.institution_id != null ? String(user.institution_id) : undefined}
            onBack={() => setState({ screen: 'teacher-home' })}
          />
        );

      case 'host-lobby':
        return (
          <HostLobby
            roomId={state.roomId}
            hostToken={state.hostToken}
            livekitToken={state.livekitToken}
            onStart={(livekitToken) =>
              setState({
                screen: 'host-session',
                roomId: state.roomId,
                hostToken: state.hostToken,
                livekitToken,
                planId: state.planId,
              })
            }
            onExit={() => setState({ screen: 'select-role' })}
          />
        );

      case 'host-session':
        return (
          <HostSession
            roomId={state.roomId}
            livekitToken={state.livekitToken}
            hostToken={state.hostToken}
            planId={state.planId}
          />
        );

      case 'student-home':
        return (
          <StudentHome
            fullName={user ? displayNameOf(user) : '學生'}
            onSubmitted={(requestId, roomId) =>
              setState({
                screen: 'student-waiting',
                roomId,
                requestId,
                name: user ? displayNameOf(user) : '學生',
              })
            }
            onLogout={() => { void logout(); }}
          />
        );

      case 'student-joining':
        return (
          <div className='loading-container'>
            <div className='waiting-inner'>
              <div className="gradient-spinner" />
              <h2 className="waiting-text">正在加入房間...</h2>
            </div>
          </div>
        );

      case 'student-waiting':
        return (
          <StudentWaiting
            roomId={state.roomId}
            requestId={state.requestId}
            name={state.name}
            onApproved={(token) =>
              setState({ screen: 'student-session', roomId: state.roomId, token, name: state.name })
            }
            onRejected={() =>
              setState({ screen: 'student-rejected', roomId: state.roomId })
            }
            onError={(message) => setState({ screen: 'error', message })}
            onExit={() => setState({ screen: 'select-role' })}
          />
        );

      case 'student-session':
        return (
          <StudentSession
            roomId={state.roomId}
            token={state.token}
            name={state.name}
            onExit={() => setState({ screen: 'select-role' })}
          />
        );

      case 'student-rejected':
        return (
          <div className="rejected-screen">
            <div className="rejected-card">
              <div className="rejected-icon-wrapper">
                <span className="material-symbols-outlined rejected-icon">person_cancel</span>
              </div>
              <h2 className="rejected-title">
                <span className="title-orange">請求</span>
                <span className="title-teal">被拒絕</span>
              </h2>
              <p className="rejected-subtitle">老師已拒絕你的加入請求。</p>
              <button
                className="rejected-back-btn"
                onClick={() => setState({ screen: 'select-role' })}
              >
                返回
              </button>
            </div>
          </div>
        );

      case 'error':
        return (
          <div className="error-screen">
            <div className="error-card">
              <div className="error-icon-wrapper">
                <span className="material-symbols-outlined error-icon">person_alert</span>
              </div>
              <h2 className="error-title">
                <span className="title-orange">發生</span>
                <span className="title-teal">錯誤</span>
              </h2>
              <p className="error-subtitle">{state.message}</p>
              <button
                className="error-back-btn"
                onClick={() => setState({ screen: 'select-role' })}
              >
                返回
              </button>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="app">
      <Suspense fallback={<AppSpinner />}>
        {renderScreen()}
      </Suspense>
    </div>
  );
}

function Root() {
  if (isBigScreen) return <Suspense fallback={<AppSpinner />}><BigScreen /></Suspense>;
  if (isShareScreen) return <Suspense fallback={<AppSpinner />}><ShareScreen /></Suspense>;
  return <App />;
}

export default Root;
