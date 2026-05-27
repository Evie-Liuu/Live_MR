import { useState, useEffect, lazy, Suspense } from 'react';
import type { AppState } from './state.ts';
import { createRoom } from './api.ts';
import RoleSelect from './components/RoleSelect.tsx';
import BigScreen from './components/BigScreen.tsx';
import './App.css';

// const BigScreen = lazy(() => import('./components/BigScreen.tsx'));
const ShareScreen = lazy(() => import('./components/ShareScreen.tsx'));
const HostLobby = lazy(() => import('./components/HostLobby.tsx'));
const HostSession = lazy(() => import('./components/HostSession.tsx'));
const StudentJoin = lazy(() => import('./components/StudentJoin.tsx'));
const StudentWaiting = lazy(() => import('./components/StudentWaiting.tsx'));
const StudentSession = lazy(() => import('./components/StudentSession.tsx'));

function AppSpinner() {
  return (
    <div className='loading-container'>
      <div className='waiting-inner'>
        <div className="gradient-spinner" />
        <h2 className="waiting-text">載入中...</h2>
      </div>
    </div>
    // <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
    //   <div style={{
    //     width: 40,
    //     height: 40,
    //     border: '4px solid #e0e0e0',
    //     borderTopColor: '#1976d2',
    //     borderRadius: '50%',
    //     animation: 'spin 0.8s linear infinite',
    //   }} />
    // </div>
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

  // URL ?roomId= always wins — supports student deep-link / QR scans
  if (urlRoomId) {
    const persisted = loadPersistedState();
    // If persisted state matches this room and is a student-side screen, restore it
    if (persisted && 'roomId' in persisted && persisted.roomId === urlRoomId &&
        (persisted.screen === 'student-waiting' || persisted.screen === 'student-session')) {
      return persisted;
    }
    return { screen: 'student-join', roomId: urlRoomId };
  }

  const persisted = loadPersistedState();
  if (persisted) return persisted;
  return { screen: 'select-role' };
}

// Detect specific screen modes before mounting any hook-bearing components
const screenParam = new URLSearchParams(window.location.search).get('screen');
const isBigScreen = screenParam === 'bigscreen';
const isShareScreen = screenParam === 'share';

function App() {
  const [state, setState] = useState<AppState>(getInitialState);

  // Handle host room creation
  const handleHost = async () => {
    try {
      const { roomId, hostToken, livekitToken } = await createRoom();
      setState({ screen: 'host-lobby', roomId, hostToken, livekitToken });
    } catch (err) {
      setState({ screen: 'error', message: String(err) });
    }
  };

  const handleStudent = () => {
    const roomId = prompt('請輸入房間 ID');
    if (roomId) {
      setState({ screen: 'student-join', roomId });
    }
  };

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
  useEffect(() => {
    try {
      if (state.screen === 'select-role' || state.screen === 'error' ||
          state.screen === 'student-rejected') {
        sessionStorage.removeItem(APP_STATE_STORAGE_KEY);
      } else {
        sessionStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state));
      }
    } catch { /* quota / disabled storage — ignore */ }
  }, [state]);

  const renderScreen = () => {
    switch (state.screen) {
      case 'select-role':
        return <RoleSelect onHost={handleHost} onStudent={handleStudent} />;

      case 'host-lobby':
        return (
          <HostLobby
            roomId={state.roomId}
            hostToken={state.hostToken}
            livekitToken={state.livekitToken}
            onStart={(livekitToken) =>
              setState({ screen: 'host-session', roomId: state.roomId, hostToken: state.hostToken, livekitToken })
            }
          />
        );

      case 'host-session':
        return (
          <HostSession
            roomId={state.roomId}
            livekitToken={state.livekitToken}
            hostToken={state.hostToken}
          />
        );

      case 'student-join':
        return (
          <StudentJoin
            roomId={state.roomId}
            onSubmitted={(requestId, name) =>
              setState({ screen: 'student-waiting', roomId: state.roomId, requestId, name })
            }
            onExit={() => setState({ screen: 'select-role' })}
          />
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

