import { QRCodeSVG } from 'qrcode.react';

export default function ShareScreen() {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('roomId');

  if (!roomId) return null;

  const shareUrl = `${window.location.protocol}//${window.location.host}/?roomId=${roomId}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl);
    const btn = document.getElementById('copy-btn');
    if (btn) {
      const originalText = btn.innerText;
      btn.innerText = '已複製！';
      setTimeout(() => { btn.innerText = originalText; }, 2000);
    }
  };

  return (
    <div className="share-screen-screen">
      <div className="share-screen-title">
        <span className="share-title-orange">分享</span>
        <span className="share-title-teal">房間</span>
      </div>
      <div className="share-screen-subtitle">邀請學生加入課堂</div>

      <div className="share-qr-card">
        <QRCodeSVG value={shareUrl} size={220} />
      </div>

      <div className="share-room-info">
        <div className="share-room-label">房間 ID</div>
        <div className="share-room-id">{roomId}</div>
      </div>

      <button
        className="share-copy-btn"
        onClick={handleCopy}
        id="copy-btn"
      >
        複製加入連結
      </button>
    </div>
  );
}
