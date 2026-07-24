import { useEffect, useRef, useState } from 'react';
import { joinRequest } from '../api.ts';
import { extractRoomId } from '../utils/qrRoomId.ts';
import { useQrScanner } from '../hooks/useQrScanner.ts';
import './StudentHome.css';

interface StudentHomeProps {
  fullName: string;
  onSubmitted: (requestId: string, roomId: string) => void;
  onLogout: () => void;
}

export default function StudentHome({ fullName, onSubmitted, onLogout }: StudentHomeProps) {
  const [mode, setMode] = useState<'input' | 'scanning'>('input');
  const [roomId, setRoomId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const submitRoomId = async (id: string) => {
    const trimmed = id.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError('');
    try {
      const { requestId } = await joinRequest(trimmed, fullName);
      onSubmitted(requestId, trimmed);
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  };

  const { start, stop } = useQrScanner({
    onDecode: (text) => {
      const scannedRoomId = extractRoomId(text);
      if (!scannedRoomId) {
        setError('無法辨識的 QR Code，請再試一次');
        return;
      }
      setMode('input');
      void submitRoomId(scannedRoomId);
    },
    onError: (message) => setError(message),
  });

  // 只在「掃描模式」開鏡頭；離開掃描模式（取消或掃到有效結果）就關閉
  useEffect(() => {
    if (mode !== 'scanning') return;
    const video = videoRef.current;
    if (!video) return;
    void start(video);
    return () => stop();
  }, [mode, start, stop]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitRoomId(roomId);
  };

  return (
    <div className="student-home-screen">
      <button className="student-home-logout-btn" onClick={onLogout} title="登出">
        <span className="material-symbols-outlined">logout</span>
        登出
      </button>

      <div className="student-home-container">
        <h2 className="student-home-title">
          <span className="title-orange">加入</span>
          <span className="title-teal">課堂</span>
        </h2>

        {mode === 'input' ? (
          <div className="student-home-card">
            <form onSubmit={handleSubmit}>
              <input
                type="text"
                placeholder="請輸入房間 ID"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                disabled={loading}
                autoFocus
                className="student-home-input"
              />
              <button type="submit" disabled={loading || !roomId.trim()} className="student-home-btn">
                {loading ? '送出中...' : '加入'}
              </button>
            </form>
            <button
              type="button"
              className="student-home-scan-btn"
              onClick={() => { setError(''); setMode('scanning'); }}
            >
              <span className="material-symbols-outlined">qr_code_scanner</span>
              掃描 QR Code
            </button>
            {error && <p className="error-text">{error}</p>}
          </div>
        ) : (
          <div className="student-home-scan-card">
            <video ref={videoRef} className="student-home-scan-video" muted playsInline />
            <button
              type="button"
              className="student-home-scan-cancel-btn"
              onClick={() => setMode('input')}
            >
              取消
            </button>
            {error && <p className="error-text">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
