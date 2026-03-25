import { useEffect, useRef, useState } from 'react';
import { useBigScreenScene } from '../hooks/useBigScreenScene.ts';
import { SCENE_PRESETS, DEFAULT_SCENE_ID } from '../config/scenes.ts';

/** Message shape broadcast over BroadcastChannel */
export interface BigScreenMsg {
  type: 'pose' | 'leave' | 'scene-change' | 'vrm-change';
  identity?: string;
  poseData?: unknown;
  /** For 'scene-change': new scene preset ID */
  sceneId?: string;
  /** For 'vrm-change': new VRM source ID */
  vrmSourceId?: string;
}

const CHANNEL_NAME = 'live-mr-bigscreen';

/**
 * BigScreen – full-screen VRM avatar wall displayed on the teacher's
 * secondary monitor / projector.
 *
 * Open via: window.open('/?screen=bigscreen', 'bigscreen')
 *
 * Receives pose data from the host window through a BroadcastChannel.
 * The initial snapshot (all participants + their latest poses) is pushed
 * to sessionStorage by HostSession before opening the window, so avatars
 * auto-populate even before the first broadcast.
 *
 * Scene preset can be switched at runtime via a 'scene-change' message.
 */
export default function BigScreen() {
  // Scene / VRM source state (drives useBigScreenScene re-init)
  const [sceneId, setSceneId] = useState<string>(() => {
    return sessionStorage.getItem('bigscreen-sceneId') ?? DEFAULT_SCENE_ID;
  });
  const [vrmSourceId, setVrmSourceId] = useState<string>(() => {
    return sessionStorage.getItem('bigscreen-vrmSourceId') ?? 'default';
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { applyPose, removeAvatar } = useBigScreenScene(canvasRef, { sceneId, vrmSourceId });
  const removeAvatarRef = useRef(removeAvatar);
  removeAvatarRef.current = removeAvatar;
  const applyPoseRef = useRef(applyPose);
  applyPoseRef.current = applyPose;

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

  // Listen for ongoing pose/leave/scene-change updates
  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL_NAME);

    channel.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as BigScreenMsg;

      if (msg.type === 'pose' && msg.identity) {
        applyPoseRef.current(msg.identity, msg.poseData);
      } else if (msg.type === 'leave' && msg.identity) {
        removeAvatarRef.current(msg.identity);
      } else if (msg.type === 'scene-change' && msg.sceneId) {
        setSceneId(msg.sceneId);
        sessionStorage.setItem('bigscreen-sceneId', msg.sceneId);
      } else if (msg.type === 'vrm-change' && msg.vrmSourceId) {
        setVrmSourceId(msg.vrmSourceId);
        sessionStorage.setItem('bigscreen-vrmSourceId', msg.vrmSourceId);
      }
    };

    return () => {
      channel.close();
    };
  }, []); // channel lifecycle independent of applyPose/removeAvatar

  const currentPreset = SCENE_PRESETS[sceneId];

  return (
    <div className="bigscreen-root">
      <canvas
        ref={canvasRef}
        id="bigscreen-canvas"
        className="bigscreen-canvas"
        width={window.innerWidth}
        height={window.innerHeight}
      />
      <div className="bigscreen-overlay">
        <span className="bigscreen-title">Live MR — 大屏顯示</span>
        {currentPreset && (
          <span className="bigscreen-scene-label">{currentPreset.label}</span>
        )}
      </div>
    </div>
  );
}
