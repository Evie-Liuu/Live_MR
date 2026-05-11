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
