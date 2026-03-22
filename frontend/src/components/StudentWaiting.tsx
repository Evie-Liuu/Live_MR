import { useEffect, useRef } from 'react';
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
  const startTime = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;

      if (Date.now() - startTime.current > TIMEOUT_MS) {
        onError('等待逾時，請重新加入。');
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

  return (
    <div className="student-waiting">
      <div className="spinner" />
      <h2>等待老師允許</h2>
      <p>{name}，請稍候...</p>
    </div>
  );
}
