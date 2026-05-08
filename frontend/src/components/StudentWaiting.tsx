import { useEffect, useRef, useState } from 'react';
import { getRequestStatus } from '../api.ts';

interface StudentWaitingProps {
  roomId: string;
  requestId: string;
  name: string;
  onApproved: (token: string) => void;
  onRejected: () => void;
  onError: (message: string) => void;
}

const POLL_INTERVAL = 2000;
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export default function StudentWaiting({
  roomId,
  requestId,
  name,
  onApproved,
  onRejected,
  onError,
}: StudentWaitingProps) {
  const [isTimedOut, setIsTimedOut] = useState(false);
  const startTime = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;

      if (Date.now() - startTime.current > TIMEOUT_MS) {
        setIsTimedOut(true);
        return;
      }

      try {
        const { status, token } = await getRequestStatus(roomId, requestId);
        if (cancelled) return;

        if (status === 'approved' && token) {
          onApproved(token);
          return;
        }
        if (status === 'rejected') {
          onRejected();
          return;
        }
      } catch {
        // Retry on network errors
      }

      if (!cancelled) {
        setTimeout(poll, POLL_INTERVAL);
      }
    };

    poll();

    return () => {
      cancelled = true;
    };
  }, [roomId, requestId, onApproved, onRejected, onError]);

  if (isTimedOut) {
    return (
      <div className="student-timeout-screen timeout-bg">
        <div className="timeout-card">
          <div className="timeout-icon-wrapper">
            <span className="material-symbols-outlined timeout-icon">timer_off</span>
          </div>
          <h2 className="timeout-text">等待逾時，請重新加入。</h2>
          <button
            className="timeout-back-btn"
            onClick={() => window.location.reload()}
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="student-waiting-screen">
      <div className="waiting-inner">
        <div className="gradient-spinner" />
        <h2 className="waiting-text">等待老師允許</h2>
        {/* <p className="waiting-text">{name}，請稍候...</p> */}
      </div>
    </div>
  );
}
