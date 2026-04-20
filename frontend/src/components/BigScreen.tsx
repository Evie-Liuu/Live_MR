import { useEffect, useRef, useState, useMemo } from 'react';
import { useBigScreenScene } from '../hooks/useBigScreenScene.ts';
import { SCENE_PRESETS, DEFAULT_SCENE_ID } from '../config/scenes.ts';
import { VRM_SOURCES, DEFAULT_VRM_SOURCE_ID } from '../config/vrmSources.ts';
import PerformanceMonitor from './PerformanceMonitor.tsx';
import StatsPanel, { type StatsSnapshot } from './StatsPanel.tsx';
import { BIGSCREEN_CHANNEL_NAME } from '../config/constants.ts';
import { getRecordings } from '../api.ts';

export interface TaskEntry {
  id: string;
  label: string;
  completed: boolean;
}

/** Message shape broadcast over BroadcastChannel */
export interface BigScreenMsg {
  type: 'pose' | 'leave' | 'scene-change' | 'vrm-change' | 'vrm-identity-change' | 'slot-assign' | 'task-change' | 'recording-start' | 'recording-stop';
  identity?: string;
  poseData?: unknown;
  /** For 'scene-change': new scene preset ID */
  sceneId?: string;
  /** For 'vrm-change': new VRM source ID (global fallback for new avatars) */
  vrmSourceId?: string;
  /** For 'vrm-identity-change': swap the VRM for a specific participant */
  vrmUrl?: string;
  /** For 'slot-assign': which slot to assign/clear */
  slotId?: string;
  /** For 'task-change': full list of ordered tasks */
  tasks?: TaskEntry[];
  /** For 'recording-start': session identifier */
  sessionId?: string;
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
    const saved = sessionStorage.getItem('bigscreen-sceneId');
    if (saved && SCENE_PRESETS[saved]) return saved;
    return DEFAULT_SCENE_ID;
  });
  const sceneIdRef = useRef<string>(sceneId);
  useEffect(() => { sceneIdRef.current = sceneId; }, [sceneId]);
  const [vrmSourceId, setVrmSourceId] = useState<string>(() => {
    return sessionStorage.getItem('bigscreen-vrmSourceId') ?? 'default';
  });
  const [slotAssignments, setSlotAssignments] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(sessionStorage.getItem('bigscreen-slotAssignments') || '{}');
    } catch { return {}; }
  });
  /** BigScreen-local ref: slotId → identity for resolving unassign (identity == null) */
  const slotAssignmentsRef = useRef<Map<string, string>>(
    new Map(Object.entries(JSON.parse(sessionStorage.getItem('bigscreen-slotAssignments') || '{}')))
  );
  const [activeTasks, setActiveTasks] = useState<TaskEntry[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem('bigscreen-tasks') || '[]');
    } catch { return []; }
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const currentTaskId = activeTasks.find(t => !t.completed)?.id;

  // Settlement panel: shown when all tasks are done
  const allDone = activeTasks.length > 0 && activeTasks.every(t => t.completed);
  const [showSettlement, setShowSettlement] = useState(false);
  const prevAllDoneRef = useRef(false);
  useEffect(() => {
    if (allDone && !prevAllDoneRef.current) {
      setShowSettlement(true);
    }
    prevAllDoneRef.current = allDone;
  }, [allDone]);

  /** Track identities that have appeared (for participant list in settlement) */
  const participantNamesRef = useRef<Map<string, string>>(new Map());
  const [participantNames, setParticipantNames] = useState<Map<string, string>>(new Map());

  const poseCountRef = useRef(0);
  const [poseUpdateCount, setPoseUpdateCount] = useState(0);
  const [hasRecorded, setHasRecorded] = useState(false);

  // Flush pose count to state every 1 s so PerformanceMonitor count-mode can compute rate.
  useEffect(() => {
    const id = setInterval(() => {
      setPoseUpdateCount(poseCountRef.current);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const [showStats, setShowStats] = useState(false);
  const [statsData, setStatsData] = useState<StatsSnapshot | null>(null);

  const { applyPose, removeAvatar, swapAvatar, setVrmOverride, ensureAvatar } = useBigScreenScene(canvasRef, {
    sceneId,
    vrmSourceId,
    slotAssignments,
    currentTaskId,
    onStats: showStats ? setStatsData : undefined,
  });
  const removeAvatarRef = useRef(removeAvatar);
  removeAvatarRef.current = removeAvatar;
  const applyPoseRef = useRef(applyPose);
  applyPoseRef.current = applyPose;
  const swapAvatarRef = useRef(swapAvatar);
  swapAvatarRef.current = swapAvatar;
  const setVrmOverrideRef = useRef(setVrmOverride);
  setVrmOverrideRef.current = setVrmOverride;
  const ensureAvatarRef = useRef(ensureAvatar);
  ensureAvatarRef.current = ensureAvatar;

  /** Identities whose VRM override has already been registered this session */
  const seenIdentitiesRef = useRef<Set<string>>(new Set());

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])
  const recordingSessionIdRef = useRef<string | null>(null)
  const roomIdRef = useRef<string>(sessionStorage.getItem('bigscreen-roomId') ?? '')
  const recordingRafRef = useRef<number | null>(null)

  const startCompositeStream = (sourceCanvas: HTMLCanvasElement): MediaStream => {
    const compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = sourceCanvas.width || window.innerWidth;
    compositeCanvas.height = sourceCanvas.height || window.innerHeight;
    const ctx = compositeCanvas.getContext('2d')!;

    const drawCover = (ctx: CanvasRenderingContext2D, element: HTMLImageElement | HTMLVideoElement, cw: number, ch: number) => {
      let sw = 0;
      let sh = 0;
      if (element.tagName === 'IMG') {
        sw = (element as HTMLImageElement).naturalWidth;
        sh = (element as HTMLImageElement).naturalHeight;
      } else {
        sw = (element as HTMLVideoElement).videoWidth;
        sh = (element as HTMLVideoElement).videoHeight;
      }
      if (!sw || !sh) {
        ctx.drawImage(element, 0, 0, cw, ch);
        return;
      }
      const scale = Math.max(cw / sw, ch / sh);
      const dw = sw * scale;
      const dh = sh * scale;
      const dx = (cw - dw) / 2;
      const dy = (ch - dh) / 2;
      ctx.drawImage(element, 0, 0, sw, sh, dx, dy, dw, dh);
    };

    const drawFrame = () => {
      const cw = sourceCanvas.width || window.innerWidth;
      const ch = sourceCanvas.height || window.innerHeight;
      if (compositeCanvas.width !== cw) compositeCanvas.width = cw;
      if (compositeCanvas.height !== ch) compositeCanvas.height = ch;

      ctx.clearRect(0, 0, cw, ch);

      // 1. Draw Background
      const bgDiv = document.querySelector('.bigscreen-bg') as HTMLElement;
      let hasBg = false;
      if (bgDiv) {
        const bgColor = bgDiv.style.backgroundColor;
        if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
          ctx.fillStyle = bgColor;
          ctx.fillRect(0, 0, cw, ch);
          hasBg = true;
        }

        const img = bgDiv.querySelector('img');
        if (img && img.complete && img.naturalWidth > 0) {
          drawCover(ctx, img, cw, ch);
          hasBg = true;
        }

        const video = bgDiv.querySelector('video');
        if (video && video.readyState >= 2) {
          drawCover(ctx, video, cw, ch);
          hasBg = true;
        }
      }

      if (!hasBg) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, cw, ch);
      }

      // 2. Draw 3D Canvas
      ctx.drawImage(sourceCanvas, 0, 0, cw, ch);

      recordingRafRef.current = requestAnimationFrame(drawFrame);
    };

    recordingRafRef.current = requestAnimationFrame(drawFrame);
    return compositeCanvas.captureStream(30);
  };

  // Restore recording state on mount
  useEffect(() => {
    if (!roomIdRef.current) return
    getRecordings(roomIdRef.current)
      .then((sessions) => {
        const active = sessions.find((s) => s.status === 'recording')
        if (active && !mediaRecorderRef.current) {
          console.log('[BigScreen] Restoring active recording session:', active.sessionId)
          setHasRecorded(true)
          recordingChunksRef.current = []
          recordingSessionIdRef.current = active.sessionId
          const canvas = canvasRef.current
          if (!canvas) return
          try {
            if (recordingRafRef.current) cancelAnimationFrame(recordingRafRef.current)
            const stream = startCompositeStream(canvas)
            const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
              ? 'video/webm;codecs=vp9'
              : 'video/webm'
            const mr = new MediaRecorder(stream, { mimeType })
            mr.ondataavailable = (e) => {
              if (e.data.size > 0) recordingChunksRef.current.push(e.data)
            }
            mr.start(1000)
            mediaRecorderRef.current = mr
          } catch (err) {
            console.error('[BigScreen] Failed to restore canvas recording on mount:', err)
          }
        }
      })
      .catch(() => { /* ignore */ })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '`') {
        setShowStats(v => {
          if (v) setStatsData(null);
          return !v;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
      //    applyPose will skip identities not assigned to a slot in slotted scenes.
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
        // Track participant name for settlement panel
        if (!participantNamesRef.current.has(msg.identity)) {
          participantNamesRef.current.set(msg.identity, msg.identity);
          setParticipantNames(new Map(participantNamesRef.current));
        }
        applyPoseRef.current(msg.identity, msg.poseData);
        poseCountRef.current++;
      } else if (msg.type === 'leave' && msg.identity) {
        removeAvatarRef.current(msg.identity);
        // Remove from slot assignments if they were assigned
        for (const [slotId, id] of slotAssignmentsRef.current) {
          if (id === msg.identity) {
            slotAssignmentsRef.current.delete(slotId);
            setSlotAssignments(prev => {
              const next = { ...prev };
              delete next[slotId];
              return next;
            });
          }
        }
        // Prune all BigScreen-local sessionStorage keys so a refresh won't
        // reload a ghost model for this departed participant.
        try {
          const snap = JSON.parse(sessionStorage.getItem('bigscreen-snapshot') || '{}') as Record<string, unknown>;
          delete snap[msg.identity];
          sessionStorage.setItem('bigscreen-snapshot', JSON.stringify(snap));
        } catch {/* ignore */ }
        try {
          const roles = JSON.parse(sessionStorage.getItem('bigscreen-studentRoles') || '{}') as Record<string, string>;
          delete roles[msg.identity];
          sessionStorage.setItem('bigscreen-studentRoles', JSON.stringify(roles));
        } catch {/* ignore */ }
        try {
          const live = JSON.parse(sessionStorage.getItem('bigscreen-liveVrmUrls') || '{}') as Record<string, string>;
          delete live[msg.identity];
          sessionStorage.setItem('bigscreen-liveVrmUrls', JSON.stringify(live));
        } catch {/* ignore */ }
      } else if (msg.type === 'slot-assign' && msg.slotId !== undefined) {
        if (msg.identity != null) {
          // Assign identity to slot
          slotAssignmentsRef.current.set(msg.slotId, msg.identity);
          setSlotAssignments(prev => ({ ...prev, [msg.slotId!]: msg.identity! }));
          try {
            const stored = JSON.parse(sessionStorage.getItem('bigscreen-slotAssignments') || '{}');
            stored[msg.slotId] = msg.identity;
            sessionStorage.setItem('bigscreen-slotAssignments', JSON.stringify(stored));
          } catch {/* ignore */ }
          // Immediately load avatar at slot position (before next pose frame)
          const preset = SCENE_PRESETS[sceneIdRef.current];
          const sceneSlot = preset?.slots?.find(s => s.id === msg.slotId);
          if (sceneSlot) {
            const teacherVrmId = sessionStorage.getItem('bigscreen-teacherVrmSourceId');
            const roles: Record<string, string> = JSON.parse(
              sessionStorage.getItem('bigscreen-studentRoles') || '{}',
            );
            const liveUrls: Record<string, string> = JSON.parse(
              sessionStorage.getItem('bigscreen-liveVrmUrls') || '{}',
            );
            const vrmUrl = resolveVrmUrl(msg.identity, liveUrls, roles, teacherVrmId);
            const spawn = {
              position: sceneSlot.position,
              rotation: sceneSlot.rotation,
              scale: preset.avatarDefaults?.scale,
            };
            ensureAvatarRef.current(msg.identity, vrmUrl, spawn).catch(() => {/* ignore */ });
          }
        } else {
          // Unassign: remove previous occupant
          const prevIdentity = slotAssignmentsRef.current.get(msg.slotId);
          if (prevIdentity) {
            removeAvatarRef.current(prevIdentity);
            slotAssignmentsRef.current.delete(msg.slotId);
            setSlotAssignments(prev => {
              const next = { ...prev };
              delete next[msg.slotId!];
              return next;
            });
            try {
              const stored = JSON.parse(sessionStorage.getItem('bigscreen-slotAssignments') || '{}');
              delete stored[msg.slotId];
              sessionStorage.setItem('bigscreen-slotAssignments', JSON.stringify(stored));
            } catch {/* ignore */ }
          }
        }
      } else if (msg.type === 'scene-change' && msg.sceneId) {
        setSceneId(msg.sceneId);
        sessionStorage.setItem('bigscreen-sceneId', msg.sceneId);
        setHasRecorded(false);
        // Clear slot assignments — they are scene-specific
        setSlotAssignments({});
        slotAssignmentsRef.current.clear();
        sessionStorage.removeItem('bigscreen-slotAssignments');
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
        } catch {/* ignore */ }
      } else if (msg.type === 'task-change') {
        const tasks = msg.tasks ?? [];
        setActiveTasks(tasks);
        sessionStorage.setItem('bigscreen-tasks', JSON.stringify(tasks));
      } else if (msg.type === 'recording-start' && msg.sessionId) {
        const existing = mediaRecorderRef.current
        if (existing && existing.state !== 'inactive') {
          existing.stop()
        }
        setHasRecorded(true)
        recordingChunksRef.current = []
        recordingSessionIdRef.current = msg.sessionId
        const canvas = canvasRef.current
        if (!canvas) return
        try {
          if (recordingRafRef.current) cancelAnimationFrame(recordingRafRef.current)
          const stream = startCompositeStream(canvas)
          const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
            ? 'video/webm;codecs=vp9'
            : 'video/webm'
          const mr = new MediaRecorder(stream, { mimeType })
          mr.ondataavailable = (e) => {
            if (e.data.size > 0) recordingChunksRef.current.push(e.data)
          }
          mr.start(1000)
          mediaRecorderRef.current = mr
        } catch (err) {
          console.error('[BigScreen] Failed to start canvas recording:', err)
        }
      } else if (msg.type === 'recording-stop') {
        const mr = mediaRecorderRef.current
        if (recordingRafRef.current) {
          cancelAnimationFrame(recordingRafRef.current)
          recordingRafRef.current = null
        }
        if (!mr || mr.state === 'inactive') return
        mr.onstop = async () => {
          const blob = new Blob(recordingChunksRef.current, { type: 'video/webm' })
          const sessionId = recordingSessionIdRef.current
          const roomId = roomIdRef.current
          if (!sessionId || !roomId) {
            console.warn('[BigScreen] Cannot upload: missing sessionId or roomId')
            return
          }
          // Audio is recorded server-side per-participant; this blob is video-only.
          // Note: no size limit — assumes sessions are under ~10 minutes per design.
          try {
            const res = await fetch(`/api/rooms/${roomId}/recording/bigscreen`, {
              method: 'POST',
              headers: {
                'Content-Type': 'video/webm',
                'X-Session-Id': sessionId,
              },
              body: blob,
            })
            if (!res.ok) console.error('[BigScreen] Upload failed:', res.status)
          } catch (err) {
            console.error('[BigScreen] Failed to upload recording:', err)
          }
          mediaRecorderRef.current = null
          recordingChunksRef.current = []
          recordingSessionIdRef.current = null
        }
        mr.stop()
      }
    };

    return () => {
      channel.close()
      const mr = mediaRecorderRef.current
      if (mr && mr.state !== 'inactive') {
        mr.stop()
      }
      if (recordingRafRef.current) {
        cancelAnimationFrame(recordingRafRef.current)
        recordingRafRef.current = null
      }
    };
  }, []); // channel lifecycle independent of applyPose/removeAvatar

  const currentPreset = useMemo(() => SCENE_PRESETS[sceneId] || SCENE_PRESETS[DEFAULT_SCENE_ID], [sceneId]);

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

      {activeTasks.length > 0 && (() => {
        const currentTask = activeTasks.find(t => !t.completed);
        const otherTasks = activeTasks.filter(t => t.id !== currentTask?.id);

        return (
          <>
            {currentTask && (
              <div className="bigscreen-current-task-container">
                <div className="bigscreen-current-task-label">{currentTask.label}</div>
              </div>
            )}

            <div className="bigscreen-tasks-container">
              <div className="bigscreen-tasks-list">
                {otherTasks.map((t, idx) => {
                  // Re-calculate the original index for display
                  const originalIndex = activeTasks.findIndex(it => it.id === t.id);
                  return (
                    <div
                      key={`${t.id}-${originalIndex}`}
                      className={`bigscreen-task-item ${t.completed ? 'completed' : ''}`}
                    >
                      <div className="bigscreen-task-status">
                        {t.completed ? '✓' : originalIndex + 1}
                      </div>
                      <div className="bigscreen-task-label">{t.label}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        );
      })()}

      {/* Settlement overlay on BigScreen */}
      {showSettlement && (
        <div className="bs-settlement-overlay">
          <div className="bs-settlement-panel">
            {/* Close button */}
            <button className="bs-settlement-close" onClick={() => setShowSettlement(false)}>✕</button>

            {/* Trophy header */}
            <div className="bs-settlement-header">
              <div className="bs-settlement-trophy">🏆</div>
              <div className="bs-settlement-title">情境對話結束</div>
              <div className="bs-settlement-subtitle">所有任務已完成！</div>
            </div>

            <div className="bs-settlement-columns">
              {/* Left: Participants */}
              <div className="bs-settlement-col">
                <div className="bs-settlement-col-title">👥 參與人員</div>
                <div className="bs-settlement-participants">
                  {Array.from(participantNames.entries()).map(([identity, name]) => (
                    <div key={identity} className={`bs-settlement-participant ${identity.startsWith('host-') ? 'host' : ''}`}>
                      <span>{identity.startsWith('host-') ? '👨‍🏫' : '👤'}</span>
                      <span>{name}</span>
                      {identity.startsWith('host-') && <span className="bs-participant-tag">老師</span>}
                    </div>
                  ))}
                  {participantNames.size === 0 && (
                    <div className="bs-settlement-empty">—</div>
                  )}
                </div>
              </div>

              {/* Middle: Recording */}
              <div className="bs-settlement-col">
                <div className="bs-settlement-col-title">🎬 錄製</div>
                <div className="bs-settlement-rec">
                  {mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive' ? (
                    <div className="bs-rec-active">
                      <span className="recording-dot" />
                      <span>錄製中</span>
                    </div>
                  ) : hasRecorded ? (
                    <div className="bs-rec-done">✓ 已保存錄製</div>
                  ) : (
                    <div className="bs-rec-none">✕ 無錄製</div>
                  )}
                </div>
              </div>

              {/* Right: Tasks */}
              <div className="bs-settlement-col bs-settlement-col--tasks">
                <div className="bs-settlement-col-title">📋 任務清單</div>
                <div className="bs-settlement-tasklist">
                  {activeTasks.map((task, idx) => (
                    <div key={task.id} className={`bs-settlement-task ${task.completed ? 'done' : 'undone'}`}>
                      <div className="bs-task-num">{idx + 1}</div>
                      <span className="bs-task-label">{task.label}</span>
                      <span className="bs-task-check">{task.completed ? '✓' : '✕'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="bs-settlement-footer">
              <button className="bs-settlement-dismiss" onClick={() => setShowSettlement(false)}>關閉</button>
            </div>
          </div>
        </div>
      )}

      <PerformanceMonitor label="Render FPS" position="top-right" />
      <PerformanceMonitor label="Pose Rx FPS" count={poseUpdateCount} position="bottom-right" />
      {showStats && statsData && <StatsPanel data={statsData} />}
    </div>
  );
}
