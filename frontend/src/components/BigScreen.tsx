import { useEffect, useRef } from 'react';
import { useBigScreenScene } from '../hooks/useBigScreenScene.ts';

/** Message shape broadcast over BroadcastChannel */
export interface BigScreenMsg {
  type: 'pose';
  identity: string;
  poseData: unknown;
}

const CHANNEL_NAME = 'live-mr-bigscreen';

/**
 * BigScreen – full-screen VRM avatar wall displayed on the teacher's
 * secondary monitor / projector.
 *
 * Open via: window.open('/?screen=bigscreen', 'bigscreen')
 *
 * Receives pose data from the host window through a BroadcastChannel.
 * The initial snapshot (all participants + their latest poses) pushed
 * to sessionStorage by HostSession before opening the window, so new
 * frames can auto-populate avatars even before the first broadcast.
 */
export default function BigScreen() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { applyPose, removeAvatar } = useBigScreenScene(canvasRef);
  const removeAvatarRef = useRef(removeAvatar);
  removeAvatarRef.current = removeAvatar;

  // Apply snapshot stored by HostSession before the window was opened
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('bigscreen-snapshot');
      if (raw) {
        const snapshot = JSON.parse(raw) as Record<string, unknown>;
        for (const [identity, poseData] of Object.entries(snapshot)) {
          applyPose(identity, poseData);
        }
      }
    } catch (e) {
      console.warn('[BigScreen] Failed to parse snapshot', e);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once after mount

  // Listen for ongoing pose/leave updates via a single BroadcastChannel
  // Must handle both 'pose' and 'leave' in one channel instance
  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL_NAME);

    channel.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as { type: string; identity: string; poseData?: unknown };
      if (msg.type === 'pose') {
        applyPose(msg.identity, msg.poseData);
      } else if (msg.type === 'leave') {
        removeAvatarRef.current(msg.identity);
      }
    };

    return () => {
      channel.close();
    };
  }, [applyPose]);

  return (
    <div className="bigscreen-root">
      <canvas
        ref={canvasRef}
        id="bigscreen-canvas"
        className="bigscreen-canvas"
        width={1920}
        height={1080}
      />
      <div className="bigscreen-overlay">
        <span className="bigscreen-title">Live MR — 大屏顯示</span>
      </div>
    </div>
  );
}
