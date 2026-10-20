import { useEffect, useState } from 'react';
import { cancelJoinRequest, getRequestStatus } from '../api.ts';

interface StudentWaitingProps {
  roomId: string;
  requestId: string;
  name: string;
  onApproved: (token: string) => void;
  onRejected: () => void;
  onError: (message: string) => void;
  onExit: () => void;
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
  onExit,
}: StudentWaitingProps) {
  const [isTimedOut, setIsTimedOut] = useState(false);
  const [startTime] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;

      if (Date.now() - startTime > TIMEOUT_MS) {
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
  }, [roomId, requestId, onApproved, onRejected, onError, startTime]);

  // 離開等待頁（返回首頁、登出、逾時）就撤回申請，老師名單即時移除。
  // 已核准／拒絕時後端不會改動，所以核准後切到上課畫面也不受影響。
  // 重新整理或直接關分頁不會跑 cleanup：關分頁由後端「太久沒輪詢」自動移除；
  // 重新整理回來繼續輪詢，就算曾被移除也會自動恢復。
  useEffect(() => {
    if (isTimedOut) void cancelJoinRequest(roomId, requestId).catch(() => {});
  }, [isTimedOut, roomId, requestId]);
  useEffect(() => () => { void cancelJoinRequest(roomId, requestId).catch(() => {}); }, [roomId, requestId]);

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
            onClick={onExit}
          >
            返回首頁
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="student-waiting-screen">
      {/* <button className="student-back-btn" onClick={onExit} title="返回首頁">
        <span className="material-symbols-outlined">arrow_back</span>
      </button> */}
      <div className="waiting-inner">
        <div className="gradient-spinner" />
        <h2 className="waiting-text">等待老師允許</h2>
        <p className="waiting-text">{name}，請稍候...</p>
        <button className="student-back-btn student-back-btn--inline" onClick={onExit} title="返回首頁">
          <span className="material-symbols-outlined">arrow_back</span>
          返回首頁
        </button>
      </div>
    </div>
  );
}
