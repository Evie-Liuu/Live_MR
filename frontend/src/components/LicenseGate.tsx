/**
 * LicenseGate.tsx
 *
 * 測試交付版：每個畫面（含大螢幕）右下角顯示測試者浮水印，截圖或錄影外流時查得到來源；
 * 過期後整個 app 改成到期說明。內部版本沒有授權資訊，直接顯示 app。
 */
import type { CSSProperties, ReactNode } from 'react';
import { BUILD_LICENSE, isLicenseExpired } from '../config/buildLicense.ts';

const watermarkStyle: CSSProperties = {
  position: 'fixed',
  right: 12,
  bottom: 8,
  zIndex: 2147483647,
  pointerEvents: 'none',
  userSelect: 'none',
  font: '600 12px/1.4 system-ui, sans-serif',
  // 深色底讓淺色頁面（登入頁）和深色畫面（大螢幕）都看得清楚
  color: 'rgba(255, 255, 255, 0.9)',
  background: 'rgba(0, 0, 0, 0.35)',
  padding: '2px 8px',
  borderRadius: 6,
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
};

const expiredStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  padding: 24,
  background: '#2A1E18',
  color: '#FBE8D8',
  textAlign: 'center',
  font: '16px/1.7 system-ui, sans-serif',
};

export default function LicenseGate({ children }: { children: ReactNode }) {
  const license = BUILD_LICENSE;
  if (!license) return <>{children}</>;
  if (isLicenseExpired(license)) {
    return (
      <div style={expiredStyle}>
        <div>
          <h1 style={{ fontSize: 22, margin: '0 0 8px', color: '#FF9A3D' }}>測試版已到期</h1>
          <p style={{ margin: 0 }}>此測試版已於 {license.expires} 到期，請聯絡提供者取得新版本。</p>
        </div>
      </div>
    );
  }
  return (
    <>
      {children}
      <div style={watermarkStyle} aria-hidden="true">
        測試版・{license.tester}・有效至 {license.expires}{license.id ? `・${license.id}` : ''}
      </div>
    </>
  );
}
