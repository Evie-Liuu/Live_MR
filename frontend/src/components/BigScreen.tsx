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

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Resolve the VRM URL for a participant, given the current role mappings.
 * Priority: liveUrls (most recent vrm-identity-change) > teacherVrmId (host-*) > studentRole > undefined (use global default)
 */
function resolveVrmUrl(
  identity: string,
  liveUrls: Record<string, string>,
  roles: Record<string, string>,
  teacherVrmId: string | null,
): string | undefined {
  if (liveUrls[identity]) return liveUrls[identity];
  if (identity.startsWith('host-') && teacherVrmId) {
    return (VRM_SOURCES[teacherVrmId] || VRM_SOURCES[DEFAULT_VRM_SOURCE_ID]).url;
  }
  if (roles[identity]) {
    return (VRM_SOURCES[roles[identity]] || VRM_SOURCES[DEFAULT_VRM_SOURCE_ID]).url;
  }
  return undefined; // caller falls back to global vrmSourceId via ensureAvatar
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
  const { applyPose, removeAvatar, swapAvatar, setVrmOverride } = useBigScreenScene(canvasRef, { sceneId, vrmSourceId });
  const removeAvatarRef = useRef(removeAvatar);
  removeAvatarRef.current = removeAvatar;
  const applyPoseRef = useRef(applyPose);
  applyPoseRef.current = applyPose;
  const swapAvatarRef = useRef(swapAvatar);
  swapAvatarRef.current = swapAvatar;
  const setVrmOverrideRef = useRef(setVrmOverride);
  setVrmOverrideRef.current = setVrmOverride;

  const [poseUpdateCount, setPoseUpdateCount] = useState(0);
  /** Identities whose VRM override has already been registered this session */
  const seenIdentitiesRef = useRef<Set<string>>(new Set());

  // Apply snapshot stored by HostSession before the window was opened
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('bigscreen-snapshot');
      const snapshot: Record<string, unknown> = raw ? JSON.parse(raw) : {};

      const teacherVrmId = sessionStorage.getItem('bigscreen-teacherVrmSourceId');
      const roles: Record<string, string> = JSON.parse(
        sessionStorage.getItem('bigscreen-studentRoles') || '{}',
      );
      // Live role changes received after BigScreen was opened (takes priority).
      // Written by the vrm-identity-change channel handler below.
      const liveUrls: Record<string, string> = JSON.parse(
        sessionStorage.getItem('bigscreen-liveVrmUrls') || '{}',
      );

      // ① Pre-register VRM overrides for all snapshot identities WITHOUT loading.
      //    ensureAvatar (called by applyPose below) will pick up the override and
      //    load the correct model — no T-pose ghost models.
      for (const identity of Object.keys(snapshot)) {
        seenIdentitiesRef.current.add(identity);
        const vrmUrl = resolveVrmUrl(identity, liveUrls, roles, teacherVrmId);
        if (vrmUrl) setVrmOverrideRef.current(identity, vrmUrl);
      }

      // ② Apply poses — ensureAvatar picks up the pre-registered override above.
      for (const [identity, poseData] of Object.entries(snapshot)) {
        applyPose(identity, poseData);
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
        // On first sight of an identity, pre-register the correct VRM override
        // before ensureAvatar runs.  This handles the case where BigScreen opened
        // after the initial vrm-identity-change broadcast was already sent.
        if (!seenIdentitiesRef.current.has(msg.identity)) {
          seenIdentitiesRef.current.add(msg.identity);
          const teacherVrmId = sessionStorage.getItem('bigscreen-teacherVrmSourceId');
          const roles: Record<string, string> = JSON.parse(
            sessionStorage.getItem('bigscreen-studentRoles') || '{}',
          );
          const liveUrls: Record<string, string> = JSON.parse(
            sessionStorage.getItem('bigscreen-liveVrmUrls') || '{}',
          );
          const vrmUrl = resolveVrmUrl(msg.identity, liveUrls, roles, teacherVrmId);
          if (vrmUrl) setVrmOverrideRef.current(msg.identity, vrmUrl);
        }
        applyPoseRef.current(msg.identity, msg.poseData);
        setPoseUpdateCount(c => c + 1);
      } else if (msg.type === 'leave' && msg.identity) {
        removeAvatarRef.current(msg.identity);
        // Prune all BigScreen-local sessionStorage keys so a refresh won't
        // reload a ghost model for this departed participant.
        try {
          const snap = JSON.parse(sessionStorage.getItem('bigscreen-snapshot') || '{}') as Record<string, unknown>;
          delete snap[msg.identity];
          sessionStorage.setItem('bigscreen-snapshot', JSON.stringify(snap));
        } catch {/* ignore */}
        try {
          const roles = JSON.parse(sessionStorage.getItem('bigscreen-studentRoles') || '{}') as Record<string, string>;
          delete roles[msg.identity];
          sessionStorage.setItem('bigscreen-studentRoles', JSON.stringify(roles));
        } catch {/* ignore */}
        try {
          const live = JSON.parse(sessionStorage.getItem('bigscreen-liveVrmUrls') || '{}') as Record<string, string>;
          delete live[msg.identity];
          sessionStorage.setItem('bigscreen-liveVrmUrls', JSON.stringify(live));
        } catch {/* ignore */}
      } else if (msg.type === 'scene-change' && msg.sceneId) {
        setSceneId(msg.sceneId);
        sessionStorage.setItem('bigscreen-sceneId', msg.sceneId);
      } else if (msg.type === 'vrm-change' && msg.vrmSourceId) {
        setVrmSourceId(msg.vrmSourceId);
        sessionStorage.setItem('bigscreen-vrmSourceId', msg.vrmSourceId);
      } else if (msg.type === 'vrm-identity-change' && msg.identity && msg.vrmUrl) {
        swapAvatarRef.current(msg.identity, msg.vrmUrl);
        // Persist to BigScreen's own sessionStorage (per-window — HostSession's
        // writes don't propagate here) so a refresh restores the live role.
        try {
          const live = JSON.parse(sessionStorage.getItem('bigscreen-liveVrmUrls') || '{}') as Record<string, string>;
          live[msg.identity] = msg.vrmUrl;
          sessionStorage.setItem('bigscreen-liveVrmUrls', JSON.stringify(live));
        } catch {/* ignore */}
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
