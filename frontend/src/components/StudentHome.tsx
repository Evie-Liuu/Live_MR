import { useEffect, useRef, useState } from 'react';
import { joinRequest } from '../api.ts';
import { extractRoomId, joinErrorText, normalizeRoomId } from '../utils/qrRoomId.ts';
import { useQrScanner } from '../hooks/useQrScanner.ts';
import './StudentHome.css';

const GUEST_NAME_STORAGE_KEY = 'guest-name';
/** 與後端 GUEST_NAME_MAX_LENGTH 相同 */
const GUEST_NAME_MAX_LENGTH = 20;

function readGuestName(): string {
  try { return localStorage.getItem(GUEST_NAME_STORAGE_KEY) ?? ''; } catch { return ''; }
}

interface StudentHomeProps {
  /** 帳號名稱；不給＝訪客（免登入），由學生自己輸入名稱 */
  fullName?: string;
  /** name：實際使用的名稱（訪客同名時後端會自動編號） */
  onSubmitted: (requestId: string, roomId: string, name: string) => void;
  /** 已登入是登出；訪客是回到登入畫面 */
  onLogout: () => void;
  /** 預填房號（例如 QR 連結自動加入失敗後回到這裡） */
  initialRoomId?: string;
  initialError?: string;
}

export default function StudentHome({ fullName, onSubmitted, onLogout, initialRoomId, initialError }: StudentHomeProps) {
  const isGuest = fullName === undefined;
  const [guestName, setGuestName] = useState(readGuestName);
  const [mode, setMode] = useState<'input' | 'scanning'>('input');
  const [roomId, setRoomId] = useState(initialRoomId ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError ?? '');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // loading (state) 生效前有一段延遲，QR 掃描器可能在同一個 tick 內重複觸發
  // onDecode，因此另外用 ref 做同步鎖，避免送出兩次 joinRequest。
  const isSubmittingRef = useRef(false);

  const submitRoomId = async (id: string) => {
    const trimmed = normalizeRoomId(id);
    const name = isGuest ? guestName.trim() : fullName;
    if (!trimmed || !name || loading || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setLoading(true);
    setError('');
    try {
      const res = await joinRequest(trimmed, name, { guest: isGuest });
      if (isGuest) {
        try { localStorage.setItem(GUEST_NAME_STORAGE_KEY, name); } catch { /* storage 不可用時下次重新輸入 */ }
      }
      onSubmitted(res.requestId, trimmed, res.name ?? name);
    } catch (err) {
      const nameRefused = isGuest && err instanceof Error && /\b400\b/.test(err.message);
      setError(nameRefused ? '這個名稱不能使用，請換一個名稱。' : joinErrorText(err));
      setLoading(false);
      isSubmittingRef.current = false;
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
      setRoomId(scannedRoomId);
      if (isGuest && !guestName.trim()) {
        setError('已掃到房號，請輸入名稱後按加入。');
        return;
      }
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
      <button className="student-home-logout-btn" onClick={onLogout} title={isGuest ? '返回登入' : '登出'}>
        <span className="material-symbols-outlined">logout</span>
        {isGuest ? '返回登入' : '登出'}
      </button>

      <div className="student-home-container">
        <h2 className="student-home-title">
          <span className="title-orange">加入</span>
          <span className="title-teal">課堂</span>
        </h2>

        {mode === 'input' ? (
          <div className="student-home-card">
            <form onSubmit={handleSubmit}>
              {isGuest && (
                <input
                  type="text"
                  placeholder="請輸入你的名稱"
                  autoComplete="off"
                  aria-label="名稱"
                  maxLength={GUEST_NAME_MAX_LENGTH}
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  disabled={loading}
                  autoFocus={!guestName}
                  className="student-home-input"
                />
              )}
              <input
                type="text"
                placeholder="請輸入 6 位數房號"
                inputMode="numeric"
                autoComplete="off"
                aria-label="房號"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                disabled={loading}
                autoFocus={!isGuest || !!guestName}
                className="student-home-input"
              />
              <button type="submit" disabled={loading || !roomId.trim() || (isGuest && !guestName.trim())} className="student-home-btn">
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
