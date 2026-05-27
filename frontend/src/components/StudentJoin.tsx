import { useState } from 'react';
import { joinRequest } from '../api.ts';

interface StudentJoinProps {
  roomId: string;
  onSubmitted: (requestId: string, name: string) => void;
  onExit: () => void;
}

export default function StudentJoin({ roomId, onSubmitted, onExit }: StudentJoinProps) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setLoading(true);
    setError('');
    try {
      const { requestId } = await joinRequest(roomId, trimmed);
      onSubmitted(requestId, trimmed);
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  };

  return (
    <div className="student-join-screen">
      <button className="student-back-btn" onClick={onExit} title="返回首頁">
        <span className="material-symbols-outlined">arrow_back</span>
      </button>
      <div className="student-join-container">
        <h2 className="student-join-title">
          <span className="title-orange">加入</span>
          <span className="title-teal">課堂</span>
        </h2>
        <p className="student-join-subtitle">房間 ID: {roomId}</p>
        <div className="student-join-card">
          <form onSubmit={handleSubmit}>
            <input
              type="text"
              placeholder="請輸入你的名字"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
              autoFocus
              className="student-join-input"
            />
            <button type="submit" disabled={loading || !name.trim()} className="student-join-btn">
              {loading ? '送出中...' : '加入'}
            </button>
          </form>
          {error && <p className="error-text">{error}</p>}
        </div>
      </div>
    </div>
  );
}
