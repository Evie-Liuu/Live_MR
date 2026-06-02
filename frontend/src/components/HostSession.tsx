import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  Room,
  RoomEvent,
  RemoteParticipant,
  RemoteTrackPublication,
  Track,
  type Participant,
} from 'livekit-client';
import StudentTile from './StudentTile.tsx';
import LocalVideo from './LocalVideo.tsx';
import { usePoseDetection } from '../hooks/usePoseDetection.ts';
import type { BigScreenMsg, TaskEntry, BackgroundTypeOverride } from './BigScreen';
import type { PoseFrame } from '../types/vrm';
import { SCENE_PRESETS, DEFAULT_SCENE_ID, THEMES } from '../config/scenes.ts';
import { VRM_SOURCES, DEFAULT_VRM_SOURCE_ID } from '../config/vrmSources.ts';
// import PerformanceMonitor from './PerformanceMonitor.tsx';
import { LIVEKIT_URL, BIGSCREEN_CHANNEL_NAME } from '../config/constants.ts';
import { createPoseDecodePool } from '../utils/poseCodec.ts';
import type { PoseDecodePool } from '../utils/poseCodec.ts';
import { TASK_HINTS, HINT_LEVELS, hintLevelMeta } from '../config/taskHints.ts';
import type { HintLevel } from '../config/taskHints.ts';
import { SCENE_CONSTRAINTS, shuffleWords, buildHintsSystemInstruction } from '../config/aiAssistant.ts';
import type { AIHintMode, AIHintPayload, ChatTurn, CachedReplies, HintTaskContext } from '../config/aiAssistant.ts';
import { passThroughGate } from '../config/transcriptGate.ts';
import type { TranscriptGate } from '../config/transcriptGate.ts';
import { generateHints, toFriendlyError, warmupGemini } from '../utils/geminiClient.ts';
import { useSpeechRecording } from '../hooks/useSpeechRecording.ts';
import { useRecording } from '../hooks/useRecording.ts';
import RecordingPanel from './RecordingPanel.tsx';
import { subscribeToRoomEvents, approveRequest, rejectRequest, removeParticipant } from '../api.ts';
import type { RoomEvent as ApiRoomEvent } from '../api.ts';
import SceneEditor from './SceneEditor.tsx';
import ConfirmationModal from './ConfirmationModal.tsx';

// ─── Module-level constants & types ─────────────────────────────────────────
type InteractionPhase = 'idle' | 'teacher' | 'generating' | 'student';

// AI 對話輪替保留的最大歷史筆數（user/model 各算一筆 → 40 = 最近 20 組問答）。
// history 用於維持場景連貫性（沿用先前虛構的價格/尺寸/顏色、推進劇情），
// 故上限需足以涵蓋一個完整場景對話；history 為短句文字、記憶體成本極小，
// 此上限主要作用是避免病態長對話讓每次送往 Gemini 的 token 線性暴增。
const MAX_CHAT_TURNS = 40;

// 將學生指派的 VRM 角色 id 對應為 AI 提示用的英文人設描述。
// 店員類角色 → shop assistant;其餘(學生/顧客/預設) → customer。
function vrmRoleToPersona(roleId: string | undefined): string | undefined {
  if (!roleId) return undefined;
  return /staff/i.test(roleId) ? 'a shop assistant' : 'a customer';
}

// ─── Types ──────────────────────────────────────────────────────────────────
interface HostSessionProps {
  roomId: string;
  livekitToken: string;
  hostToken: string;
}

interface ParticipantInfo {
  participant: RemoteParticipant;
  videoTrack: RemoteTrackPublication | null;
  poseData: PoseFrame | null;
}

interface PendingStudent {
  requestId: string;
  name: string;
}

// ─── Custom Select Component ──────────────────────────────────────────────────
interface Option {
  value: string;
  label: React.ReactNode;
}

interface CustomSelectProps {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

function CustomSelect({ value, options, onChange, disabled, placeholder: _placeholder = "請選擇..." }: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selectRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (selectRef.current && !selectRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find(o => o.value === value);

  return (
    <div className={`custom-select-container ${disabled ? 'disabled' : ''}`} ref={selectRef}>
      <div
        className={`custom-select-trigger slot-select-ui ${disabled ? 'disabled' : ''}`}
        onClick={() => !disabled && setIsOpen(!isOpen)}
      >
        <div className="custom-select-value">
          {!disabled && selectedOption ? selectedOption.label : <span style={{ color: '#999' }}>{selectedOption?.label}</span>}
        </div>
        <span className="material-symbols-outlined custom-select-icon">
          {isOpen ? 'expand_less' : 'expand_more'}
        </span>
      </div>
      {isOpen && !disabled && (
        <div className="custom-select-dropdown">
          {options.map(opt => (
            <div
              key={opt.value}
              className={`custom-select-option ${opt.value === value ? 'selected' : ''}`}
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
            >
              {opt.label}
              {opt.value === value && <span className="material-symbols-outlined check-icon">check</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Scene background controls ───────────────────────────────────────────────
function SceneBackgroundControls({
  bgType,
  onBgTypeChange,
  deviceId,
  onDeviceChange,
  // bgIntensity,
  // onBgIntensityChange,
}: {
  bgType: BackgroundTypeOverride;
  onBgTypeChange: (v: BackgroundTypeOverride) => void;
  deviceId: string;
  onDeviceChange: (deviceId: string) => void;
  bgIntensity?: number;
  onBgIntensityChange?: (v: number) => void;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        let probeStream: MediaStream | null = null;
        try {
          const all = await navigator.mediaDevices.enumerateDevices();
          const hasLabels = all.some((d) => d.kind === 'videoinput' && d.label);
          if (!hasLabels) {
            probeStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          }
        } catch {/* ignore — fall through with empty labels */ }

        const list = (await navigator.mediaDevices.enumerateDevices()).filter(
          (d) => d.kind === 'videoinput',
        );
        if (probeStream) probeStream.getTracks().forEach((t) => t.stop());
        if (!cancelled) setDevices(list);
      } catch (err) {
        console.warn('[HostSession] enumerateDevices failed:', err);
      }
    };

    refresh();
    navigator.mediaDevices.addEventListener?.('devicechange', refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.('devicechange', refresh);
    };
  }, []);

  const deviceOptions: Option[] = useMemo(() => ([
    { value: '', label: '預設相機' },
    ...devices.map((d, i) => ({
      value: d.deviceId,
      label: d.label || `Camera ${i + 1}`,
    })),
  ]), [devices]);

  const typeOptions: { value: BackgroundTypeOverride; label: string }[] = [
    { value: 'default', label: '場景預設' },
    { value: 'camera', label: '相機' },
    { value: 'none', label: '無背景' },
  ];

  // const intensity = bgIntensity ?? 50;

  return (
    <div className="hs-bg-source-card">
      {/* Arrow pointer */}
      <div className="hs-bg-source-arrow" />
      <div className="hs-bg-source-inner">
        {/* Background source row */}
        <div className="hs-bg-source-row">
          <span className="hs-bg-source-row-label">背景來源</span>
        </div>
        <div className="hs-bg-type-segmented">
          {typeOptions.map(opt => (
            <button
              key={opt.value}
              type="button"
              className={`hs-bg-type-seg ${bgType === opt.value ? 'active' : ''}`}
              onClick={() => onBgTypeChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {bgType === 'camera' && (
          <>
            <div className="hs-bg-source-row" style={{ marginTop: 18 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 22, color: '#00A99D' }}>videocam</span>
              <span className="hs-bg-source-row-label">背景影像來源</span>
            </div>
            <CustomSelect value={deviceId} options={deviceOptions} onChange={onDeviceChange} />
            {/* <div className="hs-camera-bg-source-hint">
              可選實體鏡頭或虛擬相機（OBS Virtual Cam 等），與視訊鏡頭獨立
            </div> */}
          </>
        )}

        {/* Intensity slider */}
        {/* {onBgIntensityChange && (
          <>
            <div className="hs-intensity-row">
              <span className="hs-intensity-label">強度 <span className="hs-intensity-label-en">(Intensity)</span></span>
              <span className="hs-intensity-value">{intensity}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={intensity}
              className="hs-intensity-slider"
              style={{ '--val': `${intensity}%` } as React.CSSProperties}
              onChange={(e) => onBgIntensityChange(Number(e.target.value))}
            />
          </>
        )} */}
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function HostSession({ roomId, livekitToken, hostToken }: HostSessionProps) {
  const [participants, setParticipants] = useState<Map<string, ParticipantInfo>>(new Map());
  const [connectedRoom, setConnectedRoom] = useState<Room | null>(null);
  const roomRef = useRef<Room | null>(null);
  const [teacherPoseData, setTeacherPoseData] = useState<PoseFrame | null>(null);
  const [faceEnabled, setFaceEnabled] = useState(true);
  const [handEnabled, _] = useState(faceEnabled);
  const [lowPowerMode] = useState(true);
  const [hintEnabled, setHintEnabled] = useState<boolean>(() => {
    try { return JSON.parse(sessionStorage.getItem('bigscreen-hintEnabled') ?? 'false'); } catch { return false; }
  });
  const [hintLevel, setHintLevel] = useState<HintLevel | null>(() => {
    try { return JSON.parse(sessionStorage.getItem('bigscreen-hintLevel') ?? 'null'); } catch { return null; }
  });
  const prevCurrentTaskIdRef = useRef<string | undefined>(undefined);

  // ─── AI 助理 state ───────────────────────────────────────────────────────
  const [rightPanelTab, setRightPanelTab] = useState<'task-hints' | 'ai-assistant'>(
    () => {
      const v = sessionStorage.getItem('bigscreen-rightPanelTab');
      return v === 'task-hints' || v === 'ai-assistant' ? v : 'ai-assistant';
    },
  );
  useEffect(() => {
    try { sessionStorage.setItem('bigscreen-rightPanelTab', rightPanelTab); } catch { /* ignore */ }
  }, [rightPanelTab]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [latestHint, setLatestHint] = useState<AIHintPayload | null>(null);
  const [, setAiModel] = useState<string | null>(null);
  const transcriptGateRef = useRef<TranscriptGate>(passThroughGate);
  const chatHistoryRef = useRef<ChatTurn[]>([]);
  const resetChatHistory = useCallback(() => {
    chatHistoryRef.current = [];
  }, []);
  const cachedRepliesRef = useRef<CachedReplies | null>(null);
  const cachedSourceTextRef = useRef<string | null>(null);
  const resetCachedReplies = useCallback(() => {
    cachedRepliesRef.current = null;
    cachedSourceTextRef.current = null;
  }, []);
  const [countdown, setCountdown] = useState<number | null>(null);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [recordDuration, setRecordDuration] = useState(0);
  // ── 開始互動自動腳本（固定 15 秒）─────────────────────────────
  const [interactionPhase, setInteractionPhase] = useState<InteractionPhase>('idle');
  const interactionPhaseRef = useRef<InteractionPhase>('idle');
  useEffect(() => { interactionPhaseRef.current = interactionPhase; }, [interactionPhase]);
  // 廣播互動相位給 BigScreen（BroadcastChannel）與學生端（LiveKit publishData）
  useEffect(() => {
    const msg: BigScreenMsg = { type: 'interaction-phase', interactionPhase };
    channelRef.current?.postMessage(msg);
    const room = roomRef.current;
    if (room && room.state === 'connected') {
      try {
        const bytes = new TextEncoder().encode(
          JSON.stringify({ type: 'interaction-phase', phase: interactionPhase }),
        );
        room.localParticipant.publishData(bytes, { reliable: true });
      } catch { /* ignore */ }
    }
  }, [interactionPhase]);
  // 標記「此次 stop 由開始互動腳本觸發」→ transcript effect 立即送出（不倒數）
  const autoScriptTriggerRef = useRef(false);
  const {
    recording: sttRecording, interim: sttInterim, transcript: sttTranscript,
    supported: sttSupported, error: sttError,
    start: startRec, stop: stopRec, clear: clearTranscript,
    simulate: simulateTranscript,
  } = useSpeechRecording();
  const [simInput, setSimInput] = useState('');
  // Panel drawer open states
  const [showScenePanel, setShowScenePanel] = useState(false);
  const [showSlotPanel, setShowSlotPanel] = useState(false);
  const [sceneEditorGroupId, setSceneEditorGroupId] = useState<string | null>(null);
  const [showTaskPanel, setShowTaskPanel] = useState(false);
  const [showPendingPanel, setShowPendingPanel] = useState(false);
  const [pending, setPending] = useState<PendingStudent[]>([]);
  // Settlement modal (shown when allDone)
  const [showSettlement, setShowSettlement] = useState(false);
  // QR Code share modal (now opened in separate window)
  const openShareWindow = useCallback(() => {
    const url = `${window.location.origin}/?screen=share&roomId=${roomId}`;
    window.open(url, 'live-mr-share', 'width=500,height=650,menubar=no,toolbar=no');
  }, [roomId]);
  // Track whether a recording was ever started this session
  const [hasRecorded, setHasRecorded] = useState(false);
  // Set of participant identities currently speaking
  const [speakingSet, setSpeakingSet] = useState<Set<string>>(new Set());
  // 最近一位「正在說話的學生」(排除 host) — 供 AI 提示判斷學生身分/角色。
  // 用「最近」而非「當下」:老師觸發提示時學生通常剛說完、已不在 speakingSet。
  const lastSpeakingStudentRef = useRef<string | null>(null);
  // Embedded BigScreen preview in sidebar
  const [showBigScreenPreview, setShowBigScreenPreview] = useState(false);

  // Student removal confirmation modal state
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [studentToRemove, setStudentToRemove] = useState<string | null>(null);

  // 離開課堂確認 modal state
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  // Big-screen pop-out window reference
  const bigScreenWindowRef = useRef<Window | null>(null);
  // BroadcastChannel to push pose data to big screen
  const channelRef = useRef<BroadcastChannel | null>(null);

  const handleApiEvent = useCallback((event: ApiRoomEvent) => {
    if (event.type === 'join-request') {
      const student: PendingStudent = {
        requestId: event.requestId as string,
        name: event.name as string,
      };
      setPending((prev) => {
        if (prev.some((s) => s.requestId === student.requestId)) return prev;
        return [...prev, student];
      });
    } else if (event.type === 'request-approved' || event.type === 'request-rejected') {
      // Remove from pending when replayed on reconnect (avoids join/pending overlap)
      setPending((prev) => prev.filter((s) => s.requestId !== (event.requestId as string)));
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToRoomEvents(roomId, hostToken, handleApiEvent);
    return unsubscribe;
  }, [roomId, hostToken, handleApiEvent]);

  const handleApprove = async (requestId: string) => {
    try {
      await approveRequest(roomId, requestId);
      setPending((prev) => prev.filter((s) => s.requestId !== requestId));
    } catch {
      // ignore
    }
  };

  const handleReject = async (requestId: string) => {
    try {
      await rejectRequest(roomId, requestId);
      setPending((prev) => prev.filter((s) => s.requestId !== requestId));
    } catch {
      // ignore
    }
  };

  const handleRemoveStudent = useCallback((identity: string) => {
    setStudentToRemove(identity);
    setShowRemoveConfirm(true);
  }, []);

  const confirmRemoveStudent = useCallback(async () => {
    if (!studentToRemove) return;
    try {
      await removeParticipant(roomId, studentToRemove);
    } catch (err) {
      console.error('Failed to remove participant:', err);
      window.alert('移出失敗，請稍後再試');
    } finally {
      setShowRemoveConfirm(false);
      setStudentToRemove(null);
    }
  }, [roomId, studentToRemove]);

  const cancelRemoveStudent = useCallback(() => {
    setShowRemoveConfirm(false);
    setStudentToRemove(null);
  }, []);


  // Teacher's own video ref (for pose detection)
  const teacherVideoRef = useRef<HTMLVideoElement>(null);

  // Latest pose snapshot for all participants (used when opening big screen mid-session)
  const poseSnapshotRef = useRef<Record<string, unknown>>({});
  const teacherPoolRef = useRef<PoseDecodePool>(createPoseDecodePool());
  const studentPoolsRef = useRef<Map<string, PoseDecodePool>>(new Map());

  // 節流寫入 sessionStorage 快照：此快照僅供大屏「冷啟動 / 重新整理」時讀取一次，
  // 現場 pose 已透過 BroadcastChannel 即時推送。先前每一幀 pose（30fps × N 名學生）
  // 都 JSON.stringify 整份快照並同步寫入 sessionStorage，是造成主執行緒卡頓與
  // 大量 GC（記憶體耗盡）的主因。改為最多每秒寫入一次。
  const snapshotPersistRef = useRef<{ last: number; timer: ReturnType<typeof setTimeout> | null }>({ last: 0, timer: null });
  const persistPoseSnapshot = useCallback(() => {
    const state = snapshotPersistRef.current;
    const flush = () => {
      state.last = Date.now();
      state.timer = null;
      try {
        sessionStorage.setItem('bigscreen-snapshot', JSON.stringify(poseSnapshotRef.current));
      } catch { /* ignore */ }
    };
    const elapsed = Date.now() - state.last;
    if (elapsed >= 1000) {
      flush();
    } else if (!state.timer) {
      state.timer = setTimeout(flush, 1000 - elapsed);
    }
  }, []);
  useEffect(() => () => {
    if (snapshotPersistRef.current.timer) clearTimeout(snapshotPersistRef.current.timer);
  }, []);

  // ─── Scene / VRM source selection ─────────────────────────────────────────
  const [selectedSceneId, setSelectedSceneId] = useState<string>(
    () => sessionStorage.getItem('bigscreen-sceneId') ?? DEFAULT_SCENE_ID,
  );
  // Global default VRM for new avatars (students who haven't picked their own)
  const [selectedVrmSourceId, setSelectedVrmSourceId] = useState<string | null>(
    () => sessionStorage.getItem('bigscreen-vrmSourceId') ?? null,
  );
  // Teacher's own personal avatar selection
  const [teacherVrmSourceId, setTeacherVrmSourceId] = useState<string | null>(
    () => sessionStorage.getItem('bigscreen-teacherVrmSourceId') ?? null,
  );
  // Individual student roles selected by the host
  const [studentRoles, setStudentRoles] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(sessionStorage.getItem('bigscreen-studentRoles') || '{}');
    } catch {
      return {};
    }
  });

  // Device ID for the BigScreen camera-background source. Independent from the
  // host's pose-tracking webcam — supports OBS Virtual Cam / a second physical
  // camera as the projected scene background.
  const [cameraBgDeviceId, setCameraBgDeviceId] = useState<string>(() => {
    try { return localStorage.getItem('bigscreen-cameraBgDeviceId') ?? ''; } catch { return ''; }
  });
  // Override for the scene's default backgroundType.
  const [bgTypeOverride, setBgTypeOverride] = useState<BackgroundTypeOverride>(() => {
    try {
      const v = localStorage.getItem('bigscreen-bgTypeOverride');
      if (v === 'none' || v === 'camera') return v;
      return 'default';
    } catch { return 'default'; }
  });

  // Slot assignments: slotId → participant identity
  const [slotAssignments, setSlotAssignments] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(sessionStorage.getItem('bigscreen-slotAssignments') || '{}');
    } catch {
      return {};
    }
  });

  // Ordered list of selected tasks (教學任務層)
  const [selectedTasks, setSelectedTasks] = useState<TaskEntry[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem('bigscreen-tasks') || '[]');
    } catch { return []; }
  });

  // Keep track of which modules are expanded in the selector
  const [expandedModuleIds, setExpandedModuleIds] = useState<Set<string>>(new Set());

  const { isRecording, start, stop, muteState, toggleMute } = useRecording(
    roomId,
    connectedRoom,
    selectedSceneId,
    connectedRoom?.localParticipant.name || connectedRoom?.localParticipant.identity || 'Host',
    channelRef,
  );

  // Keep a ref so event-handler closures (handleDataReceived) can read latest muteState
  const muteStateRef = useRef<Record<string, { audio: boolean; video: boolean }>>({});
  useEffect(() => { muteStateRef.current = muteState; }, [muteState]);

  // Track if recording was ever started this session
  useEffect(() => {
    if (isRecording) setHasRecorded(true);
  }, [isRecording]);

  // Keep a stable ref to stop() so the channel handler always calls the latest closure
  const stopRef = useRef(stop);
  useEffect(() => { stopRef.current = stop; }, [stop]);

  // Stop recording after BigScreen has finished capturing the settlement overlay.
  // BigScreen broadcasts 'settlement-done' after its own recording stops (≈3 s after
  // the settlement panel appears). We listen for that signal here and stop the backend
  // recording only then, so the settlement overlay is included in the video.
  //
  // Fallback: if BigScreen is not open (or sends the signal before we set up the
  // listener), we fall back to stopping 5 s after all tasks are done, which gives
  // BigScreen enough time to show and record the settlement panel.
  useEffect(() => {
    if (selectedTasks.length === 0) return;
    const allDone = selectedTasks.every(t => t.completed);
    if (!allDone || !isRecording) return;

    let stopped = false;
    const doStop = () => {
      if (stopped) return;
      stopped = true;
      stopRef.current();
    };

    // Listen for BigScreen's settlement-done signal on the same BroadcastChannel
    const settlementChannel = new BroadcastChannel(BIGSCREEN_CHANNEL_NAME);
    settlementChannel.onmessage = (ev: MessageEvent<BigScreenMsg>) => {
      if (ev.data?.type === 'settlement-done') {
        doStop();
        settlementChannel.close();
        clearTimeout(fallbackTimer);
      }
    };

    // Fallback: stop after 5 s if BigScreen never responds
    // (e.g. BigScreen window is not open, or no canvas recording was started)
    const fallbackTimer = setTimeout(() => {
      doStop();
      settlementChannel.close();
    }, 5000);

    return () => {
      clearTimeout(fallbackTimer);
      settlementChannel.close();
    };
  }, [selectedTasks, isRecording]);

  // Broadcast scene/VRM changes to any open BigScreen window
  const broadcastSceneChange = useCallback((sceneId: string) => {
    sessionStorage.setItem('bigscreen-sceneId', sceneId);
    const msg: BigScreenMsg = { type: 'scene-change', sceneId };
    channelRef.current?.postMessage(msg);
  }, []);

  const broadcastTaskChange = useCallback((tasks: TaskEntry[]) => {
    sessionStorage.setItem('bigscreen-tasks', JSON.stringify(tasks));
    const msg: BigScreenMsg = { type: 'task-change', tasks };
    channelRef.current?.postMessage(msg);
  }, []);

  const handleCameraBgDeviceChange = useCallback((deviceId: string) => {
    setCameraBgDeviceId(deviceId);
    try {
      if (deviceId) localStorage.setItem('bigscreen-cameraBgDeviceId', deviceId);
      else localStorage.removeItem('bigscreen-cameraBgDeviceId');
    } catch {/* ignore quota */ }
    const msg: BigScreenMsg = { type: 'camera-bg-device', cameraBgDeviceId: deviceId };
    channelRef.current?.postMessage(msg);
  }, []);

  const handleBgTypeOverrideChange = useCallback((next: BackgroundTypeOverride) => {
    setBgTypeOverride(next);
    try {
      if (next === 'default') localStorage.removeItem('bigscreen-bgTypeOverride');
      else localStorage.setItem('bigscreen-bgTypeOverride', next);
    } catch {/* ignore quota */ }
    const msg: BigScreenMsg = { type: 'bg-type-override', bgTypeOverride: next };
    channelRef.current?.postMessage(msg);
  }, []);

  const broadcastHintChange = useCallback((enabled: boolean, level: HintLevel | null) => {
    sessionStorage.setItem('bigscreen-hintEnabled', JSON.stringify(enabled));
    sessionStorage.setItem('bigscreen-hintLevel', JSON.stringify(level));
    const msg: BigScreenMsg = { type: 'hint-change', hintEnabled: enabled, hintLevel: level };
    channelRef.current?.postMessage(msg);
  }, []);

  const setHint = useCallback((level: HintLevel | null) => {
    setHintLevel(level);
    broadcastHintChange(hintEnabled, level);
  }, [hintEnabled, broadcastHintChange]);

  const toggleHintEnabled = useCallback(() => {
    setHintEnabled(prev => {
      const next = !prev;
      broadcastHintChange(next, next ? hintLevel : null);
      if (!next) setHintLevel(null);
      return next;
    });
  }, [hintLevel, broadcastHintChange]);

  // ─── AI 助理 callbacks ───────────────────────────────────────────────────
  useEffect(() => {
    if (rightPanelTab === 'ai-assistant') void warmupGemini();
  }, [rightPanelTab]);

  const broadcastAIHint = useCallback((payload: AIHintPayload) => {
    const msg: BigScreenMsg = { type: 'ai-hint', aiHint: payload };
    channelRef.current?.postMessage(msg);
    const room = roomRef.current;
    if (room && room.state === 'connected') {
      try {
        const bytes = new TextEncoder().encode(JSON.stringify({ type: 'ai-hint', payload }));
        room.localParticipant.publishData(bytes, { reliable: true });
      } catch { /* ignore */ }
    }
  }, []);

  const cancelAutoCountdown = useCallback(() => {
    if (autoTimerRef.current) { clearTimeout(autoTimerRef.current); autoTimerRef.current = null; }
    if (tickTimerRef.current) { clearInterval(tickTimerRef.current); tickTimerRef.current = null; }
    setCountdown(null);
  }, []);

  const handleHint = useCallback(async (mode: AIHintMode) => {
    cancelAutoCountdown();
    if (aiBusy) return;

    // ── Cache-first path: if we already generated for this transcript, just switch mode and broadcast.
    if (cachedRepliesRef.current) {
      const cached = cachedRepliesRef.current;
      const content = mode === 'complete' ? cached.complete
        : mode === 'extend' ? cached.extend
          : cached.rearrange;
      if (content) {
        const payload: AIHintPayload = {
          mode,
          content,
          sourceText: cachedSourceTextRef.current || sttTranscript.trim(),
          ts: Date.now()
        };
        setLatestHint(payload);
        broadcastAIHint(payload);
        return;
      }
    }

    const txt = sttTranscript.trim();
    if (txt.length < 3) return;
    if (!transcriptGateRef.current.accept(txt, { sceneId: selectedSceneId, source: 'button' })) return;
    const constraint = SCENE_CONSTRAINTS[selectedSceneId];
    if (!constraint) { setAiError('此場景尚無 AI 助理約束文件'); return; }

    // ── Cold path: one AI call → cache {complete, rearrange, extend} → broadcast the requested mode.
    setAiBusy(true); setAiError(null);
    try {
      // 依「當前進行中的任務 + 下一個任務 + 說話學生身分」調整 AI 回答方向。
      // 優先任務 = 第一個未完成;接續任務 = 其後第一個未完成(供自然鋪陳銜接)。
      const incompleteTasks = selectedTasks.filter(t => !t.completed);
      const currentTask = incompleteTasks[0];
      const nextTask = incompleteTasks[1];
      const speakerId = lastSpeakingStudentRef.current;
      const taskContext: HintTaskContext = {
        studentRole: vrmRoleToPersona(speakerId ? studentRoles[speakerId] : undefined),
        currentTaskLabel: currentTask?.label,
        currentTargetSentence: currentTask ? TASK_HINTS[currentTask.id]?.completeSentence : undefined,
        nextTaskLabel: nextTask?.label,
        nextTargetSentence: nextTask ? TASK_HINTS[nextTask.id]?.completeSentence : undefined,
      };
      const systemInstruction = buildHintsSystemInstruction(constraint, taskContext);
      const history = chatHistoryRef.current;
      const result = await generateHints(txt, { history, systemInstruction });
      setAiModel(result.model);
      const cached: CachedReplies = {
        complete: result.complete,
        rearrange: shuffleWords(result.complete),
        extend: result.extend || result.complete,
      };
      cachedRepliesRef.current = cached;
      cachedSourceTextRef.current = txt;
      // Append ONCE per transcript: the canonical student utterance is `complete`.
      // 對話輪替會無上限累積；只保留最近 MAX_CHAT_TURNS 筆，避免長課堂中 history
      // 無限成長（記憶體耗盡），同時控制每次送往 Gemini 的 token 量。
      chatHistoryRef.current = [
        ...history,
        { role: 'user' as const, text: txt },
        { role: 'model' as const, text: result.complete },
      ].slice(-MAX_CHAT_TURNS);
      const content = mode === 'complete' ? cached.complete
        : mode === 'extend' ? cached.extend
          : cached.rearrange;
      const payload: AIHintPayload = { mode, content, sourceText: txt, ts: Date.now() };
      setLatestHint(payload);
      broadcastAIHint(payload);
    } catch (e) {
      setAiError(toFriendlyError(e));
      // 自動腳本路徑：transcript effect 在送 AI 後同步把 phase 設為 'student'。
      // 若 AI 失敗，回到 'teacher' 並重新錄音，避免學生卡停在「無提示」狀態。
      if (interactionPhaseRef.current === 'student') {
        setInteractionPhase('teacher');
        if (!sttRecordingRef.current) {
          try { startRec(); } catch { /* ignore */ }
        }
      }
    } finally {
      setAiBusy(false);
    }
  }, [aiBusy, sttTranscript, selectedSceneId, selectedTasks, studentRoles, cancelAutoCountdown, broadcastAIHint, startRec]);

  const handleHintRef = useRef(handleHint);
  useEffect(() => { handleHintRef.current = handleHint; }, [handleHint]);

  // ── 空白鍵錄音輔助 refs（供穩定事件監聽器讀取最新值）────────────────────
  // 標記「此次 stop 是由空白鍵觸發」，讓 transcript effect 跳過倒數直接送出
  const spacebarTriggerRef = useRef(false);
  // 鏡像 sttRecording / selectedSceneId 給 keydown/keyup handler 讀取（避免 stale closure）
  const sttRecordingRef = useRef(sttRecording);
  useEffect(() => { sttRecordingRef.current = sttRecording; }, [sttRecording]);
  const spacebarSceneIdRef = useRef(selectedSceneId);
  useEffect(() => { spacebarSceneIdRef.current = selectedSceneId; }, [selectedSceneId]);

  const handleClearAIHint = useCallback(() => {
    cancelAutoCountdown();
    resetCachedReplies();
    const payload: AIHintPayload = { mode: null, content: null, sourceText: null, ts: Date.now() };
    setLatestHint(null);
    broadcastAIHint(payload);
  }, [cancelAutoCountdown, resetCachedReplies, broadcastAIHint]);

  const handleToggleRecord = useCallback(() => {
    if (sttRecording) {
      stopRec();
    } else {
      cancelAutoCountdown();
      clearTranscript();
      setAiError(null);
      startRec();
    }
  }, [sttRecording, stopRec, startRec, cancelAutoCountdown, clearTranscript]);

  const endInteraction = useCallback(() => {
    autoScriptTriggerRef.current = false;
    // Use ref so this callback stays stable and doesn't change every time
    // sttRecording flips — prevents the unmount-cleanup effect from firing
    // endInteraction (and resetting phase to 'idle') on every recording toggle.
    if (sttRecordingRef.current) {
      try { stopRec(); } catch { /* ignore */ }
    }
    setInteractionPhase('idle');
  }, [stopRec]);

  const startInteraction = useCallback(() => {
    if (!sttSupported || !SCENE_CONSTRAINTS[selectedSceneId]) return;
    if (aiBusy || interactionPhaseRef.current !== 'idle') return;

    cancelAutoCountdown();
    resetChatHistory();
    resetCachedReplies();
    clearTranscript();
    setAiError(null);
    setInteractionPhase('teacher');
    if (!sttRecording) {
      startRec();
    }
  }, [sttSupported, selectedSceneId, sttRecording, aiBusy, cancelAutoCountdown, resetChatHistory, resetCachedReplies, clearTranscript, startRec]);

  const handleTeacherDone = useCallback(() => {
    if (interactionPhaseRef.current !== 'teacher') return;
    if (aiBusy) {
      setAiError('上一輪 AI 仍在生成中，請稍候');
      return;
    }
    autoScriptTriggerRef.current = true;
    // TODO Test
    // console.log(sttTranscript);
    // if (!sttTranscript) {
    //   const defaultText = 'How are you?';
    //   setSimInput(defaultText);
    //   simulateTranscript(defaultText);
    // }

    setInteractionPhase('generating');
    if (sttRecording) {
      try { stopRec(); } catch { /* ignore */ }
    }
  }, [aiBusy, sttRecording, stopRec, sttTranscript, simulateTranscript]);

  const handleTeacherTakeover = useCallback(() => {
    if (interactionPhaseRef.current !== 'student') return;
    cancelAutoCountdown();
    clearTranscript();
    setAiError(null);
    setInteractionPhase('teacher');
    // Phase guard above ensures we came from 'student' where STT was already stopped at handleTeacherDone;
    // !sttRecording should be true here. Guard is defensive.
    if (!sttRecording) {
      try { startRec(); } catch { /* ignore */ }
    }
  }, [cancelAutoCountdown, clearTranscript, sttRecording, startRec]);

  // ── 空白鍵：按住開始收音，放開即送 AI 並推播提示 ─────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      // 不攔截輸入框內的空白鍵
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) return;
      // 場景尚無 AI 約束 或 不支援 STT 時不動作
      if (!sttSupported || !SCENE_CONSTRAINTS[spacebarSceneIdRef.current]) return;
      // 已在錄音中（可能是按鈕觸發），不重複啟動
      if (sttRecordingRef.current) return;
      if (interactionPhaseRef.current !== 'idle') return; // 自動腳本進行中，空白鍵不介入
      e.preventDefault();
      cancelAutoCountdown();
      clearTranscript();
      setAiError(null);
      startRec();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) return;
      if (!sttRecordingRef.current) return;
      if (interactionPhaseRef.current !== 'idle') return; // 自動腳本控制此次錄音
      e.preventDefault();
      // 標記「由空白鍵觸發停止」，transcript effect 偵測到後直接送出（不倒數）
      spacebarTriggerRef.current = true;
      stopRec();
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
    };
    // cancelAutoCountdown / clearTranscript / startRec / stopRec 均為穩定 useCallback，不需列入依賴
  }, [sttSupported, cancelAutoCountdown, clearTranscript, startRec, stopRec]);

  // transcript 更新時：空白鍵模式 → 立即送出；按鈕模式 → 3 秒倒數後送出
  useEffect(() => {
    // 新 transcript 進來 → 失效舊 cache（即使 transcript 太短也要清，避免殘留）
    if (cachedSourceTextRef.current !== null && cachedSourceTextRef.current !== sttTranscript.trim()) {
      cachedRepliesRef.current = null;
      cachedSourceTextRef.current = null;
    }
    // 無論何種情況都先消耗 flag，避免殘留到下一次 transcript
    const isSpacebarTrigger = spacebarTriggerRef.current;
    spacebarTriggerRef.current = false;
    const isAutoScript = autoScriptTriggerRef.current;
    autoScriptTriggerRef.current = false;

    if (!sttTranscript || sttTranscript.length < 3) {
      if (isAutoScript) { setAiError('未偵測到語音，請再試一次'); setInteractionPhase('idle'); }
      return;
    }
    if (!SCENE_CONSTRAINTS[selectedSceneId]) return;

    if (isSpacebarTrigger || isAutoScript) {
      // 空白鍵放開 / 開始互動腳本：跳過倒數，直接呼叫 AI 並推播提示
      handleHintRef.current('rearrange');
      if (isAutoScript) setInteractionPhase('student');
      return;
    }

    if (interactionPhaseRef.current !== 'idle') {
      // 互動進行中，必須等 handleTeacherDone 觸發 isAutoScript 才會送出，
      // 平時 transcript 更新不啟動 3 秒倒數。
      return;
    }

    // 按鈕模式：3 秒自動倒數
    setCountdown(3);
    tickTimerRef.current = setInterval(() => {
      setCountdown((c) => (c !== null && c > 1 ? c - 1 : c));
    }, 1000);
    autoTimerRef.current = setTimeout(() => {
      if (tickTimerRef.current) { clearInterval(tickTimerRef.current); tickTimerRef.current = null; }
      autoTimerRef.current = null;
      setCountdown(null);
      handleHintRef.current('rearrange');
    }, 3000);
    return () => {
      if (autoTimerRef.current) { clearTimeout(autoTimerRef.current); autoTimerRef.current = null; }
      if (tickTimerRef.current) { clearInterval(tickTimerRef.current); tickTimerRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sttTranscript]);

  // unmount 清理倒數
  useEffect(() => () => cancelAutoCountdown(), [cancelAutoCountdown]);
  useEffect(() => () => endInteraction(), [endInteraction]);


  // ─── 錄音時長計時 ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!sttRecording) {
      setRecordDuration(0);
      return;
    }
    setRecordDuration(0);
    const startTs = Date.now();
    const id = setInterval(() => {
      setRecordDuration(Math.floor((Date.now() - startTs) / 1000));
    }, 250);
    return () => clearInterval(id);
  }, [sttRecording]);

  // 當任務提示關閉時，自動切到 AI 助理 tab
  useEffect(() => {
    if (!hintEnabled && rightPanelTab === 'task-hints') {
      setRightPanelTab('ai-assistant');
    }
  }, [hintEnabled, rightPanelTab]);

  // 當「第一個未完成任務」改變（含全完成 → undefined）時，把提示重設為「不顯示」
  useEffect(() => {
    const currentId = selectedTasks.find(t => !t.completed)?.id;
    if (prevCurrentTaskIdRef.current === undefined && currentId !== undefined) {
      // 初次掛載 / 初次有任務：只記錄，不動 hintLevel（保留 sessionStorage 還原值）
      prevCurrentTaskIdRef.current = currentId;
      return;
    }
    if (currentId !== prevCurrentTaskIdRef.current) {
      prevCurrentTaskIdRef.current = currentId;
      if (hintLevel !== null) setHint(null);
    }
  }, [selectedTasks, hintLevel, setHint]);

  const broadcastVrmChange = useCallback((vrmSourceId: string | null) => {
    if (vrmSourceId) {
      sessionStorage.setItem('bigscreen-vrmSourceId', vrmSourceId);
    } else {
      sessionStorage.removeItem('bigscreen-vrmSourceId');
    }
    const msg: BigScreenMsg = { type: 'vrm-change', vrmSourceId: vrmSourceId ?? undefined };
    channelRef.current?.postMessage(msg);
  }, []);

  /** Swap the teacher's own BigScreen avatar */
  const broadcastTeacherVrmChange = useCallback(
    (vrmSourceId: string | null) => {
      if (!connectedRoom) return;
      if (vrmSourceId) {
        sessionStorage.setItem('bigscreen-teacherVrmSourceId', vrmSourceId);
      } else {
        sessionStorage.removeItem('bigscreen-teacherVrmSourceId');
      }
      const identity = connectedRoom.localParticipant.identity;
      const vrmUrl = vrmSourceId ? (VRM_SOURCES[vrmSourceId] ?? VRM_SOURCES[DEFAULT_VRM_SOURCE_ID]).url : undefined;
      const msg: BigScreenMsg = { type: 'vrm-identity-change', identity, vrmUrl };
      channelRef.current?.postMessage(msg);
    },
    [connectedRoom],
  );

  const handleSceneChange = useCallback(
    (sceneId: string) => {
      setSelectedSceneId(sceneId);
      // Clear slot assignments — they are scene-specific
      setSlotAssignments({});
      try { sessionStorage.removeItem('bigscreen-slotAssignments'); } catch {/* ignore */ }
      // Clear task goal — it is scene-specific
      setSelectedTasks([]);
      sessionStorage.removeItem('bigscreen-tasks');
      setExpandedModuleIds(new Set());
      setHasRecorded(false);
      const taskClearMsg: BigScreenMsg = { type: 'task-change', tasks: [] };
      channelRef.current?.postMessage(taskClearMsg);
      // AI 助理：場景切換 → 取消倒數、停止錄音、清空 transcript / 最新提示，並廣播清除
      cancelAutoCountdown();
      endInteraction();
      clearTranscript();
      setLatestHint(null);
      resetChatHistory();
      resetCachedReplies();
      setAiError(null);
      broadcastAIHint({ mode: null, content: null, sourceText: null, ts: Date.now() });
      broadcastSceneChange(sceneId);

      // Validate and fallback roles if the new scene restricts them
      const preset = SCENE_PRESETS[sceneId] || SCENE_PRESETS[DEFAULT_SCENE_ID];
      const allowed = preset.allowedVrmIds;
      if (allowed && allowed.length > 0) {
        setTeacherVrmSourceId((prev) => {
          if (prev !== null && !allowed.includes(prev)) {
            const fallback = allowed[0];
            setTimeout(() => broadcastTeacherVrmChange(fallback), 0);
            return fallback;
          }
          return prev;
        });

        setSelectedVrmSourceId((prev) => {
          if (prev !== null && !allowed.includes(prev)) {
            const fallback = allowed[0];
            setTimeout(() => broadcastVrmChange(fallback), 0);
            return fallback;
          }
          return prev;
        });

        setStudentRoles((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const [id, role] of Object.entries(next)) {
            if (!allowed.includes(role)) {
              next[id] = allowed[0];
              changed = true;
              const vrmUrl = (VRM_SOURCES[allowed[0]] || VRM_SOURCES[DEFAULT_VRM_SOURCE_ID]).url;
              const msg: BigScreenMsg = { type: 'vrm-identity-change', identity: id, vrmUrl };
              setTimeout(() => channelRef.current?.postMessage(msg), 0);
            }
          }
          if (changed) {
            sessionStorage.setItem('bigscreen-studentRoles', JSON.stringify(next));
            return next;
          }
          return prev;
        });
      }
    },
    [broadcastSceneChange, broadcastTeacherVrmChange, broadcastVrmChange, cancelAutoCountdown, endInteraction, clearTranscript, resetChatHistory, resetCachedReplies, broadcastAIHint],
  );

  // const handleVrmChange = useCallback(
  //   (vrmSourceId: string) => {
  //     setSelectedVrmSourceId(vrmSourceId);
  //     broadcastVrmChange(vrmSourceId);
  //   },
  //   [broadcastVrmChange],
  // );

  const handleTeacherVrmChange = useCallback(
    (vrmSourceId: string | null) => {
      console.log("handleTeacherVrmChange", vrmSourceId);

      setTeacherVrmSourceId(vrmSourceId);
      broadcastTeacherVrmChange(vrmSourceId);
    },
    [broadcastTeacherVrmChange],
  );

  const handleStudentRoleChange = useCallback(
    (identity: string, vrmSourceId: string) => {
      setStudentRoles((prev) => {
        const next = { ...prev, [identity]: vrmSourceId };
        sessionStorage.setItem('bigscreen-studentRoles', JSON.stringify(next));
        return next;
      });
      const vrmUrl = (VRM_SOURCES[vrmSourceId] || VRM_SOURCES[DEFAULT_VRM_SOURCE_ID]).url;
      const msg: BigScreenMsg = { type: 'vrm-identity-change', identity, vrmUrl };
      channelRef.current?.postMessage(msg);
    },
    [],
  );

  const handleSlotAssign = useCallback(
    (slotId: string, identity: string | null) => {
      const previousIdentity = slotAssignments[slotId];
      const preset = SCENE_PRESETS[selectedSceneId] || SCENE_PRESETS[DEFAULT_SCENE_ID];
      const sceneSlot = preset.slots?.find(s => s.id === slotId);

      setSlotAssignments(prev => {
        const next = { ...prev };
        if (identity === null) {
          delete next[slotId];
        } else {
          // If this identity is already in another slot, vacate that slot
          for (const [sid, id] of Object.entries(next)) {
            if (id === identity && sid !== slotId) {
              delete next[sid];
            }
          }
          next[slotId] = identity;
        }
        try { sessionStorage.setItem('bigscreen-slotAssignments', JSON.stringify(next)); } catch {/* ignore */ }
        return next;
      });

      // If explicit removal of assignment, also clear the specific model selection
      if (identity === null && previousIdentity) {
        const isTeacher = connectedRoom?.localParticipant.identity === previousIdentity;
        if (isTeacher) {
          handleTeacherVrmChange(null);
        } else {
          setStudentRoles(prev => {
            const next = { ...prev };
            delete next[previousIdentity];
            try { sessionStorage.setItem('bigscreen-studentRoles', JSON.stringify(next)); } catch {/* ignore */ }
            return next;
          });
          // Notify BigScreen to remove this identity's specific VRM (falls back to null)
          channelRef.current?.postMessage({
            type: 'vrm-identity-change',
            identity: previousIdentity,
            vrmUrl: undefined,
          });
        }
      }

      // Apply VRM priority: manual override > slot default > scene global
      if (identity && sceneSlot?.defaultVrmId) {
        const isTeacher = connectedRoom?.localParticipant.identity === identity;
        if (isTeacher) {
          // Host assigned: Immediately apply slot default
          handleTeacherVrmChange(sceneSlot.defaultVrmId);
        } else {
          const hasManualOverride = studentRoles[identity];
          if (!hasManualOverride) {
            const vrmUrl = (VRM_SOURCES[sceneSlot.defaultVrmId] || VRM_SOURCES[DEFAULT_VRM_SOURCE_ID]).url;
            const vrmMsg: BigScreenMsg = { type: 'vrm-identity-change', identity, vrmUrl };
            channelRef.current?.postMessage(vrmMsg);
            // Persist so BigScreen restore sees it
            setStudentRoles(prev => {
              const next = { ...prev, [identity]: sceneSlot.defaultVrmId! };
              try { sessionStorage.setItem('bigscreen-studentRoles', JSON.stringify(next)); } catch {/* ignore */ }
              return next;
            });
          }
        }
      }

      const msg: BigScreenMsg = { type: 'slot-assign', slotId, identity: identity ?? undefined };
      channelRef.current?.postMessage(msg);
    },
    [selectedSceneId, studentRoles, connectedRoom, handleTeacherVrmChange, slotAssignments],
  );

  const toggleTaskSelection = useCallback(
    (taskId: string, label: string) => {
      setSelectedTasks((prev) => {
        const index = prev.findIndex((t) => t.id === taskId);
        let next: TaskEntry[];
        if (index >= 0) {
          // Remove
          next = prev.filter((t) => t.id !== taskId);
        } else {
          // Add if under limit
          if (prev.length >= 7) return prev;
          next = [...prev, { id: taskId, label, completed: false }];
        }
        broadcastTaskChange(next);
        return next;
      });
    },
    [broadcastTaskChange],
  );

  const toggleTaskCompletion = useCallback(
    (taskId: string) => {
      setSelectedTasks((prev) => {
        const next = prev.map((t) =>
          t.id === taskId ? { ...t, completed: !t.completed } : t
        );
        broadcastTaskChange(next);
        return next;
      });
    },
    [broadcastTaskChange],
  );

  const resetAllTasks = useCallback(() => {
    setSelectedTasks((prev) => {
      const next = prev.map((t) => ({ ...t, completed: false }));
      broadcastTaskChange(next);
      return next;
    });
  }, [broadcastTaskChange]);

  // ─── Drag-to-reorder for 已選任務 ────────────────────────────────────────
  const dragIndexRef = useRef<number | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ index: number; position: 'before' | 'after' } | null>(null);

  const handleTaskDragStart = useCallback((idx: number) => {
    dragIndexRef.current = idx;
  }, []);

  const handleTaskDragOver = useCallback((e: React.DragEvent<HTMLDivElement>, idx: number) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const position: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    setDropIndicator((prev) =>
      prev?.index === idx && prev.position === position ? prev : { index: idx, position },
    );
  }, []);

  const handleTaskDrop = useCallback((e: React.DragEvent<HTMLDivElement>, idx: number) => {
    const from = dragIndexRef.current;
    dragIndexRef.current = null;
    if (from === null || from === idx) { setDropIndicator(null); return; }

    const rect = e.currentTarget.getBoundingClientRect();
    const pos: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';

    setDropIndicator(null);
    setSelectedTasks((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      const targetItem = prev[idx];
      let insertAt = next.findIndex((t) => t.id === targetItem.id);
      if (insertAt === -1) insertAt = pos === 'after' ? next.length : 0;
      else if (pos === 'after') insertAt += 1;
      next.splice(insertAt, 0, moved);
      broadcastTaskChange(next);
      return next;
    });
  }, [broadcastTaskChange]);

  const handleTaskDragEnd = useCallback(() => {
    dragIndexRef.current = null;
    setDropIndicator(null);
  }, []);

  const toggleModuleExpansion = useCallback((moduleId: string) => {
    setExpandedModuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  }, []);

  // ─── BroadcastChannel setup ───────────────────────────────────────────────
  useEffect(() => {
    const ch = new BroadcastChannel(BIGSCREEN_CHANNEL_NAME);
    channelRef.current = ch;
    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, []);

  // 廣播「正在說話」清單給大屏（單一來源 = LiveKit ActiveSpeakers）
  useEffect(() => {
    const msg: BigScreenMsg = {
      type: 'speaking',
      speakingIdentities: Array.from(speakingSet),
    };
    channelRef.current?.postMessage(msg);
    // 記下最近一位開口的學生(排除 host),供 AI 提示沿用其角色身分
    for (const id of speakingSet) {
      if (!id.startsWith('host-')) { lastSpeakingStudentRef.current = id; break; }
    }
  }, [speakingSet]);

  // ─── Teacher pose detection ───────────────────────────────────────────────
  const teacherPublishPose = useCallback(
    (data: Uint8Array) => {
      try {
        const parsed = teacherPoolRef.current.decode(data);
        // Always update local overlay regardless of connection state
        setTeacherPoseData(parsed);
        if (!connectedRoom) return;
        const identity = connectedRoom.localParticipant.identity;
        poseSnapshotRef.current[identity] = parsed;
        // Throttled snapshot persistence (live pose flows via BroadcastChannel below)
        persistPoseSnapshot();
        const msg: BigScreenMsg = { type: 'pose', identity, poseData: parsed };
        channelRef.current?.postMessage(msg);
      } catch { /* ignore */ }
    },
    [connectedRoom, persistPoseSnapshot],
  );

  usePoseDetection(teacherVideoRef, teacherPublishPose, undefined, faceEnabled, handEnabled, lowPowerMode);

  // ─── LiveKit connection ────────────────────────────────────────────────────
  const updateParticipant = useCallback(
    (identity: string, updater: (prev: ParticipantInfo) => ParticipantInfo) => {
      setParticipants((prev) => {
        const next = new Map(prev);
        const existing = next.get(identity);
        if (existing) {
          next.set(identity, updater(existing));
        }
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    const room = new Room();
    roomRef.current = room;

    const handleConnected = (participant: RemoteParticipant) => {
      setParticipants((prev) => {
        const next = new Map(prev);
        next.set(participant.identity, {
          participant,
          videoTrack: null,
          poseData: null,
        });
        return next;
      });

      // Forward any previously set individual role to BigScreen
      if (!participant.identity.startsWith('host-')) {
        setStudentRoles(prev => {
          const role = prev[participant.identity];
          if (role) {
            const vrmUrl = (VRM_SOURCES[role] || VRM_SOURCES[DEFAULT_VRM_SOURCE_ID]).url;
            setTimeout(() => {
              const msg: BigScreenMsg = {
                type: 'vrm-identity-change',
                identity: participant.identity,
                vrmUrl,
              };
              channelRef.current?.postMessage(msg);
            }, 100);
          }
          return prev;
        });
      }

      // 新學生加入 / 重連 → 立刻把目前 phase 補送一次（單一接收端，不全廣播）
      const phaseNow = interactionPhaseRef.current;
      try {
        const bytes = new TextEncoder().encode(
          JSON.stringify({ type: 'interaction-phase', phase: phaseNow }),
        );
        // publishData 可指定 destinationIdentities 限定接收者；缺省則 broadcast。
        // 這裡用單一目標以避免干擾既存學生（他們已有正確 phase）。
        void roomRef.current?.localParticipant
          .publishData(bytes, { reliable: true, destinationIdentities: [participant.identity] })
          .catch(() => { /* ignore */ });
      } catch { /* ignore */ }
    };

    const handleDisconnected = (participant: RemoteParticipant) => {
      setParticipants((prev) => {
        const next = new Map(prev);
        next.delete(participant.identity);
        return next;
      });
      channelRef.current?.postMessage({ type: 'leave', identity: participant.identity });
      delete poseSnapshotRef.current[participant.identity];
      studentPoolsRef.current.delete(participant.identity);
      if (lastSpeakingStudentRef.current === participant.identity) lastSpeakingStudentRef.current = null;
      // Prune stale identity from studentRoles so BigScreen re-open won't reload ghost avatars
      setStudentRoles((prev) => {
        if (!(participant.identity in prev)) return prev;
        const next = { ...prev };
        delete next[participant.identity];
        try {
          sessionStorage.setItem('bigscreen-studentRoles', JSON.stringify(next));
        } catch {/* ignore */ }
        return next;
      });
      // Remove disconnected participant from slot assignments
      setSlotAssignments((prev) => {
        const entry = Object.entries(prev).find(([, id]) => id === participant.identity);
        if (!entry) return prev;
        const [slotId] = entry;
        const next = { ...prev };
        delete next[slotId];
        try { sessionStorage.setItem('bigscreen-slotAssignments', JSON.stringify(next)); } catch {/* ignore */ }
        channelRef.current?.postMessage({ type: 'slot-assign', slotId, identity: undefined });
        return next;
      });
      // Update sessionStorage to keep snapshot in sync
      try {
        sessionStorage.setItem('bigscreen-snapshot', JSON.stringify(poseSnapshotRef.current));
      } catch {/* ignore */ }
    };

    const handleTrackSubscribed = (
      _track: Track,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      if (publication.kind === Track.Kind.Video) {
        updateParticipant(participant.identity, (info) => ({
          ...info,
          videoTrack: publication,
        }));
      }
    };

    const handleDataReceived = (
      payload: Uint8Array,
      participant?: RemoteParticipant,
      // _kind?: DataPacket_Kind,
    ) => {
      if (!participant) return;
      // Fast path: pose payloads are binary; control messages are JSON objects starting with '{'. Skip the
      // decode+parse on the hot pose path to avoid ~150 thrown exceptions/sec at 30fps × N students.
      if (payload.length > 0 && payload[0] === 0x7B) {
        try {
          const text = new TextDecoder().decode(payload);
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
            if (parsed.type === 'student-done') {
              if (interactionPhaseRef.current === 'student') {
                cancelAutoCountdown();
                clearTranscript();
                setAiError(null);
                setInteractionPhase('teacher');
                if (!sttRecordingRef.current) {
                  try { startRec(); } catch { /* ignore */ }
                }
              }
              return;
            }
            // 其他可能的控制訊息可在此擴充
          }
        } catch { /* fall through to pose decode */ }
      }
      try {
        let pool = studentPoolsRef.current.get(participant.identity);
        if (!pool) {
          pool = createPoseDecodePool();
          studentPoolsRef.current.set(participant.identity, pool);
        }
        const data = pool.decode(payload);

        // If the student's camera is off, skip pose forwarding to preview/BigScreen
        const isCameraOff = muteStateRef.current[participant.identity]?.video === true;
        if (isCameraOff) return;

        updateParticipant(participant.identity, (info) => ({
          ...info,
          poseData: data,
        }));

        poseSnapshotRef.current[participant.identity] = data;
        // Throttled snapshot persistence (live pose flows via BroadcastChannel below)
        persistPoseSnapshot();
        const msg: BigScreenMsg = { type: 'pose', identity: participant.identity, poseData: data };
        channelRef.current?.postMessage(msg);
      } catch {
        // ignore malformed data
      }
    };

    /** For LiveKit metadata updates from students, ignore vrmUrl since we override it locally */
    const handleParticipantMetadataChanged = () => {
      // Nothing to do for VRM sources anymore. Control is fully on Host.
    };

    let isMounted = true;
    // ── Audio speaking detection ──────────────────────────────────────
    const handleActiveSpeakers = (speakers: Participant[]) => {
      setSpeakingSet(new Set(speakers.map((p) => p.identity)));
    };

    room.on(RoomEvent.ParticipantConnected, handleConnected);
    room.on(RoomEvent.ParticipantDisconnected, handleDisconnected);
    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed as never);
    room.on(RoomEvent.DataReceived, handleDataReceived as never);
    room.on(RoomEvent.ParticipantMetadataChanged, handleParticipantMetadataChanged as never);
    room.on(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakers as never);

    const connectPromise = room.connect(LIVEKIT_URL, livekitToken);

    connectPromise
      .then(async () => {
        if (!isMounted) return;
        setConnectedRoom(room);

        try {
          await room.localParticipant.setCameraEnabled(true);
          await room.localParticipant.setMicrophoneEnabled(true);
        } catch (err) {
          if (isMounted) console.error('Failed to enable camera/microphone:', err);
        }

        // Attach teacher camera to hidden video for pose detection
        const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        if (camPub?.track && teacherVideoRef.current) {
          teacherVideoRef.current.srcObject = new MediaStream([camPub.track.mediaStreamTrack]);
          teacherVideoRef.current.play().catch(() => {/* autoplay */ });
        }

        // Populate pre-existing remote participants
        for (const [, p] of room.remoteParticipants) {
          handleConnected(p);
          for (const [, pub] of p.trackPublications) {
            if (pub.kind === Track.Kind.Video && pub.track) {
              handleTrackSubscribed(pub.track, pub as RemoteTrackPublication, p);
            }
          }
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error('Failed to connect to room:', err);
        // Likely an expired token persisted from a previous session — wipe
        // sessionStorage so the next reload returns to role selection.
        try { sessionStorage.removeItem('live-mr-app-state'); } catch { /* ignore */ }
      });

    return () => {
      isMounted = false;
      room.off(RoomEvent.ParticipantConnected, handleConnected);
      room.off(RoomEvent.ParticipantDisconnected, handleDisconnected);
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed as never);
      room.off(RoomEvent.DataReceived, handleDataReceived as never);
      room.off(RoomEvent.ParticipantMetadataChanged, handleParticipantMetadataChanged as never);
      room.off(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakers as never);
      setConnectedRoom(null);
      setSpeakingSet(new Set());
      connectPromise.catch(() => { }).finally(() => {
        room.disconnect();
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livekitToken, updateParticipant]);

  // Sync faceEnabled to LiveKit metadata for students to pick up
  useEffect(() => {
    if (connectedRoom) {
      const metadata = JSON.stringify({ faceEnabled });
      connectedRoom.localParticipant.setMetadata(metadata).catch((err) => {
        console.warn('Failed to update metadata:', err);
      });
    }
  }, [connectedRoom, faceEnabled]);

  // ─── Big-screen controls ───────────────────────────────────────────────────
  const openBigScreen = useCallback(() => {
    try {
      sessionStorage.setItem('bigscreen-roomId', roomId);
      sessionStorage.setItem('bigscreen-snapshot', JSON.stringify(poseSnapshotRef.current));
      sessionStorage.setItem('bigscreen-sceneId', selectedSceneId);
      if (selectedVrmSourceId) sessionStorage.setItem('bigscreen-vrmSourceId', selectedVrmSourceId);
      else sessionStorage.removeItem('bigscreen-vrmSourceId');
      if (teacherVrmSourceId) sessionStorage.setItem('bigscreen-teacherVrmSourceId', teacherVrmSourceId);
      else sessionStorage.removeItem('bigscreen-teacherVrmSourceId');
      sessionStorage.setItem('bigscreen-slotAssignments', JSON.stringify(slotAssignments));
      sessionStorage.setItem('bigscreen-tasks', JSON.stringify(selectedTasks));
      sessionStorage.setItem('bigscreen-hintEnabled', JSON.stringify(hintEnabled));
      sessionStorage.setItem('bigscreen-hintLevel', JSON.stringify(hintLevel));
    } catch {/* ignore */ }

    const url = `${window.location.origin}/?screen=bigscreen`;
    const win = window.open(url, 'live-mr-bigscreen', 'width=1280,height=720,menubar=no,toolbar=no');
    bigScreenWindowRef.current = win;
  }, [selectedSceneId, selectedVrmSourceId, teacherVrmSourceId, slotAssignments, selectedTasks, roomId, hintEnabled, hintLevel]);

  // ─── Embedded BigScreen preview ────────────────────────────────────────────
  // iframe 有獨立的 sessionStorage，透過 BroadcastChannel 補送完整狀態來同步
  const syncBigScreenState = useCallback(() => {
    const ch = channelRef.current;
    if (!ch) return;
    ch.postMessage({ type: 'scene-change', sceneId: selectedSceneId } satisfies BigScreenMsg);
    ch.postMessage({ type: 'task-change', tasks: selectedTasks } satisfies BigScreenMsg);
    ch.postMessage({ type: 'hint-change', hintEnabled, hintLevel } satisfies BigScreenMsg);
    for (const [slotId, identity] of Object.entries(slotAssignments)) {
      ch.postMessage({ type: 'slot-assign', slotId, identity } satisfies BigScreenMsg);
    }
    if (connectedRoom && teacherVrmSourceId) {
      const identity = connectedRoom.localParticipant.identity;
      const vrmUrl = (VRM_SOURCES[teacherVrmSourceId] || VRM_SOURCES[DEFAULT_VRM_SOURCE_ID]).url;
      ch.postMessage({ type: 'vrm-identity-change', identity, vrmUrl } satisfies BigScreenMsg);
    }
    for (const [identity, vrmSourceId] of Object.entries(studentRoles)) {
      const vrmUrl = (VRM_SOURCES[vrmSourceId] || VRM_SOURCES[DEFAULT_VRM_SOURCE_ID]).url;
      ch.postMessage({ type: 'vrm-identity-change', identity, vrmUrl } satisfies BigScreenMsg);
    }
    ch.postMessage({ type: 'camera-bg-device', cameraBgDeviceId } satisfies BigScreenMsg);
    ch.postMessage({ type: 'bg-type-override', bgTypeOverride } satisfies BigScreenMsg);
  }, [selectedSceneId, selectedTasks, slotAssignments, connectedRoom, teacherVrmSourceId, studentRoles, hintEnabled, hintLevel, cameraBgDeviceId, bgTypeOverride]);

  const toggleBigScreenPreview = useCallback(() => {
    setShowBigScreenPreview(prev => {
      if (!prev) {
        // 延遲 1s 等 iframe 內的 BigScreen React app 掛載完成後再 sync
        setTimeout(syncBigScreenState, 1000);
      }
      return !prev;
    });
  }, [syncBigScreenState]);

  // ── BigScreen preview scaler ──────────────────────────────────────────────
  // BigScreen is designed for a full 16:9 viewport (1920×1080).
  // We render the iframe at that native size then scale it down to fit.
  const PREVIEW_DESIGN_W = 1920;
  const PREVIEW_DESIGN_H = 1080;
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const previewIframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const wrap = previewWrapRef.current;
    if (!wrap) return;
    const update = () => {
      const { width, height } = wrap.getBoundingClientRect();
      if (!width || !height) return;
      const scale = Math.min(width / PREVIEW_DESIGN_W, height / PREVIEW_DESIGN_H);
      if (previewIframeRef.current) {
        previewIframeRef.current.style.transform = `translate(-50%, -50%) scale(${scale})`;
      }
    };
    const ro = new ResizeObserver(update);
    ro.observe(wrap);
    update();
    return () => ro.disconnect();
  }, [showBigScreenPreview]);

  // Ensure teacher's VRM is broadcasted when room connects initially
  useEffect(() => {
    if (connectedRoom && teacherVrmSourceId) {
      const identity = connectedRoom.localParticipant.identity;
      const vrmUrl = (VRM_SOURCES[teacherVrmSourceId] || VRM_SOURCES[DEFAULT_VRM_SOURCE_ID]).url;
      const msg: BigScreenMsg = { type: 'vrm-identity-change', identity, vrmUrl };
      setTimeout(() => {
        channelRef.current?.postMessage(msg);
      }, 100);
    }
  }, [connectedRoom, teacherVrmSourceId]);

  // ─── Render ────────────────────────────────────────────────────────────────
  const studentList = Array.from(participants.values()).filter(
    (p) => !p.participant.identity.startsWith('host-'),
  );

  // Derived state: allowed VRMs for current scene
  const currentScenePreset = SCENE_PRESETS[selectedSceneId] || SCENE_PRESETS[DEFAULT_SCENE_ID];

  /** Find which group (if any) contains this slot — used for the slot-card ⚙ shortcut */
  const groupForSlot = (slotId: string) => {
    return currentScenePreset.groups?.find(g =>
      g.members.some(m => m.kind === 'slot' && m.id === slotId)
    );
  };
  const allowedVrms = useMemo(
    () => currentScenePreset.allowedVrmIds
      ? currentScenePreset.allowedVrmIds.map(id => VRM_SOURCES[id]).filter(Boolean)
      : Object.values(VRM_SOURCES),
    [currentScenePreset],
  );

  // Reverse map: identity → slotId
  const identityToSlotId = useMemo(
    () => Object.fromEntries(
      Object.entries(slotAssignments).map(([slotId, identity]) => [identity, slotId])
    ),
    [slotAssignments],
  );

  // All participants for slot assignment dropdown (teacher + students)
  const teacherIdentity = connectedRoom?.localParticipant.identity;
  const teacherName = connectedRoom?.localParticipant.name;
  const allParticipantOptions = useMemo(() => [
    ...(teacherIdentity ? [{
      value: teacherIdentity,
      label: (
        <div className="custom-select-option-content">
          {/* <span className="material-symbols-outlined" style={{color: '#F76E12'}}>school</span> */}
          <span>{teacherName ? `${teacherName} (老師)` : '老師'}</span>
        </div>
      )
    }] : []),
    ...studentList.map(info => ({
      value: info.participant.identity,
      label: (
        <div className="custom-select-option-content">
          {/* <span className="material-symbols-outlined" style={{color: '#00A99D'}}>person</span> */}
          <span>{info.participant.name || info.participant.identity}</span>
        </div>
      )
    })),
  ], [teacherIdentity, teacherName, studentList]);

  const hasSlots = currentScenePreset.slots && currentScenePreset.slots.length > 0;
  const hasModules = currentScenePreset.modules && currentScenePreset.modules.length > 0;
  const SLOT_COLORS = ['#44aaff', '#ff8844', '#aa88ff', '#44ff88'];
  // SceneConfig has no icon — look it up from THEMES SceneVariant
  const currentSceneVariant = THEMES.flatMap(t => t.scenes).find(s => s.id === selectedSceneId);

  // Index of first non-completed task (highlighted in banner)
  const currentTaskIndex = selectedTasks.findIndex(t => !t.completed);

  // Helpers to open exactly one panel at a time
  const openScene = () => { setShowScenePanel(v => !v); setShowSlotPanel(false); setShowTaskPanel(false); setShowPendingPanel(false); };
  const openSlot = () => { setShowSlotPanel(v => !v); setShowScenePanel(false); setShowTaskPanel(false); setShowPendingPanel(false); };
  const openTask = () => { setShowTaskPanel(v => !v); setShowScenePanel(false); setShowSlotPanel(false); setShowPendingPanel(false); };
  const openPending = () => { setShowPendingPanel(v => !v); setShowScenePanel(false); setShowSlotPanel(false); setShowTaskPanel(false); };
  const closeAll = () => { setShowScenePanel(false); setShowSlotPanel(false); setShowTaskPanel(false); setShowPendingPanel(false); setSceneEditorGroupId(null); };

  const handleBrandClick = () => {
    setShowExitConfirm(true);
    // sessionStorage.clear();
    // window.location.href = '/';
  };

  return (
    <div className="host-session">
      {/* Hidden video for teacher pose detection */}
      <video ref={teacherVideoRef} autoPlay playsInline muted style={{ display: 'none' }} aria-hidden="true" />

      {/* <PerformanceMonitor label="App Render FPS" position="top-left" />
      <PerformanceMonitor label="Pose Data FPS" trigger={teacherPoseData} position="bottom-left" /> */}

      {/* ── Top Bar ──────────────────────────────────────────────────────────── */}
      <div className="hs-topbar">
        <div className="hs-brand" onClick={handleBrandClick}>
          {/* <div className="hs-brand-dot" /> */}
          <div className="hs-brand-logo-wrapper">
            <img src="/logo.webp" alt="Logo" />
          </div>
          <span className="hs-brand-title"><span className="orange">MR</span> <span className="teal">雙語角</span></span>
        </div>

        <div className="hs-topbar-actions">
          <button className="hs-action-btn" onClick={openShareWindow} title="在新視窗分享房間 QR Code">
            <span className="material-icons hs-action-icon">share</span>
            <span className="hs-action-label">分享</span>
          </button>

          <button
            className={`hs-action-btn ${pending.length > 0 ? 'hs-action--alert' : ''} ${showPendingPanel ? 'hs-action--active' : ''}`}
            onClick={openPending}
            title="學生管理"
          >
            {/* <span className="hs-action-icon">👥</span> */}
            <span className="hs-action-label">{studentList.length} 位學生</span>
            {pending.length > 0 && <span className="hs-badge-btn hs-badge--alert">{pending.length}</span>}
          </button>

          <RecordingPanel isRecording={isRecording} onStart={start} onStop={stop} />

          <button
            className={`hs-action-btn ${faceEnabled ? 'hs-action--on' : 'hs-action--off'}`}
            onClick={() => setFaceEnabled(v => !v)}
            title={faceEnabled ? '關閉臉部辨識' : '開啟臉部辨識'}
          >
            {/* <span className="hs-action-icon">{faceEnabled ? '😊' : '😶'}</span> */}
            <span className="material-symbols-outlined">ar_on_you</span>
            <span className="hs-action-label">臉部</span>
            <span className={`hs-badge-btn ${faceEnabled ? 'hs-badge--on' : 'hs-badge--off'}`}>{faceEnabled ? 'ON' : 'OFF'}</span>
          </button>

          {/* <button
            className={`hs-action-btn ${lowPowerMode ? 'hs-action--on' : 'hs-action--off'}`}
            onClick={() => setLowPowerMode(v => !v)}
            title={lowPowerMode ? '關閉省電模式（臉部/手部 15 FPS）' : '開啟省電模式（臉部/手部降至 7.5 FPS）'}
          >
            <span className="material-symbols-outlined">battery_saver</span>
            <span className="hs-action-label">省電</span>
            <span className={`hs-badge-btn ${lowPowerMode ? 'hs-badge--on' : 'hs-badge--off'}`}>{lowPowerMode ? 'ON' : 'OFF'}</span>
          </button> */}

          <button
            className={`hs-action-btn hs-action-preview ${showBigScreenPreview ? 'hs-action--on' : 'hs-action--off'}`}
            onClick={toggleBigScreenPreview}
            title={showBigScreenPreview ? '關閉大屏預覽' : '開啟大屏預覽'}
          >
            {/* <span className="hs-action-icon">🖥️</span> */}
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
              preview
            </span>
            <span className="hs-action-label">預覽</span>
            <span className={`hs-badge-btn ${showBigScreenPreview ? 'hs-badge--on' : 'hs-badge--off'}`}>
              {showBigScreenPreview ? 'ON' : 'OFF'}
            </span>
          </button>
        </div>
      </div>

      {/* ── Settlement Modal ──────────────────────────────────────────────────── */}
      {showSettlement && (
        <div className="settlement-backdrop" onClick={() => setShowSettlement(false)}>
          <div className="settlement-modal" onClick={e => e.stopPropagation()}>
            {/* Close button */}
            <button className="settlement-close" onClick={() => setShowSettlement(false)}>✕</button>

            {/* Header — matches BigScreen style */}
            <div className="bs-settlement-header">
              <div className="bs-settlement-trophy">
                <img src="/images/UI/medal.png" alt="Trophy" />
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
                    {connectedRoom && (
                      <div className="bs-settlement-participant host">
                        <span className="material-icons bs-participant-icon">school</span>
                        <span className="bs-participant-name">
                          {connectedRoom.localParticipant.name || connectedRoom.localParticipant.identity}
                          <span className="bs-teacher-label">老師</span>
                        </span>
                      </div>
                    )}
                    {studentList.map(info => (
                      <div key={info.participant.identity} className="bs-settlement-participant">
                        <span className="material-icons bs-participant-icon">person</span>
                        <span className="bs-participant-name">{info.participant.name || info.participant.identity}</span>
                      </div>
                    ))}
                    {studentList.length === 0 && <div className="bs-settlement-participant"><span>—</span></div>}
                  </div>
                </div>

                {/* Right: Recording */}
                <div className="bs-settlement-col">
                  <div className="bs-settlement-col-title">錄製</div>
                  <div className={`bs-rec-status ${isRecording ? 'active' : hasRecorded ? 'done' : ''}`}>
                    {isRecording ? (
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
                  {isRecording && (
                    <button className="settlement-stop-btn" onClick={async () => { await stop(); }}>⏹ 停止錄製</button>
                  )}
                </div>
              </div>

              {/* Tasks List */}
              <div className="bs-settlement-col">
                <div className="bs-settlement-col-title">任務清單</div>
                <div className="bs-settlement-tasklist">
                  {selectedTasks.map((task, idx) => (
                    <div key={task.id} className={`bs-settlement-task ${task.completed ? 'done' : 'undone'}`}>
                      <div className="bs-task-num">{idx + 1}</div>
                      <span className="bs-task-label">{task.label}</span>
                      <span className="bs-task-check">
                        {task.completed
                          ? <span className="material-symbols-outlined">check</span>
                          : <span className="material-symbols-outlined">close</span>}
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

      {/* ── Main Body: Sidebar + Video ────────────────────────────────────────── */}
      <div className="hs-body">

        {/* ── Left Sidebar ──────────────────────────────────────────────────── */}
        <div className="hs-sidebar">

          {/* Scene card */}
          <div className={`hs-card hs-card--scene ${showScenePanel ? 'hs-card--open' : ''}`} onClick={openScene}>
            <div className="hs-card-header">
              <span className="hs-card-icon">🎬</span>
              <span className="hs-card-title">場景</span>
              <span className="hs-badge hs-badge--info" >{showScenePanel ? '▲' : '▼'}</span>
              {/* <span className="hs-card-arrow">{showScenePanel ? '▲' : '▼'}</span> */}
            </div>
            <div className="hs-scene-preview">
              <div
                className={`hs-scene-thumb ${!currentScenePreset.backgroundValue ? 'hs-scene-thumb--no-img' : ''}`}
                style={currentScenePreset.backgroundValue && currentScenePreset.backgroundType !== 'video' ? { backgroundImage: `url(${currentScenePreset.backgroundValue})` } : undefined}
              >
                {currentScenePreset.backgroundValue && currentScenePreset.backgroundType === 'video' && (
                  <video
                    src={currentScenePreset.backgroundValue}
                    // autoPlay
                    // loop
                    muted
                    playsInline
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                )}
                {currentScenePreset.backgroundValue && <div className="hs-scene-thumb-overlay" />}
                <span className="hs-scene-thumb-icon">{currentSceneVariant?.icon ?? '🎬'}</span>
              </div>
              <span className="hs-scene-label">{currentScenePreset.label}</span>
            </div>
          </div>

          {/* Character / Slot card */}
          {hasSlots && (
            <div className={`hs-card hs-card--character ${showSlotPanel ? 'hs-card--open' : ''}`} onClick={openSlot}>
              <div className="hs-card-header">
                <span className="hs-card-icon">🎭</span>
                <span className="hs-card-title">角色</span>
                <span className="hs-badge hs-badge--info">{Object.keys(slotAssignments).length}/{currentScenePreset.slots!.length}</span>
              </div>
              <div className="hs-slot-list">
                {currentScenePreset.slots!.map((slot, i) => {
                  const assigned = slotAssignments[slot.id];
                  const assignedParticipant = assigned ? (
                    assigned === teacherIdentity
                      ? (teacherName ? teacherName : '老師')
                      : studentList.find(info => info.participant.identity === assigned)?.participant.name || assigned
                  ) : '─';
                  return (
                    <div
                      key={slot.id}
                      className={`hs-slot-row ${assigned ? 'hs-slot-row--filled' : 'hs-slot-row--empty'}`}
                      style={{ '--slot-color': SLOT_COLORS[i % SLOT_COLORS.length] } as React.CSSProperties}
                    >
                      <span className="hs-slot-dot" />
                      <span className="hs-slot-label">{slot.icon} {slot.label}</span>
                      <span className="hs-slot-assigned">{assignedParticipant}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Task card */}
          {hasModules && (
            <div className={`hs-card hs-card--task ${showTaskPanel ? 'hs-card--open' : ''}`} onClick={openTask}>
              <div className="hs-card-header">
                <span className="hs-card-icon">📋</span>
                <span className="hs-card-title">任務</span>
                <span className={`hs-badge hs-badge--task ${selectedTasks.length >= 7 ? 'hs-badge--limit' : ''}`}>
                  {selectedTasks.filter(t => t.completed).length}/{selectedTasks.length}
                </span>
              </div>
              {selectedTasks.length > 0 ? (
                <div className="hs-task-preview">
                  <div className="hs-task-progress-bar">
                    <div
                      className="hs-task-progress-fill"
                      style={{ width: `${Math.round((selectedTasks.filter(t => t.completed).length / selectedTasks.length) * 100)}%` }}
                    />
                  </div>
                  <div className="hs-task-preview-list">
                    {selectedTasks.map((task, idx) => (
                      <label
                        key={task.id}
                        className={`hs-task-preview-row ${task.completed ? 'completed' : idx === currentTaskIndex ? 'current' : ''}`}
                        onClick={e => { e.stopPropagation(); if (!task.completed && idx !== currentTaskIndex) return; toggleTaskCompletion(task.id); }}
                      >
                        <input type="checkbox" checked={task.completed} disabled={!task.completed && idx !== currentTaskIndex} readOnly onClick={e => e.stopPropagation()} />
                        <span>{task.label}</span>
                      </label>
                    ))}
                    <div className="hs-task-reset" onClick={(e) => { e.stopPropagation(); resetAllTasks(); }}>↺ 重置全部</div>
                    {/* <div className="hs-task-more">+更多</div> */}
                    {/* {selectedTasks.length > 4 && <div className="hs-task-more">+{selectedTasks.length - 4} 更多</div>} */}
                  </div>
                </div>
              ) : (
                <div className="hs-task-empty">點擊選擇任務</div>
              )}
            </div>
          )}
        </div>

        {/* ── Video Area ────────────────────────────────────────────────────── */}
        <div className="hs-video-area hs-video-area--with-hint">

          {/* Task banner strip */}
          {selectedTasks.length > 0 && (() => {
            const doneCount = selectedTasks.filter(t => t.completed).length;
            const pct = Math.round((doneCount / selectedTasks.length) * 100);
            const allDone = doneCount === selectedTasks.length;
            return (
              <div className={`hs-task-banner ${allDone ? 'hs-task-banner--done' : ''}`}>
                <div className="hs-task-banner-bar">
                  <div className="hs-task-banner-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="hs-task-banner-text">
                  {allDone ? (
                    <>
                      <span>✓ 所有任務完成！</span>
                      <button className="hs-settlement-btn" onClick={e => { e.stopPropagation(); setShowSettlement(true); }}><span className="material-symbols-outlined">finance</span>結算</button>
                    </>
                  ) : (
                    <>
                      <span className="hs-task-arrow">▸</span>
                      <span className="hs-task-label">
                        {selectedTasks[currentTaskIndex]?.label}
                      </span>
                      <span className="hs-task-counter">{doneCount}/{selectedTasks.length}</span>
                      {/* <button
                        className={`hs-hint-toggle ${hintEnabled ? 'is-on' : ''}`}
                        onClick={(e) => { e.stopPropagation(); toggleHintEnabled(); }}
                        title={hintEnabled ? '關閉任務提示' : '開啟任務提示'}
                      >
                        <span className="material-symbols-outlined">lightbulb</span>
                        <span className="hs-hint-toggle-label">任務提示</span>
                        <span className="hs-hint-toggle-badge">{hintEnabled ? 'ON' : 'OFF'}</span>
                      </button> */}
                    </>
                  )}
                </div>
              </div>
            );
          })()}

          <div className="hs-video-body">
            <div className="hs-video-main">
              {/* BigScreen embedded preview */}
              {showBigScreenPreview && (
                <div className="hs-preview-pane">
                  <div className="hs-preview-header">
                    <span className="hs-preview-title"><span className="material-icons">preview</span>大屏預覽</span>
                    <button className="hs-preview-close" onClick={toggleBigScreenPreview} title="關閉預覽">✕</button>
                  </div>
                  {/* Scaling viewport wrapper — iframe renders at 1920×1080, then scaled down */}
                  <div className="hs-preview-scaler-wrap" ref={previewWrapRef}>
                    <iframe
                      ref={previewIframeRef}
                      className="hs-preview-iframe"
                      src={`${window.location.origin}/?screen=bigscreen`}
                      title="BigScreen Preview"
                      allow="camera; microphone"
                      width={1920}
                      height={1080}
                    />
                  </div>
                </div>
              )}

              {/* Video grid */}
              <div className={`hs-grid ${showBigScreenPreview ? 'hs-grid--with-preview' : ''}`}>

                {/* ── Teacher card ── */}
                {connectedRoom && (() => {
                  const teacherIdentityLocal = connectedRoom.localParticipant.identity;
                  const teacherSlotId = identityToSlotId[teacherIdentityLocal];
                  const teacherSlot = teacherSlotId
                    ? currentScenePreset.slots?.find((s) => s.id === teacherSlotId)
                    : undefined;
                  const isTeacherSpeaking = speakingSet.has(teacherIdentityLocal);
                  return (
                    <div
                      className={`hs-video-card hs-teacher-card${isTeacherSpeaking ? ' hs-video-card--speaking' : ''}`}
                      style={{ opacity: hasSlots && !teacherSlot ? 0.8 : 1 }}
                    >
                      <LocalVideo
                        room={connectedRoom}
                        poseData={teacherPoseData}
                        vrmSourceId={hasSlots && !teacherSlot ? null : teacherVrmSourceId}
                        slotLabel={teacherSlot?.label}
                      />
                    </div>
                  );
                })()}

                {/* ── Student tiles ── */}
                {studentList.map((info) => {
                  const currentVrmId = studentRoles[info.participant.identity] ?? selectedVrmSourceId;
                  const assignedSlotId = identityToSlotId[info.participant.identity];
                  const assignedSlot = assignedSlotId
                    ? currentScenePreset.slots?.find(s => s.id === assignedSlotId)
                    : undefined;
                  const isStudentSpeaking = speakingSet.has(info.participant.identity);
                  return (
                    <div
                      key={info.participant.identity}
                      className={`hs-video-card${isStudentSpeaking ? ' hs-video-card--speaking' : ''}`}
                      style={{ opacity: hasSlots && !assignedSlot ? 0.8 : 1 }}
                    >
                      <StudentTile
                        participant={info.participant}
                        videoTrack={info.videoTrack}
                        poseData={info.poseData}
                        vrmSourceId={hasSlots && !assignedSlot ? null : currentVrmId}
                        muteState={muteState[info.participant.identity]}
                        onToggleMute={toggleMute}
                        onRemove={handleRemoveStudent}
                        slotLabel={assignedSlot?.label}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {(() => {
              const currentTask = selectedTasks.find(t => !t.completed);
              const hint = currentTask ? TASK_HINTS[currentTask.id] : undefined;
              const renderLevelContent = (lv: HintLevel) => {
                if (!hint) return null;
                if (lv === 'unscramble')
                  return <div className="hs-hint-chips">{hint.unscramble.map((w, i) => <span key={i} className="hs-hint-chip">{w}</span>)}</div>;
                if (lv === 'extraPhrases')
                  return <ol className="hs-hint-opts">{hint.extraPhrases.map((o, i) => <li key={i}>{o}</li>)}</ol>;
                const text =
                  lv === 'completeSentence' ? hint.completeSentence
                    : lv === 'keyStructure' ? hint.keyStructure
                      : hint.partialSentence;
                return <div className="hs-hint-line">{text}</div>;
              };
              const hasConstraint = !!SCENE_CONSTRAINTS[selectedSceneId];
              const tooShort = !sttTranscript || sttTranscript.trim().length < 3;
              const canTrigger = sttSupported && !sttRecording && !tooShort && hasConstraint;
              return (
                <div className="hs-right-panel">
                  <div className="hs-right-panel-tabs">
                    {hintEnabled && (
                      <button
                        className={`hs-right-tab ${rightPanelTab === 'task-hints' ? 'is-active' : ''}`}
                        onClick={() => setRightPanelTab('task-hints')}
                      >
                        <span className="material-symbols-outlined">lightbulb</span>
                        任務提示
                      </button>
                    )}
                    {/* <button
                      className={`hs-right-tab ${rightPanelTab === 'ai-assistant' ? 'is-active' : ''}`}
                      onClick={() => setRightPanelTab('ai-assistant')}
                    >
                      <span className="hs-ai-tab-icon">✨</span>
                      AI 助理
                    </button> */}
                  </div>

                  {hintEnabled && rightPanelTab === 'task-hints' && (
                    <div className="hs-hint-panel">
                      <div className="hs-hint-panel-header">
                        <span className="material-symbols-outlined">lightbulb</span>
                        <span>任務提示</span>
                        <button
                          className={`hs-hint-toggle hs-hint-toggle--inline ${hintEnabled ? 'is-on' : ''}`}
                          onClick={(e) => { e.stopPropagation(); toggleHintEnabled(); }}
                          title={hintEnabled ? '關閉廣播到大屏' : '開啟廣播到大屏'}
                        >
                          <span className="hs-hint-toggle-badge">{hintEnabled ? 'ON' : 'OFF'}</span>
                        </button>
                      </div>
                      <div className="hs-hint-panel-task">
                        {selectedTasks.length === 0 ? '尚未選擇任務'
                          : !currentTask ? '所有任務已完成'
                            : currentTask.label}
                      </div>
                      <div className="hs-hint-levels">
                        {HINT_LEVELS.map(({ level, num, label }) => (
                          <button
                            key={level}
                            className={`hs-hint-level-btn ${hintLevel === level ? 'is-active' : ''}`}
                            disabled={!currentTask || !hint || !hintEnabled}
                            onClick={() => setHint(level)}
                          >{num} {label}</button>
                        ))}
                        <button
                          className={`hs-hint-level-btn hs-hint-level-btn--none ${hintLevel === null ? 'is-active' : ''}`}
                          disabled={!hintEnabled}
                          onClick={() => setHint(null)}
                        >✕ 不顯示</button>
                      </div>
                      <div className="hs-hint-panel-body">
                        {!hintEnabled ? (
                          <div className="hs-hint-placeholder">任務提示廣播已關閉。按上方 ON 開啟。</div>
                        ) : !currentTask ? (
                          <div className="hs-hint-placeholder">{selectedTasks.length === 0 ? '請先在「任務」面板選擇任務' : '所有任務已完成'}</div>
                        ) : !hint ? (
                          <div className="hs-hint-placeholder">此任務尚無提示資料</div>
                        ) : hintLevel === null ? (
                          <div className="hs-hint-placeholder">目前未顯示提示。點上方階層按鈕讓學生大屏顯示。</div>
                        ) : (
                          <div className="hs-hint-active">
                            <div className="hs-hint-active-tag">{hintLevelMeta(hintLevel).num} {hintLevelMeta(hintLevel).label}（學生大屏顯示中）</div>
                            {renderLevelContent(hintLevel)}
                          </div>
                        )}
                        {hint && currentTask && (
                          <div className="hs-hint-allref">
                            {HINT_LEVELS.filter(l => l.level !== hintLevel).map(({ level, num, label }) => (
                              <div key={level} className="hs-hint-ref-row">
                                <span className="hs-hint-ref-tag">{num} {label}</span>
                                <span className="hs-hint-ref-content">{renderLevelContent(level)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {rightPanelTab === 'ai-assistant' && (
                    <div className="hs-ai-panel">
                      <div className="hs-ai-brand">
                        <span className="hs-ai-brand-icon">✨</span>
                        <span className="hs-ai-brand-text">
                          <span className="hs-ai-brand-ai">AI</span>
                          <span className="hs-ai-brand-tag">助理</span>
                        </span>
                      </div>

                      {!sttSupported ? (
                        <div className="hs-ai-error">瀏覽器不支援 Web Speech API，請使用 Chrome 或 Edge</div>
                      ) : !hasConstraint ? (
                        <div className="hs-ai-error">此場景尚無 AI 助理約束文件</div>
                      ) : null}

                      {/* ── 開始互動（開放式輪流）─────────────────────── */}
                      <div className="hs-ai-section">
                        {interactionPhase === 'idle' && (
                          <button
                            className={`hs-ai-start-btn phase-${interactionPhase}`}
                            disabled={!sttSupported || !hasConstraint || aiBusy}
                            onClick={startInteraction}
                          >
                            <span className="material-symbols-outlined">smart_toy</span>
                            開始互動
                          </button>
                        )}
                        {interactionPhase === 'teacher' && (
                          <button
                            className={`hs-ai-start-btn phase-${interactionPhase}`}
                            disabled={aiBusy}
                            onClick={handleTeacherDone}
                          >
                            <span className="material-symbols-outlined">swap_horiz</span>
                            {aiBusy ? '上一輪生成中…' : '換學生'}
                          </button>
                        )}
                        {interactionPhase === 'generating' && (
                          <button className={`hs-ai-start-btn phase-${interactionPhase}`} disabled>
                            AI 生成中…
                          </button>
                        )}
                        {interactionPhase === 'student' && (
                          <button
                            className={`hs-ai-start-btn phase-${interactionPhase}`}
                            onClick={handleTeacherTakeover}
                          >
                            <span className="material-symbols-outlined">undo</span>
                            輪到自己
                          </button>
                        )}
                        {interactionPhase !== 'idle' && (
                          <button className="hs-ai-start-cancel" onClick={endInteraction}>
                            結束互動
                          </button>
                        )}
                      </div>

                      {/* ── 音錄 ─────────────────────────────────────── */}
                      <div className="hs-ai-section">
                        {/* <div className="hs-ai-section-label">音錄</div> */}
                        <div className={`hs-ai-record-card ${sttRecording ? 'is-recording' : ''}`}>
                          <div className="hs-ai-record-time">
                            {String(Math.floor(recordDuration / 60)).padStart(2, '0')}:{String(recordDuration % 60).padStart(2, '0')}
                          </div>
                          <div className={`hs-ai-waveform ${sttRecording ? 'is-active' : ''}`} aria-hidden="true">
                            {[
                              15, 20, 25, 45, 60, 50, 35, 40, 75, 90, 80, 65,
                              45, 55, 85, 100, 95, 80, 65, 50, 40, 30, 25, 35,
                              55, 70, 80, 60, 45, 30, 20, 15, 12, 10, 8, 5
                            ].map((h, i) => (
                              <span
                                key={i}
                                className="hs-ai-wave-bar"
                                style={{
                                  '--bar-h': `${h}%`,
                                  animationDelay: `${i * 0.05}s`
                                } as React.CSSProperties}
                              />
                            ))}
                          </div>
                          <div className="hs-ai-record-actions">
                            <button
                              className="hs-ai-record-action-btn"
                              disabled={!sttSupported}
                              onClick={handleToggleRecord}
                              title={sttRecording ? '停止錄音' : '備用：點擊開始錄音'}
                            >
                              <span className="material-symbols-outlined">
                                {sttRecording ? 'stop_circle' : 'mic'}
                              </span>
                              {sttRecording ? '停止' : '備用'}
                            </button>
                          </div>
                          <div className="hs-ai-record-status-row">
                            {sttRecording
                              ? '錄音中… 放開 Space 即送出'
                              : sttSupported
                                ? <>
                                  按住 <kbd className="hs-ai-kbd">Space</kbd> 開始，放開即發送
                                </>
                                : '不支援'}
                          </div>
                        </div>
                        {sttError && <div className="hs-ai-error">{sttError}</div>}
                        {import.meta.env.DEV && (
                          <div className="hs-ai-sim" style={{ marginTop: 8, padding: 8, border: '1px dashed #999', borderRadius: 6, fontSize: 12 }}>
                            <div style={{ color: '#888', marginBottom: 4 }}>🛠 DEV：模擬錄音（直接帶入文字）</div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <input
                                type="text"
                                value={simInput}
                                onChange={(e) => setSimInput(e.target.value)}
                                placeholder="例如：How would you like to pay, cash or card?"
                                style={{ flex: 1, padding: '4px 6px', fontSize: 12 }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && simInput.trim().length >= 3) {
                                    cancelAutoCountdown();
                                    setAiError(null);
                                    simulateTranscript(simInput);
                                  }
                                }}
                              />
                              <button
                                onClick={() => {
                                  cancelAutoCountdown();
                                  setAiError(null);
                                  simulateTranscript(simInput);
                                }}
                                disabled={simInput.trim().length < 3 || sttRecording}
                                style={{ padding: '4px 10px', fontSize: 12 }}
                              >
                                帶入
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* ── AI 回覆語句 ──────────────────────────────── */}
                      <div className="hs-ai-section">
                        <div className="hs-ai-section-label">AI 回覆語句</div>
                        <div className="hs-ai-reply-card">
                          <div className="hs-ai-reply-row">
                            <div className="hs-ai-reply-label">老師原話</div>
                            <div className="hs-ai-reply-text">
                              {sttRecording && sttInterim
                                ? <span className="hs-ai-reply-interim">"{sttInterim}"</span>
                                : sttTranscript
                                  ? `"${sttTranscript}"`
                                  : <span className="hs-ai-reply-placeholder">尚未錄音</span>}
                            </div>
                          </div>
                          <div className="hs-ai-reply-row">
                            <div className="hs-ai-reply-label">
                              <span>AI 回覆</span>
                              {/* {import.meta.env.DEV && aiModel && (
                                <span className="hs-ai-model-badge" title="目前使用的 Gemini 模型">{aiModel}</span>
                              )} */}
                            </div>
                            <div className="hs-ai-reply-text">
                              {aiBusy
                                ? <span className="hs-ai-reply-placeholder">AI 生成中…</span>
                                : latestHint && latestHint.content
                                  ? latestHint.content
                                  : <span className="hs-ai-reply-placeholder">尚未生成提示</span>}
                            </div>
                            {latestHint?.content && !aiBusy && (
                              <button
                                className="hs-ai-reply-speak"
                                title="朗讀"
                                onClick={() => {
                                  try {
                                    const u = new SpeechSynthesisUtterance(latestHint.content!);
                                    u.lang = 'en-US';
                                    window.speechSynthesis.cancel();
                                    window.speechSynthesis.speak(u);
                                  } catch { /* ignore */ }
                                }}
                              >
                                <span className="material-symbols-outlined">volume_up</span>
                              </button>
                            )}
                          </div>
                          {!sttRecording && sttTranscript && tooShort && (
                            <div className="hs-ai-warn">太短，請再錄一次</div>
                          )}
                        </div>
                      </div>

                      {countdown !== null && (
                        <div className="hs-ai-countdown">
                          <span className="hs-ai-countdown-text">⏱ {countdown} 秒後自動廣播重組提示…</span>
                          <div className="hs-ai-countdown-bar">
                            <div className="hs-ai-countdown-fill" style={{ width: `${(countdown / 3) * 100}%` }} />
                          </div>
                        </div>
                      )}

                      {/* ── 提示難度 ─────────────────────────────────── */}
                      <div className="hs-ai-section">
                        <div className="hs-ai-section-label">提示難度</div>
                        <div className="hs-ai-mode-cards">
                          <button
                            className={`hs-ai-mode-card hs-ai-mode-card--rearrange ${countdown !== null ? 'is-auto-target' : ''} ${latestHint?.mode === 'rearrange' ? 'is-active' : ''}`}
                            disabled={aiBusy || !(canTrigger || latestHint !== null)}
                            onClick={() => handleHint('rearrange')}
                          >
                            <span className="hs-ai-mode-card-icon">
                              <span className="material-symbols-outlined">shuffle</span>
                            </span>
                            <span className="hs-ai-mode-card-label">重組{countdown !== null ? '（自動）' : ''}</span>
                          </button>
                          <button
                            className={`hs-ai-mode-card hs-ai-mode-card--complete ${latestHint?.mode === 'complete' ? 'is-active' : ''}`}
                            disabled={aiBusy || !(canTrigger || latestHint !== null)}
                            onClick={() => handleHint('complete')}
                          >
                            <span className="hs-ai-mode-card-icon">
                              <span className="material-symbols-outlined">check_circle</span>
                            </span>
                            <span className="hs-ai-mode-card-label">完整</span>
                          </button>
                          <button
                            className={`hs-ai-mode-card hs-ai-mode-card--extend ${latestHint?.mode === 'extend' ? 'is-active' : ''}`}
                            disabled={aiBusy || !(canTrigger || latestHint !== null)}
                            onClick={() => handleHint('extend')}
                          >
                            <span className="hs-ai-mode-card-icon">
                              <span className="material-symbols-outlined">open_in_new</span>
                            </span>
                            <span className="hs-ai-mode-card-label">延伸</span>
                          </button>
                        </div>
                      </div>

                      {aiError && <div className="hs-ai-error">{aiError}</div>}

                      {/* ── 重組提示 chips（僅 rearrange 模式顯示）─────── */}
                      {latestHint && latestHint.content && latestHint.mode === 'rearrange' && (
                        <div className="hs-ai-section">
                          <div className="hs-ai-section-label">重組提示</div>
                          <div className="hs-ai-chips">
                            {latestHint.content.split(' ').map((w, i) => (
                              <span key={i} className="ai-chip">{w}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {latestHint && latestHint.content && (
                        <button className="hs-ai-clear-btn" onClick={handleClearAIHint}>✕ 清除學生畫面</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* ── Big Screen FAB (bottom-right) ────────────────────────────────────── */}
      <button id="open-bigscreen-btn" className="hs-bigscreen-fab" onClick={openBigScreen} title="在新視窗開啟大屏顯示">
        {/* <span className="hs-fab-icon"></span> */}
        <span className="material-symbols-outlined">rocket_launch</span>
        <span className="hs-fab-label">開啟大屏</span>
      </button>

      {/* ── Drawer Backdrop ───────────────────────────────────────────────────── */}
      {(showScenePanel || showSlotPanel || showTaskPanel || showPendingPanel || sceneEditorGroupId) && (
        <div className="panel-backdrop" onClick={closeAll} />
      )}

      {/* ── Pending Requests Drawer ───────────────────────────────────────────── */}
      <div className={`panel-drawer ${showPendingPanel ? 'panel-drawer--open' : ''}`}>
        <div className="panel-drawer-header">
          <div className="slot-drawer-title">
            <span className="orange">學生管理</span><span className="teal">STUDENTS</span>
          </div>
          <button className="panel-close-btn" onClick={() => setShowPendingPanel(false)}>✕</button>
        </div>
        <div className="panel-drawer-body">
          <div className="pending-section-header">
            <span>待審核學生</span>
            <span className="pending-section-count">({pending.length})</span>
          </div>

          {pending.length === 0 && (
            <div className='pending-section-description'>
              目前沒有加入請求
            </div>
          )}

          {pending.map((s) => (
            <div key={s.requestId} className="pending-student-card">
              <div className="pending-avatar-container">
                <span className="material-symbols-outlined pending-avatar-icon">person</span>
              </div>
              <div className="pending-student-info">
                <span className="pending-student-name">{s.name}</span>
                <div className="pending-card-actions">
                  <button className="pending-btn pending-btn-allow" onClick={() => handleApprove(s.requestId)}>允許</button>
                  <button className="pending-btn pending-btn-reject" onClick={() => handleReject(s.requestId)}>拒絕</button>
                </div>
              </div>
            </div>
          ))}

          <div className="pending-section-header">
            <span>已加入學生</span>
            <span className="pending-section-count">({studentList.length})</span>
          </div>

          {studentList.length === 0 && (
            <div className='pending-section-description'>
              目前沒有學生加入
            </div>
          )}

          {studentList.map((info) => (
            <div key={info.participant.identity} className="pending-student-card">
              <div className="pending-avatar-container">
                <span className="material-symbols-outlined pending-avatar-icon">
                  {/* Ideally different icons for different students, but generic for now */}
                  person
                </span>
              </div>
              <div className="pending-student-info">
                <span className="pending-student-name">{info.participant.name || info.participant.identity}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Scene Drawer ─────────────────────────────────────────────────────── */}
      <div className={`panel-drawer ${showScenePanel ? 'panel-drawer--open' : ''}`}>
        <div className="panel-drawer-header">
          <div className="slot-drawer-title">
            <span className="orange">場景選擇</span> <span className="teal">SCENES</span>
          </div>
          <button className="panel-close-btn" onClick={() => setShowScenePanel(false)}>✕</button>
        </div>
        <div className="panel-drawer-body">
          {THEMES.map((theme) => (
            <div key={theme.id} className="scene-group">
              <div className="scene-group-label"><span className="material-symbols-outlined" style={{ marginRight: '5px' }}>{theme.icon}</span> {theme.label}</div>
              {/* <div className="scene-group-label">{theme.label}</div> */}
              <div className="scene-options-list">
                {theme.scenes.map((scene) => {
                  const isActive = selectedSceneId === scene.id;
                  return (
                    <React.Fragment key={scene.id}>
                      <div
                        className={`scene-card-btn ${isActive ? 'active' : ''}`}
                        onClick={() => { handleSceneChange(scene.id); }}
                      >
                        <div className="scene-card-preview">
                          {SCENE_PRESETS[scene.id]?.backgroundValue && SCENE_PRESETS[scene.id]?.backgroundType !== 'video' && (
                            <div
                              className="scene-card-img"
                              style={{ backgroundImage: `url(${SCENE_PRESETS[scene.id].backgroundValue})` }}
                            />
                          )}
                          {SCENE_PRESETS[scene.id]?.backgroundValue && SCENE_PRESETS[scene.id]?.backgroundType === 'video' && (
                            <video
                              className="scene-card-img"
                              src={SCENE_PRESETS[scene.id].backgroundValue}
                              autoPlay
                              loop
                              muted
                              playsInline
                            />
                          )}
                          <div className="scene-card-tag">
                            {/* {scene.icon && <span className="scene-tag-icon"><span className="material-symbols-outlined">{scene.icon}</span></span>} */}
                            <span className="scene-tag-label">{scene.label}</span>
                          </div>
                        </div>
                        <div className="scene-card-info">
                          <span className="scene-card-label-en">{scene.labelEn || scene.label}</span>
                          {isActive && (
                            <div className="scene-card-check">
                              <span className="material-symbols-outlined">check</span>
                            </div>
                          )}
                        </div>
                      </div>
                      {/* Embedded bg-source panel below the active card */}
                      {isActive && (
                        <SceneBackgroundControls
                          bgType={bgTypeOverride}
                          onBgTypeChange={handleBgTypeOverrideChange}
                          deviceId={cameraBgDeviceId}
                          onDeviceChange={handleCameraBgDeviceChange}
                          bgIntensity={50}
                          onBgIntensityChange={() => { }}
                        />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Slot Drawer ──────────────────────────────────────────────────────── */}
      {hasSlots && (
        <div className={`panel-drawer ${showSlotPanel ? 'panel-drawer--open' : ''}`}>
          <div className="panel-drawer-header">
            <div className="slot-drawer-title">
              <span className="orange">角色配置</span> <span className="teal">ROLES</span>
            </div>
            <button className="panel-close-btn" onClick={() => setShowSlotPanel(false)}>✕</button>
          </div>
          <div className="panel-drawer-body">
            {currentScenePreset.slots!.map((sceneSlot, _slotIndex) => {
              const assignedIdentity = slotAssignments[sceneSlot.id];
              const assignedVrmId = assignedIdentity
                ? (assignedIdentity === teacherIdentity
                  ? teacherVrmSourceId
                  : (studentRoles[assignedIdentity] ?? sceneSlot.defaultVrmId ?? selectedVrmSourceId))
                : (sceneSlot.defaultVrmId ?? selectedVrmSourceId);
              return (
                <div key={sceneSlot.id} className="slot-card">
                  <div className="slot-card-top">
                    <div className="slot-icon-container">
                      {sceneSlot.icon}
                    </div>
                    {(() => {
                      const g = groupForSlot(sceneSlot.id);
                      if (!g) return null;
                      return (
                        <button
                          className="slot-card-settings-btn"
                          title={`編輯群組：${g.label}`}
                          onClick={() => setSceneEditorGroupId(g.id)}
                        >
                          ⚙
                        </button>
                      );
                    })()}
                    <div className="slot-info">
                      <div className="slot-name">{sceneSlot.label}</div>
                      <div className="slot-status-badge">
                        {assignedIdentity ? '已指派' : '未指派'}
                      </div>
                      <div className="slot-pos-hint">
                        位置：{sceneSlot.position[0] >= 0 ? '右側' : '左側'}
                        {/* 位置：{sceneSlot.position[0] >= 0 ? '右側' : '左側'} (x={sceneSlot.position[0]}) */}
                      </div>
                    </div>
                  </div>

                  <div className="slot-field">
                    <label className="slot-field-label">指派給</label>
                    <CustomSelect
                      value={assignedIdentity ?? ''}
                      options={[
                        {
                          value: '',
                          label: (
                            <div className="custom-select-option-content">
                              {/* <span className="material-symbols-outlined" style={{ color: '#999' }}>person_off</span> */}
                              <span style={{ color: '#666' }}>─ 移除指派</span>
                            </div>
                          )
                        },
                        ...allParticipantOptions
                      ]}
                      onChange={(val) => {
                        handleSlotAssign(sceneSlot.id, val === '' ? null : val);
                      }}
                      placeholder="─ 移除指派"
                    />
                  </div>

                  <div className="slot-field">
                    <label className="slot-field-label">角色模型</label>
                    <CustomSelect
                      value={assignedVrmId ?? ''}
                      disabled={!assignedIdentity}
                      options={allowedVrms.map((s) => ({
                        value: s.id,
                        label: (
                          <div className="custom-select-option-content">
                            {s.id === sceneSlot.defaultVrmId ? (
                              <span className="material-symbols-outlined" style={{ color: (!assignedIdentity && s.id === sceneSlot.defaultVrmId) ? '#999' : '#F76E12' }}>star</span>
                            ) : (
                              ''
                              // <span className="material-symbols-outlined" style={{ color: '#00A99D' }}>accessibility_new</span>
                            )}
                            <span>{s.label}</span>
                          </div>
                        )
                      }))}
                      onChange={(val) => {
                        if (assignedIdentity) {
                          if (assignedIdentity === teacherIdentity) {
                            handleTeacherVrmChange(val);
                          } else {
                            handleStudentRoleChange(assignedIdentity, val);
                          }
                        }
                      }}
                      placeholder="─ 預設模型 ─"
                    />
                  </div>
                </div>
              );
            })}
            <div className="slot-drawer-footer">未指派者不出現在大屏</div>
          </div>
        </div>
      )}

      {/* ── Scene Editor Drawer ────────────────────────────────────────────── */}
      {sceneEditorGroupId && (() => {
        const g = currentScenePreset.groups?.find(x => x.id === sceneEditorGroupId);
        if (!g) return null;
        return (
          <SceneEditor
            sceneId={selectedSceneId}
            group={g}
            channel={channelRef.current}
            open={true}
            onClose={() => setSceneEditorGroupId(null)}
          />
        );
      })()}

      {/* ── Task Drawer ──────────────────────────────────────────────────────── */}
      {hasModules && (
        <div className={`panel-drawer panel-drawer--wide ${showTaskPanel ? 'panel-drawer--open' : ''}`}>
          <div className="panel-drawer-header">
            <div className="slot-drawer-title">
              <span className="orange">任務管理</span> <span className="teal">TASKS</span>
            </div>
            <button className="panel-close-btn" onClick={() => setShowTaskPanel(false)}>
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
          <div className="panel-drawer-body task-manager-drawer">
            {/* Left: Task Bank */}
            <div className="task-bank">
              <div className="task-bank-header">
                <span>任務庫</span>
              </div>
              <div className="task-bank-tree">
                {currentScenePreset.modules!.map((mod) => (
                  <div key={mod.id} className="module-group">
                    <div
                      className={`module-header ${expandedModuleIds.has(mod.id) ? 'expanded' : ''}`}
                      onClick={() => toggleModuleExpansion(mod.id)}
                    >
                      <span className="module-icon">{mod.icon || '📁'}</span>
                      <span className="module-label">{mod.label}</span>
                      <span className="module-arrow material-symbols-outlined">
                        {expandedModuleIds.has(mod.id) ? 'expand_less' : 'expand_more'}
                      </span>
                    </div>
                    {expandedModuleIds.has(mod.id) && (
                      <div className="module-tasks">
                        {mod.tasks.map((task) => {
                          const isSelected = selectedTasks.some(t => t.id === task.id);
                          return (
                            <button
                              key={task.id}
                              className={`task-select-btn ${isSelected ? 'selected' : ''}`}
                              onClick={() => toggleTaskSelection(task.id, task.label)}
                              disabled={!isSelected && selectedTasks.length >= 7}
                            >
                              <div className="btn-check">
                                {isSelected && <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>check</span>}
                              </div>
                              <span className="btn-label">{task.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Selected task list + clear */}
            <div className="active-tasks">
              <div className="active-tasks-header">
                <span>已選任務</span>
                <span className={`task-count ${selectedTasks.length >= 7 ? 'limit' : ''}`}>{selectedTasks.length}/7</span>
              </div>
              {selectedTasks.length === 0 ? (
                <div className="active-tasks-empty">
                  從左側任務庫點選，<br />最多 7 項
                </div>
              ) : (
                <div className="active-tasks-list">
                  {selectedTasks.map((task, idx) => (
                    <div
                      key={`${task.id}-${idx}`}
                      className={`active-task-row ${task.completed ? 'completed' : ''} ${dropIndicator?.index === idx ? `drop-${dropIndicator.position}` : ''}`}
                      draggable
                      onDragStart={() => handleTaskDragStart(idx)}
                      onDragOver={(e) => handleTaskDragOver(e, idx)}
                      onDrop={(e) => handleTaskDrop(e, idx)}
                      onDragEnd={handleTaskDragEnd}
                    >
                      <div className="task-index">{idx + 1}</div>
                      <div className="task-info">
                        <span className="task-label">{task.label}</span>
                      </div>
                      <button
                        className="task-remove-btn"
                        title="移除此任務"
                        onClick={() => toggleTaskSelection(task.id, task.label)}
                      >
                        <span className="material-symbols-outlined">close</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {selectedTasks.length > 0 && (
                <button className="clear-tasks-btn" onClick={() => { setSelectedTasks([]); broadcastTaskChange([]); }}>
                  <span className="material-symbols-outlined">delete_sweep</span>
                  清空所有任務
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={showRemoveConfirm}
        title="移出教室"
        description={`確定要將「${studentToRemove || ''}」移出教室嗎？`}
        confirmText="確定"
        cancelText="取消"
        onConfirm={confirmRemoveStudent}
        onCancel={cancelRemoveStudent}
      />

      {/* 離開課堂確認 modal */}
      <ConfirmationModal
        isOpen={showExitConfirm}
        title="離開課堂"
        description={`確定要離開課堂並返回首頁嗎？`}
        confirmText="確定"
        cancelText="取消"
        onConfirm={() => { sessionStorage.clear(); window.location.href = '/'; }}
        onCancel={() => setShowExitConfirm(false)}
      />
    </div>
  );
}
