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
}

export default function HostLobby({ roomId, hostToken, livekitToken, onStart }: HostLobbyProps) {
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
    const unsubscribe = subscribeToRoomEvents(roomId, hostToken, handleEvent);
    return unsubscribe;
  }, [roomId, hostToken, handleEvent]);

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
    <div className="host-lobby">
      <h2>等待學生加入</h2>
      <div className="qr-section">
        <QRCodeSVG value={joinUrl} size={200} />
        <p className="room-id">房間 ID: {roomId}</p>
        <p className="join-url">{joinUrl}</p>
      </div>
      <div className="pending-list">
        <h3>待審核學生 ({pending.length})</h3>
        {pending.map((s) => (
          <div key={s.requestId} className="pending-item">
            <span>{s.name}</span>
            <div className="pending-actions">
              <button className="approve-btn" onClick={() => handleApprove(s.requestId)}>
                允許
              </button>
              <button className="reject-btn" onClick={() => handleReject(s.requestId)}>
                拒絕
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="lobby-footer">
        <p>已允許: {approvedCount} 位學生</p>
        <button
          className="start-btn"
          disabled={approvedCount < 1}
          onClick={() => onStart(livekitToken)}
        >
          開始課堂
        </button>
      </div>
    </div>
  );
}
