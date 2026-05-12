import { useEffect, useRef, useState, useMemo } from 'react';
import { useBigScreenScene } from '../hooks/useBigScreenScene.ts';
import { SCENE_PRESETS, DEFAULT_SCENE_ID } from '../config/scenes.ts';
import { VRM_SOURCES, DEFAULT_VRM_SOURCE_ID } from '../config/vrmSources.ts';
import PerformanceMonitor from './PerformanceMonitor.tsx';
import { BIGSCREEN_CHANNEL_NAME } from '../config/constants.ts';
import { getRecordings } from '../api.ts';
import { TASK_HINTS, hintLevelMeta } from '../config/taskHints.ts';
import type { HintLevel } from '../config/taskHints.ts';

export interface TaskEntry {
  id: string;
  label: string;
  completed: boolean;
}

/** Message shape broadcast over BroadcastChannel */
export interface BigScreenMsg {
  type: 'pose' | 'leave' | 'scene-change' | 'vrm-change' | 'vrm-identity-change' | 'slot-assign' | 'task-change' | 'recording-start' | 'recording-stop' | 'settlement-done' | 'hint-change';
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
  /** For 'hint-change': 是否啟用提示欄 */
  hintEnabled?: boolean;
  /** For 'hint-change': 目前顯示的階層（null = 不顯示任何階） */
  hintLevel?: HintLevel | null;
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
// ─── Video Background Sub-Component ───────────────────────────────────────────
function VideoBackground({ src, interval }: { src: string; interval?: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Reset video when src changes
    video.currentTime = 0;

    if (interval === undefined || interval <= 0) {
      video.loop = true;
      video.play().catch(() => {/* ignore */ });
      return
    }

    video.loop = false;

    const handleEnded = () => {
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.currentTime = 0;
          videoRef.current.play().catch(() => {/* ignore */ });
        }
      }, interval * 1000);
    };

    video.addEventListener('ended', handleEnded);
    video.play().catch(() => {/* ignore */ });

    return () => {
      video.removeEventListener('ended', handleEnded);
    };
  }, [src, interval]);

  return <video ref={videoRef} src={src} muted playsInline />;
}

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

  const [hintEnabled, setHintEnabled] = useState<boolean>(() => {
    try { return JSON.parse(sessionStorage.getItem('bigscreen-hintEnabled') ?? 'false'); } catch { return false; }
  });
  const [hintLevel, setHintLevel] = useState<HintLevel | null>(() => {
    try { return JSON.parse(sessionStorage.getItem('bigscreen-hintLevel') ?? 'null'); } catch { return null; }
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
  // Reactive flag for settlement panel rendering (mediaRecorderRef is a ref, won't trigger re-render)
  const [isActivelyRecording, setIsActivelyRecording] = useState(false);

  // Refs for recording overlay rendering (always reflect current state)
  const activeTasksRef = useRef<TaskEntry[]>(activeTasks);
  useEffect(() => { activeTasksRef.current = activeTasks; }, [activeTasks]);
  const showSettlementRef = useRef(showSettlement);
  useEffect(() => { showSettlementRef.current = showSettlement; }, [showSettlement]);
  const hasRecordedRef = useRef(hasRecorded);
  useEffect(() => { hasRecordedRef.current = hasRecorded; }, [hasRecorded]);

  // Flush pose count to state every 1 s so PerformanceMonitor count-mode can compute rate.
  useEffect(() => {
    const id = setInterval(() => {
      setPoseUpdateCount(poseCountRef.current);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // const [showStats, setShowStats] = useState(false);
  // const [statsData, setStatsData] = useState<StatsSnapshot | null>(null);

  // ─── Boot loading overlay ──────────────────────────────────────────────────
  // Cover the BigScreen with a "場景載入中" overlay (spinner + progress bar)
  // until the initial scene assets have loaded: static/task props, the snapshot's
  // VRM avatars, and the background image (if any). Each is one progress "unit".
  const bootPlanRef = useRef<{ expectedAvatars: Set<string>; hasBgImage: boolean; total: number } | null>(null);
  if (bootPlanRef.current === null) {
    let expected: string[] = [];
    let hasBgImage = false;
    try {
      const snapshot: Record<string, unknown> = JSON.parse(sessionStorage.getItem('bigscreen-snapshot') || '{}');
      const preset = SCENE_PRESETS[sceneId] ?? SCENE_PRESETS[DEFAULT_SCENE_ID];
      const isSlotted = !!(preset?.slots && preset.slots.length > 0);
      const slotIdentities = new Set<string>(
        Object.values(JSON.parse(sessionStorage.getItem('bigscreen-slotAssignments') || '{}') as Record<string, string>),
      );
      expected = Object.keys(snapshot).filter((id) => !isSlotted || slotIdentities.has(id));
      hasBgImage = preset?.backgroundType === 'image' && !!preset?.backgroundValue;
    } catch { /* ignore — boot overlay will just be quick */ }
    bootPlanRef.current = {
      expectedAvatars: new Set(expected),
      hasBgImage,
      total: expected.length + 1 + (hasBgImage ? 1 : 0), // +1 = scene props
    };
  }
  const bootDoneRef = useRef<Set<string>>(new Set());
  const bootFinishingRef = useRef(false);
  const bootStartRef = useRef<number>(performance.now());
  const [bootProgress, setBootProgress] = useState(0); // 0..100
  const [bootPhase, setBootPhase] = useState<'loading' | 'fading' | 'hidden'>('loading');

  const hideBootOverlay = () => {
    setBootProgress(100);
    setBootPhase((p) => (p === 'loading' ? 'fading' : p));
    window.setTimeout(() => setBootPhase((p) => (p === 'fading' ? 'hidden' : p)), 450);
  };
  const maybeFinishBoot = () => {
    if (bootFinishingRef.current) return;
    if (bootDoneRef.current.size < (bootPlanRef.current?.total ?? 1)) return;
    bootFinishingRef.current = true;
    const elapsed = performance.now() - bootStartRef.current;
    window.setTimeout(hideBootOverlay, Math.max(0, 700 - elapsed)); // keep visible briefly so it never just flashes
  };
  const bumpBootUnit = (unitId: string) => {
    if (bootDoneRef.current.has(unitId)) return;
    bootDoneRef.current.add(unitId);
    const total = bootPlanRef.current?.total ?? 1;
    setBootProgress(Math.min(100, Math.round((bootDoneRef.current.size / total) * 100)));
    maybeFinishBoot();
  };

  // Safety net: never let the overlay get stuck if an asset stalls.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (bootFinishingRef.current) return;
      bootFinishingRef.current = true;
      hideBootOverlay();
    }, 20000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { applyPose, removeAvatar, swapAvatar, setVrmOverride, ensureAvatar } = useBigScreenScene(canvasRef, {
    sceneId,
    vrmSourceId,
    slotAssignments,
    currentTaskId,
    onStats: undefined, // showStats ? setStatsData : undefined,
    onScenePropsReady: () => bumpBootUnit('props'),
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

  /** Draw a rounded-rect path without relying on ctx.roundRect (avoid TS lib gaps). */
  const rrPath = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  };

  /**
   * Paint the Overlay UI Layer and Settlement overlay onto the recording canvas.
   * Reads exclusively from refs so any render cycle's drawFrame gets fresh data.
   */
  const _drawOverlayOnCanvas = (ctx: CanvasRenderingContext2D, cw: number, ch: number) => {
    const tasks = activeTasksRef.current;
    const settlement = showSettlementRef.current;
    ctx.save();

    // ── 1. Top pill (bigscreen-overlay) ──────────────────────────────────────
    const titleText = 'MR 雙語角 — 大屏顯示';
    const sceneLabel = SCENE_PRESETS[sceneIdRef.current]?.label ?? '';
    ctx.font = '700 15px system-ui, sans-serif';
    const titleW = ctx.measureText(titleText).width;
    ctx.font = '800 14px system-ui, sans-serif';
    const labelW = sceneLabel ? ctx.measureText(sceneLabel).width : 0;
    const pillPad = 24;
    const pillH = 34;
    const pillW = pillPad + titleW + (sceneLabel ? 10 + labelW : 0) + pillPad;
    const pillX = (cw - pillW) / 2;
    const pillY = 16;

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    rrPath(ctx, pillX, pillY, pillW, pillH, 24);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    rrPath(ctx, pillX, pillY, pillW, pillH, 24);
    ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#F76E12';
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(titleText, pillX + pillPad, pillY + pillH / 2);
    if (sceneLabel) {
      ctx.fillStyle = '#A69688';
      ctx.font = '800 14px system-ui, sans-serif';
      ctx.fillText(sceneLabel, pillX + pillPad + titleW + 10, pillY + pillH / 2);
    }

    // ── 2. Current-task box (bigscreen-current-task-container) ────────────────
    const currentTask = tasks.find(t => !t.completed);
    if (currentTask) {
      ctx.font = '800 24px system-ui, sans-serif';
      const maxLW = Math.min(cw * 0.8, 860);
      const boxW = Math.max(480, Math.min(ctx.measureText(currentTask.label).width + 80, maxLW + 80));
      const boxH = 75;
      const boxX = (cw - boxW) / 2;
      const boxY = 96;

      ctx.fillStyle = 'rgba(252, 233, 215, 0.92)';
      rrPath(ctx, boxX, boxY, boxW, boxH, 24);
      ctx.fill();
      ctx.strokeStyle = 'rgba(247, 110, 18, 0.3)';
      ctx.lineWidth = 1;
      rrPath(ctx, boxX, boxY, boxW, boxH, 24);
      ctx.stroke();

      ctx.fillStyle = '#000000';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(currentTask.label, cw / 2, boxY + boxH / 2, maxLW);
      ctx.textAlign = 'left';
    }

    // ── 3. Tasks panel (bigscreen-tasks-container, top-right) ─────────────────
    if (tasks.length > 0) {
      const completedCount = tasks.filter(t => t.completed).length;
      // const otherTasks = tasks.filter(t => t.id !== currentTask?.id && !t.completed);
      const panelW = 250;
      const pad = 16;
      // const itemH = 32;
      const panelX = cw - 24 - panelW;
      const panelY = 96;
      const panelH = pad + 26 + 12 + 8 + 12 + pad //+ (otherTasks.length > 0 ? otherTasks.length * itemH + 10 : 0);

      ctx.fillStyle = 'rgba(151, 147, 144, 0.5)';
      rrPath(ctx, panelX, panelY, panelW, panelH, 20);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1;
      rrPath(ctx, panelX, panelY, panelW, panelH, 20);
      ctx.stroke();

      let ry = panelY + pad;

      ctx.fillStyle = '#ffffff';
      ctx.font = '700 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`對話進度 (${completedCount}/${tasks.length})`, panelX + panelW / 2, ry);
      ry += 26 + 12;

      const barX = panelX + pad;
      const barW = panelW - pad * 2;
      const barH = 8;
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      rrPath(ctx, barX, ry, barW, barH, 4);
      ctx.fill();
      const ratio = tasks.length > 0 ? completedCount / tasks.length : 0;
      if (ratio > 0) {
        const fillGrad = ctx.createLinearGradient(barX, ry, barX + barW * ratio, ry);
        fillGrad.addColorStop(0, '#95CC4D');
        fillGrad.addColorStop(1, '#00BF23');
        ctx.fillStyle = fillGrad;
        rrPath(ctx, barX, ry, barW * ratio, barH, 4);
        ctx.fill();
      }
      // ry += barH + 12;

      // ctx.textAlign = 'left';
      // for (const t of otherTasks) {
      //   ctx.fillStyle = 'rgba(255,255,255,0.1)';
      //   ctx.beginPath();
      //   ctx.arc(panelX + pad + 11, ry + 11, 11, 0, Math.PI * 2);
      //   ctx.fill();
      //   ctx.fillStyle = '#ffffff';
      //   ctx.font = '700 11px system-ui, sans-serif';
      //   ctx.textAlign = 'center';
      //   ctx.textBaseline = 'middle';
      //   ctx.fillText('?', panelX + pad + 11, ry + 11);
      //   ctx.fillStyle = 'rgba(255,255,255,0.7)';
      //   ctx.font = '13px system-ui, sans-serif';
      //   ctx.textAlign = 'left';
      //   ctx.fillText(t.label, panelX + pad + 22 + 8, ry + 11, panelW - pad - 22 - 8 - pad);
      //   ry += itemH;
      // }
    }

    // ── 4. Settlement overlay (bs-settlement-overlay) ─────────────────────────
    if (settlement) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(0, 0, cw, ch);

      const pw = Math.min(900, cw * 0.9);
      const ph = Math.min(680, ch * 0.9);
      const px = (cw - pw) / 2;
      const py = (ch - ph) / 2;

      ctx.fillStyle = '#ffffff';
      rrPath(ctx, px, py, pw, ph, 24);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.08)';
      ctx.lineWidth = 1;
      rrPath(ctx, px, py, pw, ph, 24);
      ctx.stroke();

      let sy = py + 36;

      // Medal image (read from DOM)
      const medalImg = document.querySelector('.bs-settlement-trophy img') as HTMLImageElement | null;
      if (medalImg && medalImg.complete && medalImg.naturalWidth > 0) {
        const imgSize = 72;
        ctx.drawImage(medalImg, cw / 2 - imgSize / 2, sy, imgSize, imgSize);
        sy += imgSize + 10;
      } else {
        sy += 20;
      }

      ctx.fillStyle = '#333333';
      ctx.font = '800 26px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('情境對話結束', cw / 2, sy);
      sy += 36;

      ctx.fillStyle = '#5EBAAD';
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillText('所有任務已完成！', cw / 2, sy);
      sy += 28;

      ctx.strokeStyle = 'rgba(0,0,0,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + 36, sy);
      ctx.lineTo(px + pw - 36, sy);
      ctx.stroke();
      sy += 16;

      // Three columns — ratio 1 : 1 : 2.5 matching CSS flex
      const colPad = 36;
      const colGap = 20;
      const totalW = pw - colPad * 2 - colGap * 2;
      const unitW = totalW / 4.5;
      const col1W = unitW, col2W = unitW, col3W = unitW * 2.5;
      const col1X = px + colPad, col2X = col1X + col1W + colGap, col3X = col2X + col2W + colGap;

      // Vertical column separators
      ctx.strokeStyle = 'rgba(0,0,0,0.08)';
      ctx.lineWidth = 1;
      [col2X - colGap / 2, col3X - colGap / 2].forEach(sepX => {
        ctx.beginPath();
        ctx.moveTo(sepX, sy);
        ctx.lineTo(sepX, py + ph - 36);
        ctx.stroke();
      });

      const drawColTitle = (text: string, x: number) => {
        ctx.fillStyle = '#999999';
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(text, x, sy);
      };
      drawColTitle('參與人員', col1X);
      drawColTitle('錄製', col2X);
      drawColTitle('任務清單', col3X);

      const rowY = sy + 22;

      // Col 1: Participants
      const participants = Array.from(participantNamesRef.current.entries());
      if (participants.length === 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.font = '13px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('—', col1X, rowY);
      } else {
        let iy = rowY;
        for (const [identity, name] of participants) {
          const isHost = identity.startsWith('host-');
          ctx.fillStyle = isHost ? 'rgba(247, 110, 18, 0.1)' : 'rgba(0,0,0,0.04)';
          rrPath(ctx, col1X, iy, col1W, 34, 8);
          ctx.fill();
          ctx.fillStyle = isHost ? '#F76E12' : '#333333';
          ctx.font = '500 13px system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${isHost ? '👨‍🏫' : '👤'} ${name}${isHost ? ' (老師)' : ''}`, col1X + 8, iy + 17, col1W - 16);
          iy += 40;
        }
      }

      // Col 2: Recording status (bs-rec-status)
      const isRecording = mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive';
      const recPillH = 34;
      if (isRecording) {
        ctx.fillStyle = '#fff5f5';
        rrPath(ctx, col2X, rowY, col2W, recPillH, 8);
        ctx.fill();
        ctx.strokeStyle = '#ffc9c9';
        ctx.lineWidth = 1;
        rrPath(ctx, col2X, rowY, col2W, recPillH, 8);
        ctx.stroke();
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(col2X + 14, rowY + recPillH / 2, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ef4444';
        ctx.font = '600 13px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('錄製中', col2X + 26, rowY + recPillH / 2);
      } else if (hasRecordedRef.current) {
        ctx.fillStyle = '#ebfbee';
        rrPath(ctx, col2X, rowY, col2W, recPillH, 8);
        ctx.fill();
        ctx.strokeStyle = '#d3f9d8';
        ctx.lineWidth = 1;
        rrPath(ctx, col2X, rowY, col2W, recPillH, 8);
        ctx.stroke();
        ctx.fillStyle = '#40c057';
        ctx.font = '600 13px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('✓ 已保存錄製', col2X + 10, rowY + recPillH / 2);
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.04)';
        rrPath(ctx, col2X, rowY, col2W, recPillH, 8);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.font = '13px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('✕ 無錄製', col2X + 10, rowY + recPillH / 2);
      }

      // Col 3: Task list (bs-settlement-task light theme)
      let ty = rowY;
      const taskRowH = 44;
      const taskGap = 8;
      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        const isDone = task.completed;

        ctx.fillStyle = isDone ? '#E6F7F6' : '#F9F9F9';
        rrPath(ctx, col3X, ty, col3W, taskRowH, 12);
        ctx.fill();
        ctx.strokeStyle = isDone ? 'rgba(94, 186, 173, 0.3)' : 'rgba(0,0,0,0.06)';
        ctx.lineWidth = 1;
        rrPath(ctx, col3X, ty, col3W, taskRowH, 12);
        ctx.stroke();

        ctx.fillStyle = isDone ? '#5EBAAD' : 'rgba(0,0,0,0.15)';
        ctx.beginPath();
        ctx.arc(col3X + 18, ty + taskRowH / 2, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), col3X + 18, ty + taskRowH / 2);

        ctx.fillStyle = '#333333';
        ctx.font = '600 14px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(task.label, col3X + 36, ty + taskRowH / 2, col3W - 60);

        ctx.fillStyle = isDone ? '#5EBAAD' : 'rgba(0,0,0,0.3)';
        ctx.font = '700 14px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(isDone ? '✓' : '✕', col3X + col3W - 10, ty + taskRowH / 2);

        ty += taskRowH + taskGap;
      }
    }

    ctx.restore();
  };

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

      // 3. Draw Overlay UI Layer + Settlement overlay
      _drawOverlayOnCanvas(ctx, cw, ch);

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
            setIsActivelyRecording(true)
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
        /*
        setShowStats(v => {
          if (v) setStatsData(null);
          return !v;
        });
        */
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
      //    For avatars the boot overlay is waiting on, mark the unit done once the
      //    underlying VRM load settles (resolve OR reject — we just want it off the bar).
      const expected = bootPlanRef.current?.expectedAvatars;
      for (const [identity, poseData] of Object.entries(snapshot)) {
        const p = applyPose(identity, poseData);
        if (expected?.has(identity)) {
          p.finally(() => bumpBootUnit(`avatar:${identity}`));
        }
      }
      // If the snapshot turned out to contain no avatars we expected, the only
      // remaining boot unit is the scene props (handled via onScenePropsReady).
    } catch (e) {
      console.warn('[BigScreen] Failed to parse snapshot', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once after mount

  const stopRecordingAndUpload = (onDone?: () => void) => {
    const mr = mediaRecorderRef.current
    if (recordingRafRef.current) {
      cancelAnimationFrame(recordingRafRef.current)
      recordingRafRef.current = null
    }
    if (!mr || mr.state === 'inactive') {
      setIsActivelyRecording(false)
      onDone?.()
      return
    }
    mr.onstop = async () => {
      const blob = new Blob(recordingChunksRef.current, { type: 'video/webm' })
      const sessionId = recordingSessionIdRef.current
      const roomId = roomIdRef.current
      if (!sessionId || !roomId) {
        console.warn('[BigScreen] Cannot upload: missing sessionId or roomId')
        setIsActivelyRecording(false)
        onDone?.()
        return
      }
      // Audio is recorded server-side per-participant; this blob is video-only.
      try {
        const res = await fetch(`/api/rooms/${roomId}/recording/bigscreen`, {
          method: 'POST',
          headers: { 'Content-Type': 'video/webm', 'X-Session-Id': sessionId },
          body: blob,
        })
        if (!res.ok) console.error('[BigScreen] Upload failed:', res.status)
      } catch (err) {
        console.error('[BigScreen] Failed to upload recording:', err)
      }
      mediaRecorderRef.current = null
      recordingChunksRef.current = []
      recordingSessionIdRef.current = null
      setIsActivelyRecording(false)
      onDone?.()
    }
    mr.stop()
  }
  const stopRecordingAndUploadRef = useRef(stopRecordingAndUpload)
  stopRecordingAndUploadRef.current = stopRecordingAndUpload

  // Auto-stop recording 3 s after the settlement overlay appears,
  // so the overlay is captured in the video before the stream closes.
  // After stopping (or if no recording), broadcast 'settlement-done' so HostSession
  // can stop the backend recording at the right time.
  useEffect(() => {
    if (!showSettlement) return
    const mr = mediaRecorderRef.current
    const channelForDone = new BroadcastChannel(BIGSCREEN_CHANNEL_NAME)
    const notifyDone = () => {
      channelForDone.postMessage({ type: 'settlement-done' } satisfies BigScreenMsg)
      channelForDone.close()
    }
    if (!mr || mr.state === 'inactive') {
      // No active BigScreen recording — notify HostSession immediately
      notifyDone()
      return
    }
    const timer = setTimeout(() => {
      // Pass notifyDone as onDone so it runs after upload completes
      stopRecordingAndUploadRef.current(notifyDone)
    }, 2000)
    return () => {
      clearTimeout(timer)
      channelForDone.close()
    }
  }, [showSettlement])

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
      } else if (msg.type === 'hint-change') {
        const en = msg.hintEnabled ?? false;
        const lv = msg.hintLevel ?? null;
        setHintEnabled(en);
        setHintLevel(lv);
        sessionStorage.setItem('bigscreen-hintEnabled', JSON.stringify(en));
        sessionStorage.setItem('bigscreen-hintLevel', JSON.stringify(lv));
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
          setIsActivelyRecording(true)
        } catch (err) {
          console.error('[BigScreen] Failed to start canvas recording:', err)
        }
      } else if (msg.type === 'recording-stop') {
        stopRecordingAndUploadRef.current()
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
            <img
              src={currentPreset.backgroundValue}
              alt="Background"
              ref={(el) => { if (el && el.complete && el.naturalWidth > 0) bumpBootUnit('bg'); }}
              onLoad={() => bumpBootUnit('bg')}
              onError={() => bumpBootUnit('bg')}
            />
          )}
          {currentPreset.backgroundType === 'video' && currentPreset.backgroundValue && (
            <VideoBackground src={currentPreset.backgroundValue} interval={currentPreset.videoLoopInterval} />
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
        <span className="bigscreen-title">MR 雙語角 — 大屏顯示</span>
        {currentPreset && <span className="bigscreen-scene-label">{currentPreset.label}</span>}
      </div>

      {isActivelyRecording && (
        <div
          className="bigscreen-recording-indicator"
          style={{
            position: 'absolute',
            top: '20px',
            left: '30px',
            backgroundColor: 'rgba(252, 233, 215, 0.9)',
            border: '1px solid rgba(247, 110, 18, 0.3)',
            padding: '8px 16px',
            borderRadius: '18px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: '#ef4444',
            fontSize: '16px',
            fontWeight: 'bold',
            zIndex: 100,
            backdropFilter: 'blur(6px)'
          }}
        >
          <span className="recording-dot" />
          錄製中
        </div>
      )}

      {activeTasks.length > 0 && (() => {
        const currentTask = activeTasks.find(t => !t.completed);
        // const otherTasks = activeTasks.filter(t => t.id !== currentTask?.id && !t.completed);

        return (
          <>
            {currentTask && (
              <div className="bigscreen-current-task-container">
                <div className="bigscreen-current-task-label">{currentTask.label}</div>
                {/* Hint bar — 附著在中央米色對話框底部，顯示當前任務選定階的提示 */}
                {hintEnabled && hintLevel && currentTaskId && (() => {
                  const hint = TASK_HINTS[currentTaskId];
                  const meta = hintLevelMeta(hintLevel);
                  return (
                    <div className="bs-hint-bar">
                      <span className="bs-hint-bar-tag">{meta.num} {meta.label}</span>
                      <span className="bs-hint-bar-content">
                        {!hint ? (
                          <span className="bs-hint-empty">此任務尚無提示</span>
                        ) : hintLevel === 'keyword' ? (
                          hint.keyword.map((w, i) => <span key={i} className="bs-hint-chip">{w}</span>)
                        ) : hintLevel === 'options' ? (
                          hint.options.map((o, i) => (
                            <span key={i} className="bs-hint-opt"><b>{i + 1}.</b> {o}</span>
                          ))
                        ) : (
                          <span className="bs-hint-line">{hintLevel === 'sentenceStart' ? hint.sentenceStart : hintLevel === 'halfPattern' ? hint.halfPattern : hint.fullDemo}</span>
                        )}
                      </span>
                    </div>
                  );
                })()}
              </div>
            )}

            <div className="bigscreen-tasks-container">
              <div className="bigscreen-tasks-progress-header">
                對話進度 ({activeTasks.filter(t => t.completed).length}/{activeTasks.length})
              </div>
              <div className="bigscreen-tasks-progress-bg">
                <div
                  className="bigscreen-tasks-progress-fill"
                  style={{ width: `${activeTasks.length > 0 ? (activeTasks.filter(t => t.completed).length / activeTasks.length) * 100 : 0}%` }}
                />
              </div>
              {/* <div className="bigscreen-tasks-list">
                {otherTasks.map((t, idx) => {
                  // Re-calculate the original index for display
                  const originalIndex = activeTasks.findIndex(it => it.id === t.id);
                  return (
                    <div
                      key={`${t.id}-${originalIndex}`}
                      className={`bigscreen-task-item ${t.completed ? 'completed' : ''}`}
                    >
                      <div className="bigscreen-task-status">
                        {t.completed ? '✓' : '?'}
                      </div>
                      <div className="bigscreen-task-label">{t.label}</div>
                    </div>
                  );
                })}
              </div> */}
            </div>
          </>
        );
      })()}

      {/* Settlement overlay on BigScreen */}
      {showSettlement && (
        <div className="bs-settlement-overlay">
          <div className="bs-settlement-panel">
            {/* Header */}
            <div className="bs-settlement-header">
              <div className="bs-settlement-trophy">
                {/* <span className="material-symbols-outlined bs-settlement-trophy-icon">workspace_premium</span> */}
                <img src="/images/medal.png" alt="Trophy" />
              </div>
              <div className="bs-settlement-title">情境對話結束</div>
              <div className="bs-settlement-subtitle">所有任務已完成！</div>
            </div>

            <div className="bs-settlement-columns">
              <div className="bs-settlement-grid">
                {/* Left: Participants */}
                <div className="bs-settlement-col">
                  <div className="bs-settlement-col-title">參與人員</div>
                  <div className="bs-settlement-participants">
                    {Array.from(participantNames.entries()).map(([identity, name]) => {
                      const isHost = identity.startsWith('host-');
                      return (
                        <div key={identity} className={`bs-settlement-participant ${isHost ? 'host' : ''}`}>
                          <span className="material-icons bs-participant-icon">
                            {isHost ? 'school' : 'person'}
                          </span>
                          <span className="bs-participant-name">
                            {name}
                            {isHost && <span className="bs-teacher-label">老師</span>}
                          </span>
                        </div>
                      );
                    })}
                    {participantNames.size === 0 && (
                      <div className="bs-settlement-participant">
                        <span>—</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Middle: Recording */}
                <div className="bs-settlement-col">
                  <div className="bs-settlement-col-title">錄製</div>
                  <div className={`bs-rec-status ${isActivelyRecording ? 'active' : hasRecorded ? 'done' : ''}`}>
                    {isActivelyRecording ? (
                      <>
                        <span className="recording-dot" />
                        <span>錄製中</span>
                      </>
                    ) : hasRecorded ? (
                      <>
                        <span className="material-icons" style={{ fontSize: '18px' }}>check</span>
                        <span>已保存錄製</span>
                      </>
                    ) : (
                      <>
                        <span className="material-icons" style={{ fontSize: '18px' }}>videocam_off</span>
                        <span>無錄製</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Tasks List */}
              <div className="bs-settlement-col">
                <div className="bs-settlement-col-title">任務清單</div>
                <div className="bs-settlement-tasklist">
                  {activeTasks.map((task, idx) => (
                    <div key={task.id} className={`bs-settlement-task ${task.completed ? 'done' : 'undone'}`}>
                      <div className="bs-task-num">{idx + 1}</div>
                      <span className="bs-task-label">{task.label}</span>
                      <span className="bs-task-check">
                        {task.completed ? <span className="material-symbols-outlined">
                          check
                        </span> : <span className="material-symbols-outlined">
                          close
                        </span>}
                      </span>
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
      {/* {showStats && statsData && <StatsPanel data={statsData} />} */}

      {/* Boot loading overlay — covers the scene until initial assets are loaded */}
      {bootPhase !== 'hidden' && (
        <div className={`bigscreen-loading-overlay${bootPhase === 'fading' ? ' is-fading' : ''}`}>
          <div className="bs-loading-inner">
            <div className="gradient-spinner" />
            <div className="bs-loading-title">場景載入中…</div>
            <div className="bs-loading-bar">
              <div className="bs-loading-bar-fill" style={{ width: `${bootProgress}%` }} />
            </div>
            <div className="bs-loading-pct">{bootProgress}%</div>
          </div>
        </div>
      )}
    </div >
  );
}
