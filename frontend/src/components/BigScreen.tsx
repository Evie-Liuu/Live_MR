import { useEffect, useRef, useState } from 'react';
import { useBigScreenScene } from '../hooks/useBigScreenScene.ts';
import { SCENE_PRESETS, DEFAULT_SCENE_ID } from '../config/scenes.ts';
import { VRM_SOURCES, DEFAULT_VRM_SOURCE_ID } from '../config/vrmSources.ts';
import PerformanceMonitor from './PerformanceMonitor.tsx';
import { BIGSCREEN_CHANNEL_NAME } from '../config/constants.ts';

/** Message shape broadcast over BroadcastChannel */
export interface BigScreenMsg {
  type: 'pose' | 'leave' | 'scene-change' | 'vrm-change' | 'vrm-identity-change';
  identity?: string;
  poseData?: unknown;
  /** For 'scene-change': new scene preset ID */
  sceneId?: string;
  /** For 'vrm-change': new VRM source ID (global fallback for new avatars) */
  vrmSourceId?: string;
  /** For 'vrm-identity-change': swap the VRM for a specific participant */
  vrmUrl?: string;
}

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
// ─── Camera Background Sub-Component ──────────────────────────────────────────
function CameraBackground() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error('[BigScreen] Failed to start camera background:', err);
      }
    }
    startCamera();
    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return <video ref={videoRef} autoPlay muted playsInline />;
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function BigScreen() {
  // Scene / VRM source state (drives useBigScreenScene re-init)
  const [sceneId, setSceneId] = useState<string>(() => {
    return sessionStorage.getItem('bigscreen-sceneId') ?? DEFAULT_SCENE_ID;
  });
  const [vrmSourceId, setVrmSourceId] = useState<string>(() => {
    return sessionStorage.getItem('bigscreen-vrmSourceId') ?? 'default';
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { applyPose, removeAvatar, swapAvatar } = useBigScreenScene(canvasRef, { sceneId, vrmSourceId });
  const removeAvatarRef = useRef(removeAvatar);
  removeAvatarRef.current = removeAvatar;
  const applyPoseRef = useRef(applyPose);
  applyPoseRef.current = applyPose;
  const swapAvatarRef = useRef(swapAvatar);
  swapAvatarRef.current = swapAvatar;

  const [poseUpdateCount, setPoseUpdateCount] = useState(0);

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

      // Also restore individual student roles
      const rawRoles = sessionStorage.getItem('bigscreen-studentRoles');
      if (rawRoles) {
        const roles = JSON.parse(rawRoles) as Record<string, string>;
        for (const [iden, srcId] of Object.entries(roles)) {
          const vrmUrl = (VRM_SOURCES[srcId] || VRM_SOURCES[DEFAULT_VRM_SOURCE_ID]).url;
          swapAvatarRef.current(iden, vrmUrl); // override the source
        }
      }
    } catch (e) {
      console.warn('[BigScreen] Failed to parse snapshot', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once after mount

  // Listen for ongoing pose/leave/scene-change updates
  useEffect(() => {
    const channel = new BroadcastChannel(BIGSCREEN_CHANNEL_NAME);

    channel.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as BigScreenMsg;

      if (msg.type === 'pose' && msg.identity) {
        applyPoseRef.current(msg.identity, msg.poseData);
        setPoseUpdateCount(c => c + 1);
      } else if (msg.type === 'leave' && msg.identity) {
        removeAvatarRef.current(msg.identity);
      } else if (msg.type === 'scene-change' && msg.sceneId) {
        setSceneId(msg.sceneId);
        sessionStorage.setItem('bigscreen-sceneId', msg.sceneId);
      } else if (msg.type === 'vrm-change' && msg.vrmSourceId) {
        setVrmSourceId(msg.vrmSourceId);
        sessionStorage.setItem('bigscreen-vrmSourceId', msg.vrmSourceId);
      } else if (msg.type === 'vrm-identity-change' && msg.identity && msg.vrmUrl) {
        swapAvatarRef.current(msg.identity, msg.vrmUrl);
      }
    };

    return () => {
      channel.close();
    };
  }, []); // channel lifecycle independent of applyPose/removeAvatar

  const currentPreset = SCENE_PRESETS[sceneId];

  return (
    <div className="bigscreen-root">
      {/* 1. Underlying DOM Background Layer */}
      {currentPreset && currentPreset.backgroundType !== 'none' && (
        <div
          className="bigscreen-bg"
          style={{
            backgroundColor: currentPreset.backgroundType === 'color' ? currentPreset.backgroundValue : undefined,
          }}
        >
          {currentPreset.backgroundType === 'image' && currentPreset.backgroundValue && (
            <img src={currentPreset.backgroundValue} alt="Background" />
          )}
          {currentPreset.backgroundType === 'video' && currentPreset.backgroundValue && (
            <video src={currentPreset.backgroundValue} autoPlay loop muted playsInline />
          )}
          {currentPreset.backgroundType === 'camera' && <CameraBackground />}
        </div>
      )}

      {/* 2. Transparent 3D Canvas Layer */}
      <canvas
        ref={canvasRef}
        id="bigscreen-canvas"
        className="bigscreen-canvas"
      />

      {/* 3. Overlay UI Layer */}
      <div className="bigscreen-overlay">
        <span className="bigscreen-title">Live MR — 大屏顯示</span>
        {currentPreset && <span className="bigscreen-scene-label">{currentPreset.label}</span>}
      </div>

      <PerformanceMonitor label="Render FPS" position="top-right" />
      <PerformanceMonitor label="Pose Rx FPS" trigger={poseUpdateCount} position="bottom-right" />
    </div>
  );
}
