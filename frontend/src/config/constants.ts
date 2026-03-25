// frontend/src/config/constants.ts

/** LiveKit server WebSocket URL — set VITE_LIVEKIT_URL in .env to override */
export const LIVEKIT_URL =
  (import.meta.env.VITE_LIVEKIT_URL as string | undefined) ?? 'ws://localhost:7880';

/** BroadcastChannel name for HostSession ↔ BigScreen pose relay */
export const BIGSCREEN_CHANNEL_NAME = 'live-mr-bigscreen';
