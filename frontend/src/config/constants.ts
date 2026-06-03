// frontend/src/config/constants.ts

// Derive LiveKit URL from the current page host so the SDK request is same-origin.
// Nginx (/livekit/ → livekit:7880) and Vite dev proxy (/livekit → localhost:7880)
// both handle the forwarding, making CORS a non-issue regardless of access path
// (LAN IP, Cloudflare tunnel, localhost).
export const LIVEKIT_URL = (() => {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/livekit`;
})();

/** BroadcastChannel name for HostSession ↔ BigScreen pose relay */
export const BIGSCREEN_CHANNEL_NAME = 'live-mr-bigscreen';

/**
 * LiveKit setMicrophoneEnabled 的 AudioCaptureOptions 預設值。
 * 開啟標準 WebRTC 三件套以削弱環境噪音與回授,讓教室/家中收音乾淨:
 *  - noiseSuppression : 抑制持續性背景噪音(風扇、空調、白噪)
 *  - echoCancellation : 消除喇叭/投影輸出回授,避免雙端混音
 *  - autoGainControl  : 自動穩定音量,遠距收音不會忽大忽小
 * 三項皆為瀏覽器原生支援的 MediaTrackConstraints。
 */
export const MIC_AUDIO_OPTIONS = {
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
} as const;
