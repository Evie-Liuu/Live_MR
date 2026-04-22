import React from 'react';
import { QRCodeSVG } from 'qrcode.react';

export default function ShareScreen() {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('roomId');

  if (!roomId) return null;

  const shareUrl = `${window.location.protocol}//${window.location.host}/?roomId=${roomId}`;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100vh', backgroundColor: '#1e1e2e', color: 'white', fontFamily: 'sans-serif',
      margin: 0, padding: 0
    }}>
      <div style={{ fontSize: '32px', marginBottom: '8px' }}>📱</div>
      <div style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '4px' }}>分享房間</div>
      <div style={{ fontSize: '14px', color: '#aaa', marginBottom: '32px' }}>邀請學生加入課堂</div>

      <div style={{ background: '#fff', padding: '16px', borderRadius: '16px', marginBottom: '32px' }}>
        <QRCodeSVG value={shareUrl} size={220} />
      </div>

      <div style={{ textAlign: 'center', marginBottom: '32px' }}>
        <div style={{ color: '#7788ff', fontSize: '14px', fontWeight: 800, letterSpacing: '1px', marginBottom: '4px' }}>房間 ID</div>
        <div style={{ color: '#fff', fontSize: '18px', fontWeight: 800 }}>{roomId}</div>
      </div>

      <button
        style={{
          background: '#44aaff', color: 'white', border: 'none', padding: '14px 28px',
          borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer',
          width: '80%', maxWidth: '300px'
        }}
        onClick={() => {
          navigator.clipboard.writeText(shareUrl);
          const btn = document.getElementById('copy-btn');
          if (btn) {
            const originalText = btn.innerText;
            btn.innerText = '已複製！';
            setTimeout(() => { btn.innerText = originalText; }, 2000);
          }
        }}
        id="copy-btn"
      >
        複製加入連結
      </button>
    </div>
  );
}
