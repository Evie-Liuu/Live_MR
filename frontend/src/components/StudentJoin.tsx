import { useState } from 'react';
import { joinRequest } from '../api.ts';

interface StudentJoinProps {
  roomId: string;
  onSubmitted: (requestId: string, name: string) => void;
}

export default function StudentJoin({ roomId, onSubmitted }: StudentJoinProps) {
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
    <div className="student-join">
      <h2>加入課堂</h2>
      <p>房間 ID: {roomId}</p>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="請輸入你的名字"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={loading}
          autoFocus
        />
        <button type="submit" disabled={loading || !name.trim()}>
          {loading ? '送出中...' : '加入'}
        </button>
      </form>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
