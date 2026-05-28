import { useState, useEffect, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { subscribeToRoomEvents, approveRequest, rejectRequest } from '../api.ts';
import type { RoomEvent } from '../api.ts';

interface PendingStudent {
  requestId: string;
  name: string;
}

interface HostLobbyProps {
  roomId: string;
  hostToken: string;
  livekitToken: string;
  onStart: (livekitToken: string) => void;
  onExit: () => void;
}

export default function HostLobby({ roomId, hostToken, livekitToken, onStart, onExit }: HostLobbyProps) {
  const [pending, setPending] = useState<PendingStudent[]>([]);
  const [approvedCount, setApprovedCount] = useState(0);

  const handleEvent = useCallback((event: RoomEvent) => {
    if (event.type === 'join-request') {
      const student: PendingStudent = {
        requestId: event.requestId as string,
        name: event.name as string,
      };
      setPending((prev) => {
        if (prev.some((s) => s.requestId === student.requestId)) return prev;
        return [...prev, student];
      });
    }
  }, []);

  useEffect(() => {
    // 當創建新場景時 (進入 Lobby)，初始化 sessionStorage，但保留 bigscreen-sceneId
    const savedSceneId = sessionStorage.getItem('bigscreen-sceneId');
    sessionStorage.clear();
    if (savedSceneId) {
      sessionStorage.setItem('bigscreen-sceneId', savedSceneId);
    }

    const unsubscribe = subscribeToRoomEvents(roomId, hostToken, handleEvent);
    return unsubscribe;
  }, [roomId, hostToken, handleEvent]);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomId)
    } catch (error) {
      console.error('複製失敗:', error)
    }
  }

  const handleApprove = async (requestId: string) => {
    try {
      await approveRequest(roomId, requestId);
      setPending((prev) => prev.filter((s) => s.requestId !== requestId));
      setApprovedCount((c) => c + 1);
    } catch {
      // ignore errors for now
    }
  };

  const handleReject = async (requestId: string) => {
    try {
      await rejectRequest(roomId, requestId);
      setPending((prev) => prev.filter((s) => s.requestId !== requestId));
    } catch {
      // ignore errors for now
    }
  };

  const joinUrl = `${window.location.protocol}//${window.location.host}/?roomId=${roomId}`;

  return (
    <div className="host-lobby-screen">
      <button className="student-back-btn" onClick={onExit} title="返回首頁">
        <span className="material-symbols-outlined">arrow_back</span>
      </button>
      <h2 className="host-lobby-title">
        <span className="title-orange">等待</span><span className="title-teal">學生加入</span>
      </h2>

      <div className="host-lobby-card">
        <div className="qr-container">
          <QRCodeSVG value={joinUrl} size={240} />
        </div>
        <div className="room-info">
          <p className="room-id-label">
            房間 ID : <span className="room-id-value">{roomId}</span>
          </p>
          <button
            onClick={handleCopyCode}
            className="copy-btn"
            title="複製"
          >
            <span className="material-symbols-outlined">content_copy</span>
          </button>
        </div>
        <p className="join-url-text">{joinUrl}</p>
      </div>

      <div className="host-lobby-pending-bar">
        <span>待審核學生</span>
        <span className="pending-badge">({pending.length})</span>
      </div>

      <div className="host-lobby-pending-list">
        {pending.map((s) => (
          <div key={s.requestId} className="pending-item-new">
            <span className="pending-item-name">{s.name}</span>
            <div className="pending-item-actions">
              <button className="approve-btn-new" onClick={() => handleApprove(s.requestId)}>
                允許
              </button>
              <button className="reject-btn-new" onClick={() => handleReject(s.requestId)}>
                拒絕
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="host-lobby-footer">
        <div className="allowed-count">
          <span className="material-symbols-outlined">person</span>
          <span>已允許: {approvedCount} 位學生</span>
        </div>
        <button
          className="start-class-btn"
          disabled={approvedCount < 1}
          onClick={() => onStart(livekitToken)}
        >
          開始課堂
        </button>
      </div>
    </div>
  );
}
