import { useState, useEffect } from 'react';
import type { AppState } from './state.ts';
import { createRoom } from './api.ts';
import RoleSelect from './components/RoleSelect.tsx';
import HostLobby from './components/HostLobby.tsx';
import HostSession from './components/HostSession.tsx';
import StudentJoin from './components/StudentJoin.tsx';
import StudentWaiting from './components/StudentWaiting.tsx';
import StudentSession from './components/StudentSession.tsx';
import './App.css';

function getInitialState(): AppState {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('roomId');
  if (roomId) {
    return { screen: 'student-join', roomId };
  }
  return { screen: 'select-role' };
}

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
              setState({ screen: 'host-session', roomId: state.roomId, livekitToken })
            }
          />
        );

      case 'host-session':
        return (
          <HostSession
            roomId={state.roomId}
            livekitToken={state.livekitToken}
          />
        );

      case 'student-join':
        return (
          <StudentJoin
            roomId={state.roomId}
            onSubmitted={(requestId, name) =>
              setState({ screen: 'student-waiting', roomId: state.roomId, requestId, name })
            }
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
          />
        );

      case 'student-session':
        return (
          <StudentSession
            roomId={state.roomId}
            token={state.token}
            name={state.name}
          />
        );

      case 'student-rejected':
        return (
          <div className="rejected-screen">
            <h2>請求被拒絕</h2>
            <p>老師已拒絕你的加入請求。</p>
            <button onClick={() => setState({ screen: 'select-role' })}>返回</button>
          </div>
        );

      case 'error':
        return (
          <div className="error-screen">
            <h2>發生錯誤</h2>
            <p>{state.message}</p>
            <button onClick={() => setState({ screen: 'select-role' })}>返回</button>
          </div>
        );
    }
  };

  return <div className="app">{renderScreen()}</div>;
}

export default App;
