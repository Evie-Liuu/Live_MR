import React, { useEffect, useState, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
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
import {
  LIVEKIT_URL, BIGSCREEN_CHANNEL_NAME, MIC_AUDIO_OPTIONS, MAX_POSE_PUBLISHERS, POSE_PUBLISHERS_RESEND_MS,
  SCRIPT_TURN_RESEND_MS,
} from '../config/constants.ts';
import { createPoseDecodePool } from '../utils/poseCodec.ts';
import type { PoseDecodePool } from '../utils/poseCodec.ts';
import { HINT_LEVELS, hintLevelMeta } from '../config/taskHints.ts';
import type { HintLevel, TaskHint } from '../config/taskHints.ts';
import { shuffleWords, buildHintsSystemInstruction } from '../config/aiAssistant.ts';
import type { AIHintMode, AIHintPayload, ChatTurn, CachedReplies, HintTaskContext } from '../config/aiAssistant.ts';
import { resolveModules, resolveTaskHint, resolveSceneConstraint } from '../config/content.ts';
import { getLessonPlan } from '../utils/lessonPlanClient.ts';
import type { LessonPlanRecord } from '../types/lessonPlan.ts';
import { passThroughGate } from '../config/transcriptGate.ts';
import type { TranscriptGate } from '../config/transcriptGate.ts';
import { generateHints, toFriendlyError, warmupGemini, type TokenUsage } from '../utils/geminiClient.ts';
import { useSpeechRecording } from '../hooks/useSpeechRecording.ts';
import { useTurnAudioRecorder, type TurnAudio } from '../hooks/useTurnAudioRecorder';
import { useRecording } from '../hooks/useRecording.ts';
import RecordingPanel from './RecordingPanel.tsx';
import { subscribeToRoomEvents, approveRequest, rejectRequest, removeParticipant } from '../api.ts';
import type { RoomEvent as ApiRoomEvent } from '../api.ts';
import SceneEditor from './SceneEditor.tsx';
import SceneOccludersPanel from './SceneOccludersPanel.tsx';
import ConfirmationModal from './ConfirmationModal.tsx';
import TaskBankDrawer from './TaskBankDrawer.tsx';
import LessonTaskDrawer from './LessonTaskDrawer.tsx';
import CheckpointHostPanel from './CheckpointHostPanel.tsx';
import AiAssistantPanel, { type InteractionPhase } from './AiAssistantPanel.tsx';
import ScriptTurnHostPanel, { type SpeakerStatus } from './ScriptTurnHostPanel.tsx';
import { MAX_HINT_LEVEL, type HintLevel as TurnHintLevel, type TurnHintMode } from '../utils/turnHints.ts';
import {
  advanceTurn, backTurn, jumpTurn, resolveTurn, restartTurnIfActive, setTurnPaused, startTurn, stepCastLines,
  BIGSCREEN_TURN_STORAGE_KEY, type ScriptTurn, type ScriptTurnState, type TurnCast,
} from '../utils/scriptTurn.ts';
import {
  BIGSCREEN_CHECKPOINT_STORAGE_KEY, type CheckpointCast, defaultShowQuestionText, loadHostPoll, recordAnswer, saveHostPoll, setPollStatus, startPoll,
  toggleQuestionText, toScreenPoll, toStudentPoll,
  type CheckpointPoll,
} from '../utils/checkpointPoll.ts';
import { getDialogueTask } from '../utils/dialogueTaskClient.ts';
import { castChoices, createId, type AudienceCheckpoint, type DialogueTaskRecord } from '../types/dialogueTask.ts';
import {
  BIGSCREEN_LESSON_STORAGE_KEY, clampDoneCount, currentStepIndex, isLessonDone, loadHostLesson, saveHostLesson,
  lessonTask, setLessonPhase, setQuestionIndex, taskCast, toggleStepDone, toLessonScreen,
  type HostLessonState,
} from '../utils/lessonSession.ts';
import { LESSON_PHASES, phaseContent, phaseMeta, type LessonPhase } from '../config/lessonPhases.ts';
import type { SceneOccluderInstance } from '../types/sceneOccluder.ts';
import { useAuth } from '../hooks/useAuth';

// 上課中快速進入備課中心（疊在課堂上方，課堂與連線保持進行）
const LessonPrep = lazy(() => import('./LessonPrep.tsx'));

// ─── Module-level constants & types ─────────────────────────────────────────

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

/** 場景 slot id → 角色名稱 */
function slotLabelsFor(sceneId: string): Record<string, string> {
  return Object.fromEntries((SCENE_PRESETS[sceneId]?.slots ?? []).map(s => [s.id, s.label]));
}

// ─── Types ──────────────────────────────────────────────────────────────────
interface HostSessionProps {
  roomId: string;
  livekitToken: string;
  hostToken: string;
  planId?: string;
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

function CustomSelect({ value, options, onChange, disabled }: CustomSelectProps) {
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
        if (!navigator?.mediaDevices?.enumerateDevices) return;
        let probeStream: MediaStream | null = null;
        try {
          const all = await navigator.mediaDevices.enumerateDevices();
          const hasLabels = all.some((d) => d.kind === 'videoinput' && d.label);
          if (!hasLabels && navigator.mediaDevices.getUserMedia) {
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
    navigator?.mediaDevices?.addEventListener?.('devicechange', refresh);
    return () => {
      cancelled = true;
      navigator?.mediaDevices?.removeEventListener?.('devicechange', refresh);
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
export default function HostSession({ roomId, livekitToken, hostToken, planId }: HostSessionProps) {
  const [participants, setParticipants] = useState<Map<string, ParticipantInfo>>(new Map());
  const [connectedRoom, setConnectedRoom] = useState<Room | null>(null);
  // true once the local camera track has been attached (LiveKit setCameraEnabled resolved)
  const [cameraReady, setCameraReady] = useState(false);
  // true once the hidden <video> has actually rendered a frame — only then is
  // the camera truly "live"。loading overlay 必須等到此旗標為 true 才能消失,
  // 否則畫面已露出但鏡頭其實還在連接、第一張影像尚未進來。
  const [cameraStreaming, setCameraStreaming] = useState(false);
  // LiveKit 連線失敗訊息（例如重整時伺服器暫時連不上）；非 null 時 overlay 改顯示重試 / 結束課程
  const [connectError, setConnectError] = useState<string | null>(null);
  const roomRef = useRef<Room | null>(null);
  // Set participant display name from logged-in user
  const { user, logout } = useAuth();
  useEffect(() => {
    if (connectedRoom && user) {
      // Update LiveKit participant name for UI consistency
      // Requires canUpdateOwnMetadata permission in the token
      const name = user.full_name || user.email || (typeof user.id === 'string' ? user.id : user.uid) || "";
      void connectedRoom.localParticipant.setName(name);
    }
  }, [connectedRoom, user]);
  const [teacherPoseData, setTeacherPoseData] = useState<PoseFrame | null>(null);
  const [faceEnabled, setFaceEnabled] = useState(true);
  const [handEnabled] = useState(faceEnabled);
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
  const [aiModel, setAiModel] = useState<string | null>(null);
  // dev:目前這次 AI 呼叫的 token 用量 + 自頁面載入以來的累計 total（用量檢視）
  const [aiUsage, setAiUsage] = useState<TokenUsage | null>(null);
  const [aiCumulativeTokens, setAiCumulativeTokens] = useState(0);
  const aiCumulativeTokensRef = useRef(0);
  const transcriptGateRef = useRef<TranscriptGate>(passThroughGate);
  const chatHistoryRef = useRef<ChatTurn[]>([]);
  const resetChatHistory = useCallback(() => {
    chatHistoryRef.current = [];
  }, []);
  const cachedRepliesRef = useRef<CachedReplies | null>(null);
  const cachedSourceTextRef = useRef<string | null>(null);
  const cachedTranscriptRef = useRef<string | null>(null);
  const [detectedQuestion, setDetectedQuestion] = useState<string>('');  // dev:AI 從長獨白抽取的主問句,顯示於 hint card 下方
  const resetCachedReplies = useCallback(() => {
    cachedRepliesRef.current = null;
    cachedSourceTextRef.current = null;
    cachedTranscriptRef.current = null;
    setDetectedQuestion('');
  }, []);
  const [countdown, setCountdown] = useState<number | null>(null);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [recordDuration, setRecordDuration] = useState(0);
  // ── 開始互動自動腳本（固定 15 秒）─────────────────────────────
  const [interactionPhase, setInteractionPhase] = useState<InteractionPhase>('idle');
  // 大屏是否處於編輯模式(由 BroadcastChannel 'edit-mode' 訊息同步,與開始互動互斥)
  const [bigScreenEditing, setBigScreenEditing] = useState(false);
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
  // 進入 teacher 階段即開始 per-turn 音訊錄製（涵蓋 startInteraction / takeover / 重試）
  useEffect(() => {
    if (interactionPhase === 'teacher') {
      const armed = turnAudioRef.current.start();
      if (!armed) console.warn('[host] 本輪音訊未啟動(無麥克風 track / 不支援),將回退 Web Speech 文字流');
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
  // Panel drawer open states
  const [showScenePanel, setShowScenePanel] = useState(false);
  const [showSlotPanel, setShowSlotPanel] = useState(false);
  const [sceneEditorGroupId, setSceneEditorGroupId] = useState<string | null>(null);
  const [showTaskPanel, setShowTaskPanel] = useState(false);
  const [showPendingPanel, setShowPendingPanel] = useState(false);
  const [showOccludersPanel, setShowOccludersPanel] = useState(false);
  const [showLessonPanel, setShowLessonPanel] = useState(false);
  const [pending, setPending] = useState<PendingStudent[]>([]);
  // Settlement modal (shown when allDone)
  const [showSettlement, setShowSettlement] = useState(false);
  const [settlementTab, setSettlementTab] = useState<'tasks' | 'steps'>('tasks');
  const [showUserMenu, setShowUserMenu] = useState(false);
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
  const [bigScreenMenuOpen, setBigScreenMenuOpen] = useState(false);

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
    } else if (event.type === 'request-approved' || event.type === 'request-rejected' || event.type === 'request-cancelled') {
      // Remove from pending when replayed on reconnect (avoids join/pending overlap)；
      // request-cancelled：學生離開等待頁
      setPending((prev) => prev.filter((s) => s.requestId !== (event.requestId as string)));
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToRoomEvents(roomId, hostToken, handleApiEvent);
    return unsubscribe;
  }, [roomId, hostToken, handleApiEvent]);

  const handleApprove = async (requestId: string) => {
    try {
      await approveRequest(roomId, requestId, hostToken);
      setPending((prev) => prev.filter((s) => s.requestId !== requestId));
    } catch {
      // ignore
    }
  };

  const handleReject = async (requestId: string) => {
    try {
      await rejectRequest(roomId, requestId, hostToken);
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
      await removeParticipant(roomId, hostToken, studentToRemove);
    } catch (err) {
      console.error('Failed to remove participant:', err);
      window.alert('移出失敗，請稍後再試');
    } finally {
      setShowRemoveConfirm(false);
      setStudentToRemove(null);
    }
  }, [roomId, hostToken, studentToRemove]);

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

  // ─── Dev-only: test audio playback ────────────────────────────────────────
  // NOTE: 對應的「▶ 測試音檔」按鈕已註解保留（見 JSX）。此功能定義一併註解保留，
  // 避免 tsc 報未使用錯誤；待測試音檔流程重新啟用時連同按鈕一起解除註解。
  // const testAudioRef = useRef<HTMLAudioElement | null>(null);
  // const handleToggleTestAudio = useCallback(() => {
  //   let el = testAudioRef.current;
  //   if (!el) {
  //     el = new Audio('/voice/Teacher_chat_test.mp3');
  //     testAudioRef.current = el;
  //   }
  //   if (el.paused) {
  //     el.currentTime = 0;
  //     void el.play();
  //   } else {
  //     el.pause();
  //   }
  // }, []);
  // useEffect(() => () => {
  //   try { testAudioRef.current?.pause(); } catch { /* ignore */ }
  //   testAudioRef.current = null;
  // }, []);

  // ─── Scene / VRM source selection ─────────────────────────────────────────
  const [selectedSceneId, setSelectedSceneId] = useState<string>(
    () => sessionStorage.getItem('bigscreen-sceneId') ?? DEFAULT_SCENE_ID,
  );

  // ─── 導師任務管理：上課用的對話任務（我的任務）與目前步驟 ─────────────
  const [lesson, setLesson] = useState<HostLessonState | null>(loadHostLesson);
  const lessonAllDone = lesson ? isLessonDone(lesson) : false;
  // 逐句演練：目前這一輪（由 lesson.turn 推導，見下方 scriptTurn）；data 事件用 ref 讀
  const scriptTurnRef = useRef<ScriptTurn | null>(null);
  /** 發言者的即時逐字稿（seq 對應目前這一輪） */
  const [turnTranscript, setTurnTranscript] = useState<{ seq: number; text: string } | null>(null);
  /** 發言者 iPad 回報的提示等級（seq 對應目前這一輪） */
  const [turnHint, setTurnHint] = useState<{ seq: number; level: TurnHintLevel; by: 'auto' | 'teacher' } | null>(null);
  /** 結束演練後保留最後的 seq，重新開始時接著加，舊的「說完了」不會誤觸 */
  const lastTurnSeqRef = useRef(0);

  // ─── 台下互動點：發布到學生裝置作答，大屏顯示統計（狀態只存在教師端）──────────
  const [checkpointPoll, setCheckpointPoll] = useState<CheckpointPoll | null>(loadHostPoll);
  const checkpointPollRef = useRef(checkpointPoll);
  useEffect(() => {
    checkpointPollRef.current = checkpointPoll;
    saveHostPoll(checkpointPoll);
  }, [checkpointPoll]);

  // ─── 備課教案（可選）────────────────────────────────────────────────────
  const [lessonPlan, setLessonPlan] = useState<LessonPlanRecord | null>(null);
  const [lessonPlanNotice, setLessonPlanNotice] = useState<string | null>(null);
  // handleSceneChange 定義在檔案後段（以 useCallback），此處先用 ref 保存最新版本，
  // 避免教案載入 effect 必須等到 handleSceneChange 宣告之後才能撰寫。
  const handleSceneChangeRef = useRef<(sceneId: string) => void>(() => { });
  useEffect(() => {
    if (!planId) return;
    let cancelled = false;
    getLessonPlan(planId)
      .then(rec => {
        if (cancelled) return;
        setLessonPlan(rec);
        if (rec.plan.sceneId !== selectedSceneId) {
          if (SCENE_PRESETS[rec.plan.sceneId]) handleSceneChangeRef.current(rec.plan.sceneId);
          else setLessonPlanNotice('此教案的場景已移除，僅能使用靜態任務');
        }
      })
      .catch(err => {
        if (cancelled) return;
        setLessonPlanNotice(err instanceof Error && err.message === 'not-found' ? '教案已被刪除，改用無教案模式' : '教案載入失敗，改用無教案模式');
      });
    return () => { cancelled = true; };
    // 只在掛載時載入一次；handleSceneChange 透過 ref 讀取最新版本，不需列入依賴
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);
  const sceneConstraint = useMemo(
    () => resolveSceneConstraint(selectedSceneId, lessonPlan?.plan),
    [selectedSceneId, lessonPlan],
  );

  // ─── 場景遮罩物件(occluders) — per-scene 編輯狀態 ──────────────────────
  const OCCLUDERS_STORAGE_KEY = 'bigscreen-scene-occluders';
  const readOccludersForScene = useCallback((sceneId: string): SceneOccluderInstance[] => {
    try {
      const all = JSON.parse(localStorage.getItem(OCCLUDERS_STORAGE_KEY) || '{}') as Record<string, SceneOccluderInstance[]>;
      const list = all[sceneId];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }, []);
  const writeOccludersForScene = useCallback((sceneId: string, list: SceneOccluderInstance[]) => {
    try {
      const all = JSON.parse(localStorage.getItem(OCCLUDERS_STORAGE_KEY) || '{}') as Record<string, SceneOccluderInstance[]>;
      all[sceneId] = list;
      localStorage.setItem(OCCLUDERS_STORAGE_KEY, JSON.stringify(all));
    } catch (e) {
      console.warn('[HostSession] save occluders failed:', e);
    }
  }, []);
  const [occluderInstances, setOccluderInstances] = useState<SceneOccluderInstance[]>(
    () => readOccludersForScene(sessionStorage.getItem('bigscreen-sceneId') ?? DEFAULT_SCENE_ID),
  );
  /** drawer 編輯 callback — 寫 localStorage 並廣播給 BigScreen。 */
  const handleOccludersChange = useCallback((next: SceneOccluderInstance[]) => {
    setOccluderInstances(next);
    writeOccludersForScene(selectedSceneId, next);
    const msg: BigScreenMsg = { type: 'occluders-set', occluders: next };
    channelRef.current?.postMessage(msg);
  }, [selectedSceneId, writeOccludersForScene]);
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
  // startLesson 讀最新的角色指定，不必把 slotAssignments 放進依賴
  const slotAssignmentsRef = useRef(slotAssignments);
  useEffect(() => { slotAssignmentsRef.current = slotAssignments; }, [slotAssignments]);

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
    hostToken,
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
    const tasksDone = selectedTasks.length > 0 && selectedTasks.every(t => t.completed);
    // 課程管理：所有步驟完成時，大屏同樣跳出完成視窗並停止它的錄影
    const allDone = tasksDone || lessonAllDone;
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
  }, [selectedTasks, isRecording, lessonAllDone]);

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

  // 取老師當前 LiveKit 本地麥克風 track（與既有 camera track 取法同 pattern）
  const getMicTrack = useCallback((): MediaStreamTrack | null => {
    const pub = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Microphone);
    return pub?.track?.mediaStreamTrack ?? null;
  }, []);
  const turnAudio = useTurnAudioRecorder(getMicTrack);
  const turnAudioRef = useRef(turnAudio);
  useEffect(() => { turnAudioRef.current = turnAudio; }, [turnAudio]);
  // dev 顯示 Gemini 轉譯
  // getter 暫不使用（「🎧 Gemini 聽到」顯示已停用）；保留 setter 以便日後重新啟用。
  const [, setHeardTranscript] = useState('');

  // `overrideText` 讓呼叫端（如老師講完的收尾 callback）直接帶入最終 transcript，
  // 不必倚賴 `sttTranscript` 狀態已更新（空結果時它根本不會變）。
  const handleHint = useCallback(async (mode: AIHintMode, overrideText?: string, audio?: TurnAudio) => {
    cancelAutoCountdown();
    if (aiBusy) return;

    const txt = (overrideText ?? sttTranscript).trim();

    // ── Cache-first path: 同一段 transcript 只換 mode/重播，不重新呼叫 AI。
    // 以 cachedTranscriptRef 比對確保「新 transcript」一定走冷路徑重新生成。
    if (!audio && cachedRepliesRef.current && cachedTranscriptRef.current === txt) {
      const cached = cachedRepliesRef.current;
      const content = mode === 'complete' ? cached.complete
        : mode === 'extend' ? cached.extend
          : cached.rearrange;
      if (content) {
        const payload: AIHintPayload = {
          mode,
          content,
          sourceText: cachedSourceTextRef.current || txt,
          ts: Date.now()
        };
        setLatestHint(payload);
        broadcastAIHint(payload);
        return;
      }
    }

    if (!audio && txt.length < 3) return;
    if (!audio && !transcriptGateRef.current.accept(txt, { sceneId: selectedSceneId, source: 'button' })) return;
    const constraint = sceneConstraint;
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
        currentTargetSentence: currentTask ? resolveTaskHint(currentTask.id, lessonPlan?.plan)?.completeSentence : undefined,
        nextTaskLabel: nextTask?.label,
        nextTargetSentence: nextTask ? resolveTaskHint(nextTask.id, lessonPlan?.plan)?.completeSentence : undefined,
      };
      const systemInstruction = buildHintsSystemInstruction(constraint, taskContext, audio ? 'audio' : 'text');
      const history = chatHistoryRef.current;
      const result = await generateHints(audio ? '' : txt, { history, systemInstruction, audio });
      setAiModel(result.model);
      // dev 用量：紀錄本次 token 用量並累加 session 累計（僅冷路徑會真的呼叫 AI）。
      if (result.usage) {
        setAiUsage(result.usage);
        aiCumulativeTokensRef.current += result.usage.total;
        setAiCumulativeTokens(aiCumulativeTokensRef.current);
      }
      // 音訊模式：以 Gemini 回傳的 transcript 當有效文字；文字模式沿用 txt。
      const effectiveTxt = audio ? (result.transcript || result.question || txt) : txt;
      setHeardTranscript(audio ? result.transcript : '');
      console.log('[hint] input:', audio ? '(audio)' : txt);
      console.log('[hint] heard transcript:', result.transcript);
      console.log('[hint] extracted question:', result.question);
      setDetectedQuestion(result.question || '');
      // BigScreen 氣泡 / 後續 sourceText 顯示「老師實際問的那句」而非整段長獨白。
      const sourceText = result.question || effectiveTxt;
      const cached: CachedReplies = {
        complete: result.complete,
        rearrange: shuffleWords(result.complete),
        extend: result.extend || result.complete,
      };
      cachedRepliesRef.current = cached;
      cachedSourceTextRef.current = sourceText;
      cachedTranscriptRef.current = effectiveTxt;   // 失效比較用：保留原始整段 transcript
      // simulate 會把 <3 字/填充詞的輸入清成空字串,那會讓 transcript effect 誤清掉剛建的 cache;
      // 僅在文字夠長時才反映進 STT 顯示,維持 cachedTranscriptRef === sttTranscript 不變式。
      if (audio && effectiveTxt.trim().length >= 3) {
        simulateTranscript(effectiveTxt);
      }
      // Append ONCE per transcript: the canonical student utterance is `complete`.
      // 對話輪替會無上限累積；只保留最近 MAX_CHAT_TURNS 筆，避免長課堂中 history
      // 無限成長（記憶體耗盡），同時控制每次送往 Gemini 的 token 量。
      // chat history 的 user turn 記「抽取問句」(question 空則 fallback 原長 txt)，
      // 讓多輪續寫上下文乾淨、token 更省。
      chatHistoryRef.current = [
        ...history,
        { role: 'user' as const, text: result.question || effectiveTxt },
        { role: 'model' as const, text: result.complete },
      ].slice(-MAX_CHAT_TURNS);
      const content = mode === 'complete' ? cached.complete
        : mode === 'extend' ? cached.extend
          : cached.rearrange;
      const payload: AIHintPayload = { mode, content, sourceText, ts: Date.now() };
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
  }, [aiBusy, sttTranscript, selectedSceneId, selectedTasks, studentRoles, cancelAutoCountdown, broadcastAIHint, startRec, simulateTranscript, sceneConstraint, lessonPlan]);

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

  const endInteraction = useCallback(() => {
    autoScriptTriggerRef.current = false;
    // Use ref so this callback stays stable and doesn't change every time
    // sttRecording flips — prevents the unmount-cleanup effect from firing
    // endInteraction (and resetting phase to 'idle') on every recording toggle.
    if (sttRecordingRef.current) {
      try { stopRec(); } catch { /* ignore */ }
    }
    // 停止 per-turn 音訊錄製（若仍在錄），避免結束互動後 recorder 仍掛在麥克風 track 上。
    void turnAudioRef.current.stop();
    setInteractionPhase('idle');
  }, [stopRec]);

  const startInteraction = useCallback(() => {
    if (!sttSupported || !sceneConstraint) return;
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
  }, [sttSupported, sceneConstraint, sttRecording, aiBusy, cancelAutoCountdown, resetChatHistory, resetCachedReplies, clearTranscript, startRec]);

  const handleTeacherDone = useCallback(() => {
    if (interactionPhaseRef.current !== 'teacher') return;
    if (aiBusy) {
      setAiError('上一輪 AI 仍在生成中，請稍候');
      return;
    }
    setInteractionPhase('generating');

    // 老師講完後直接以「最終 transcript」事件驅動生成，不倚賴 sttTranscript 狀態變化：
    // 收音為空時 setTranscript('') 不會觸發任何 effect，舊版會永遠卡在 'generating'。
    const finish = async (finalText: string) => {
      const txt = finalText.trim();
      const audio = await turnAudioRef.current.stop();  // TurnAudio | null
      if (!audio && txt.length < 3) {
        // 沒收到有效語音 → 明確提示並回到老師階段重新收音，而非無聲卡死。
        setAiError('未偵測到語音，請再試一次');
        setInteractionPhase('teacher');
        if (!sttRecordingRef.current) {
          try { startRec(); } catch { /* ignore */ }
        }
        return;
      }
      setInteractionPhase('student');
      // 音訊優先；無音訊時帶 Web Speech 文字走回退。
      void handleHintRef.current('rearrange', txt, audio ?? undefined);
    };

    if (sttRecordingRef.current) {
      stopRec(finish);
    } else {
      finish(sttTranscript.trim());
    }
  }, [aiBusy, stopRec, startRec, sttTranscript]);

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
      return
      if (e.code !== 'Space' || e.repeat) return;
      // 不攔截輸入框內的空白鍵
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) return;
      // 場景尚無 AI 約束 或 不支援 STT 時不動作
      if (!sttSupported || !resolveSceneConstraint(spacebarSceneIdRef.current, lessonPlan?.plan)) return;
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
      return
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
  }, [sttSupported, cancelAutoCountdown, clearTranscript, startRec, stopRec, lessonPlan]);

  // transcript 更新時：空白鍵模式 → 立即送出；按鈕模式 → 3 秒倒數後送出
  useEffect(() => {
    // 逐句演練中老師演角色的收音只用來顯示逐字稿，不送 AI
    if (scriptTurnRef.current) return;
    // 新 transcript 進來 → 失效舊 cache（即使 transcript 太短也要清，避免殘留）
    if (cachedTranscriptRef.current !== null && cachedTranscriptRef.current !== sttTranscript.trim()) {
      cachedRepliesRef.current = null;
      cachedSourceTextRef.current = null;
      cachedTranscriptRef.current = null;
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
    if (!sceneConstraint) return;

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
  }, [sttTranscript, sceneConstraint]);

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
      // 課程任務綁定場景：換到別的場景就結束目前課程
      setLesson(prev => (prev && prev.record.task.sceneId !== sceneId ? null : prev));
      const taskClearMsg: BigScreenMsg = { type: 'task-change', tasks: [] };
      channelRef.current?.postMessage(taskClearMsg);
      // 切到新場景時:讀該場景的遮罩物件清單並廣播。BigScreen 端在 'scene-change'
      // 後也會從 localStorage 重讀,這裡額外廣播是為了避免 race。
      const nextOccluders = readOccludersForScene(sceneId);
      setOccluderInstances(nextOccluders);
      const occMsg: BigScreenMsg = { type: 'occluders-set', occluders: nextOccluders };
      channelRef.current?.postMessage(occMsg);
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
    [broadcastSceneChange, broadcastTeacherVrmChange, broadcastVrmChange, cancelAutoCountdown, endInteraction, clearTranscript, resetChatHistory, resetCachedReplies, broadcastAIHint, readOccludersForScene],
  );

  // handleSceneChange 定義在教案載入 effect 之後才出現（此 effect 需要在 selectedSceneId
  // 之後、但在 handleSceneChange 定義之前宣告，才能讓下方多處 sceneConstraint 的用法編譯通過），
  // 因此改用 ref 讓教案載入 effect 能呼叫到目前最新的 handleSceneChange。
  useEffect(() => { handleSceneChangeRef.current = handleSceneChange; }, [handleSceneChange]);

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

  // ── 姿勢發布名單：全班都發布鏡頭與麥克風，只有被指定角色的學生（最多 MAX_POSE_PUBLISHERS 人）
  //    跑姿勢偵測並送出姿勢資料，降低學生裝置、網路與大屏的負擔 ─────────────────────
  const posePublishers = useMemo(() => {
    const teacherIdentity = connectedRoom?.localParticipant.identity;
    return [...new Set(Object.values(slotAssignments))]
      .filter(id => id && id !== teacherIdentity)
      .sort()
      .slice(0, MAX_POSE_PUBLISHERS);
  }, [slotAssignments, connectedRoom]);
  const posePublishersRef = useRef(posePublishers);
  useEffect(() => { posePublishersRef.current = posePublishers; }, [posePublishers]);
  /** 送出名單；指定 destinations 時只送給這些學生（例如剛加入的人） */
  const sendPosePublishers = useCallback((destinations?: string[]) => {
    const room = roomRef.current;
    if (!room || room.state !== 'connected') return;
    try {
      const bytes = new TextEncoder().encode(
        JSON.stringify({ type: 'pose-publishers', identities: posePublishersRef.current }),
      );
      void room.localParticipant
        .publishData(bytes, { reliable: true, ...(destinations ? { destinationIdentities: destinations } : {}) })
        .catch(() => { /* ignore */ });
    } catch { /* ignore */ }
  }, []);
  /** 把目前的互動點（公布前不含答案）送給學生；指定 destinations 時只送給這些學生 */
  const sendCheckpoint = useCallback((destinations?: string[]) => {
    const room = roomRef.current;
    if (!room || room.state !== 'connected') return;
    const p = checkpointPollRef.current;
    try {
      const bytes = new TextEncoder().encode(JSON.stringify({ type: 'checkpoint', poll: p ? toStudentPoll(p) : null }));
      void room.localParticipant
        .publishData(bytes, { reliable: true, ...(destinations ? { destinationIdentities: destinations } : {}) })
        .catch(() => { /* ignore */ });
    } catch { /* ignore */ }
  }, []);
  // 題目或狀態改變時立即送出；進行中定期重送（晚加入、重連或漏收的學生也會看到題目）
  const checkpointStudentKey = checkpointPoll
    ? `${checkpointPoll.pollId}:${checkpointPoll.status}:${checkpointPoll.showQuestionText ?? true}`
    : '';
  useEffect(() => {
    if (!connectedRoom) return;
    sendCheckpoint();
    if (!checkpointStudentKey) return;
    const timer = window.setInterval(() => sendCheckpoint(), POSE_PUBLISHERS_RESEND_MS);
    return () => window.clearInterval(timer);
  }, [connectedRoom, checkpointStudentKey, sendCheckpoint]);
  const posePublishersKey = posePublishers.join('|');
  // 名單變更時立即廣播，並定期重送（晚加入、重連或漏收的學生也會同步）
  useEffect(() => {
    if (!connectedRoom) return;
    sendPosePublishers();
    const timer = window.setInterval(() => sendPosePublishers(), POSE_PUBLISHERS_RESEND_MS);
    return () => window.clearInterval(timer);
  }, [connectedRoom, posePublishersKey, sendPosePublishers]);

  const handleSlotAssign = useCallback(
    (slotId: string, identity: string | null) => {
      const previousIdentity = slotAssignments[slotId];
      // 同時發布姿勢資料的學生有上限：已滿時不能再指定新的學生（換掉同一個位置不受影響）
      const teacherIdentity = connectedRoom?.localParticipant.identity;
      if (identity && identity !== teacherIdentity && !Object.values(slotAssignments).includes(identity)) {
        const otherStudents = Object.entries(slotAssignments)
          .filter(([sid, id]) => sid !== slotId && id !== teacherIdentity).length;
        if (otherStudents >= MAX_POSE_PUBLISHERS) {
          window.alert(`同時最多 ${MAX_POSE_PUBLISHERS} 位學生扮演角色，請先取消其他學生的角色。`);
          return;
        }
      }
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
          // 從別的角色移過來時，若模型是舊角色自動套用的預設模型，不算老師手動選的，改套新角色的預設
          const fromSlotId = Object.entries(slotAssignments).find(([sid, id]) => id === identity && sid !== slotId)?.[0];
          const fromDefault = fromSlotId ? preset.slots?.find(s => s.id === fromSlotId)?.defaultVrmId : undefined;
          const hasManualOverride = studentRoles[identity] && studentRoles[identity] !== fromDefault;
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
    (taskId: string, label: string, hint?: TaskHint) => {
      setSelectedTasks((prev) => {
        const index = prev.findIndex((t) => t.id === taskId);
        let next: TaskEntry[];
        if (index >= 0) {
          // Remove
          next = prev.filter((t) => t.id !== taskId);
        } else {
          // Add if under limit
          if (prev.length >= 7) return prev;
          next = [...prev, { id: taskId, label, completed: false, ...(hint ? { hint } : {}) }];
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
    // 接收大屏編輯狀態(互斥:大屏編輯中不可開始互動)
    ch.onmessage = (ev: MessageEvent<BigScreenMsg>) => {
      if (ev.data?.type === 'edit-mode') setBigScreenEditing(!!ev.data.editing);
    };
    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, []);

  // 導師任務管理：保存上課狀態，並把目前步驟的情境送到大屏（不含答案）
  useEffect(() => {
    saveHostLesson(lesson);
    const screen = lesson ? toLessonScreen(lesson, slotLabelsFor(selectedSceneId)) : null;
    try {
      if (screen) sessionStorage.setItem(BIGSCREEN_LESSON_STORAGE_KEY, JSON.stringify(screen));
      else sessionStorage.removeItem(BIGSCREEN_LESSON_STORAGE_KEY);
    } catch {/* ignore */ }
    const msg: BigScreenMsg = { type: 'lesson-change', lesson: screen };
    channelRef.current?.postMessage(msg);
  }, [lesson, selectedSceneId]);

  // 選中任務：載入到左側，從任務前（暖身）開始（換任務也是重新開始）
  const startLesson = useCallback((record: DialogueTaskRecord) => {
    setLesson({ record, doneCount: 0, showLines: false, phase: 'pre', questionIndex: 0 });
    setCheckpointPoll(null);
    // 流程：選定任務 → 指定角色。任務需要的角色還有人沒指定時，接著打開角色配置
    const needed = taskCast(record.task).map(c => c.slotId);
    const preset = SCENE_PRESETS[record.task.sceneId];
    if (preset?.slots?.some(slot => needed.includes(slot.id) && !slotAssignmentsRef.current[slot.id])) {
      setShowSlotPanel(true);
    }
  }, []);
  /** 角色配置切換演出人數（完整人數時不存，跟著任務原本的角色） */
  const changeCastSize = useCallback((size: number) => {
    setLesson(prev => {
      if (!prev) return prev;
      const full = castChoices(prev.record.task).at(-1)?.size;
      const next = { ...prev };
      delete next.castSize;
      if (size !== full) next.castSize = size;
      return restartTurnIfActive(next);
    });
  }, []);
  /** 手動切換任務前 / 任務中 / 任務後 */
  const changeLessonPhase = useCallback((phase: LessonPhase) => {
    if (checkpointPoll) return;
    setLesson(prev => (prev && prev.phase !== phase ? restartTurnIfActive(setLessonPhase(prev, phase)) : prev));
  }, [checkpointPoll]);
  /** 任務前 / 任務後：點選要在大螢幕聚焦的提問 */
  const focusLessonQuestion = useCallback((index: number) => {
    if (checkpointPoll) return;
    setLesson(prev => (prev ? setQuestionIndex(prev, index) : prev));
  }, [checkpointPoll]);
  /** 左側步驟點擊：依序完成（點目前步驟 = 完成，點已完成步驟 = 取消） */
  const toggleLessonStep = useCallback((index: number) => {
    if (checkpointPoll) return;
    setLesson(prev => {
      if (!prev) return prev;
      const doneCount = toggleStepDone(prev, index);
      return doneCount === prev.doneCount ? prev : restartTurnIfActive({ ...prev, doneCount });
    });
  }, [checkpointPoll]);
  /** 橫幅的上一步 / 下一步：取消最後完成的步驟 / 完成目前步驟 */
  // const shiftLessonDone = useCallback((delta: number) => {
  //   setLesson(prev => (prev ? { ...prev, doneCount: clampDoneCount(prev, prev.doneCount + delta) } : prev));
  // }, []);
  // const toggleLessonLines = useCallback(() => {
  //   setLesson(prev => (prev ? { ...prev, showLines: !prev.showLines } : prev));
  // }, []);

  const resetAllLessons = useCallback(() => {
    setLesson(prev => (prev ? restartTurnIfActive({ ...prev, doneCount: 0 }) : prev));
  }, []);

  const endLesson = useCallback(() => { setLesson(null); setCheckpointPoll(null); }, []);

  /** 台下互動點：發布 / 結束作答 / 公布答案 / 結束 */
  // 大屏與學生裝置是否顯示題目文字：依任務程度給預設（A1-A2 以上只顯示選項代號），發布後可切換
  const lessonLevel = lesson?.record.task.level;
  const publishCheckpoint = useCallback((stepId: string, checkpoint: AudienceCheckpoint) => {
    setCheckpointPoll(startPoll(checkpoint, stepId, createId('poll'), defaultShowQuestionText(lessonLevel)));
  }, [lessonLevel]);
  const toggleCheckpointQuestionText = useCallback(() => setCheckpointPoll(prev => (prev ? toggleQuestionText(prev) : prev)), []);
  const closeCheckpoint = useCallback(() => setCheckpointPoll(prev => (prev ? setPollStatus(prev, 'closed') : prev)), []);
  const revealCheckpoint = useCallback(() => setCheckpointPoll(prev => (prev ? setPollStatus(prev, 'revealed') : prev)), []);
  const endCheckpoint = useCallback(() => setCheckpointPoll(null), []);

  // ── 上課中進入備課中心：以覆蓋層開啟，HostSession 不卸載，課堂、連線與大屏保持進行 ──
  /** null = 未開啟；taskId 有值時直接編輯該任務 */
  const [prepTarget, setPrepTarget] = useState<{ taskId?: string } | null>(null);
  const openPrep = useCallback((taskId?: string) => {
    setShowLessonPanel(false);
    setPrepTarget({ taskId });
  }, []);
  /** 返回課堂：更新進行中課程的內容（可能剛被編輯），並重新打開任務管理 */
  const closePrep = useCallback(() => {
    setPrepTarget(null);
    setShowLessonPanel(true);
    const activeId = lesson?.record.id;
    if (!activeId) return;
    getDialogueTask(activeId)
      .then(record => setLesson(prev => {
        if (!prev || prev.record.id !== record.id) return prev;
        const next = { ...prev, record };
        return { ...next, doneCount: clampDoneCount(next, prev.doneCount) };
      }))
      .catch(() => { /* 任務已刪除或讀取失敗：保留原本內容 */ });
  }, [lesson?.record.id]);

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

      // 新學生加入 / 重連 → 補送姿勢發布名單（未在名單內的學生不跑姿勢偵測）
      sendPosePublishers([participant.identity]);
      // 進行中的台下互動點也補送
      if (checkpointPollRef.current) sendCheckpoint([participant.identity]);

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
            if (parsed.type === 'checkpoint-answer') {
              setCheckpointPoll(prev => (prev ? recordAnswer(prev, participant.identity, parsed) : prev));
              return;
            }
            if (parsed.type === 'turn-done') {
              // 只接受目前發言者、目前這一輪的回報；重複按、重送、過期的都忽略
              const t = scriptTurnRef.current;
              const seq = parsed.seq;
              if (t && t.status === 'running' && t.seq === seq && t.speaker.identity === participant.identity) {
                setLesson(prev => (prev?.turn && prev.turn.seq === seq ? { ...prev, turn: advanceTurn(prev, prev.turn) } : prev));
              }
              return;
            }
            if (parsed.type === 'turn-hint-level') {
              const t = scriptTurnRef.current;
              const level = parsed.level;
              if (t && t.seq === parsed.seq && t.speaker.identity === participant.identity
                && typeof level === 'number' && level >= 0 && level <= MAX_HINT_LEVEL) {
                setTurnHint({ seq: t.seq, level: Math.round(level) as TurnHintLevel, by: parsed.by === 'teacher' ? 'teacher' : 'auto' });
              }
              return;
            }
            if (parsed.type === 'turn-transcript') {
              const t = scriptTurnRef.current;
              if (t && t.seq === parsed.seq && t.speaker.identity === participant.identity && typeof parsed.text === 'string') {
                setTurnTranscript({ seq: t.seq, text: parsed.text.slice(-300) });
              }
              return;
            }
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
          await room.localParticipant.setMicrophoneEnabled(true, MIC_AUDIO_OPTIONS);
        } catch (err) {
          if (isMounted) console.error('Failed to enable camera/microphone:', err);
        }

        let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
        const markStreaming = () => {
          if (fallbackTimer) {
            clearTimeout(fallbackTimer);
            fallbackTimer = null;
          }
          if (isMounted) setCameraStreaming(true);
        };

        // Attach teacher camera to hidden video for pose detection
        const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        const video = teacherVideoRef.current;
        if (camPub?.track && video) {
          video.srcObject = new MediaStream([camPub.track.mediaStreamTrack]);
          video.play().catch(() => {/* autoplay */ });

          // 等到第一張影像解出來再讓 loading overlay 消失。
          // 支援 rVFC 時使用 rVFC，同時監聽 loadeddata / playing / timeupdate
          type VFC = (cb: () => void) => number;
          const rvfc = (video as unknown as { requestVideoFrameCallback?: VFC }).requestVideoFrameCallback;
          if (typeof rvfc === 'function') {
            rvfc.call(video, markStreaming);
          }
          video.addEventListener('playing', markStreaming, { once: true });
          video.addEventListener('loadeddata', markStreaming, { once: true });
          video.addEventListener('timeupdate', markStreaming, { once: true });

          // 若瀏覽器延遲渲染或鏡頭啟動過久，4 秒後強制解除 overlay，避免卡死
          fallbackTimer = setTimeout(() => {
            markStreaming();
          }, 4000);
        } else if (isMounted) {
          // 沒有 camera track(權限被擋等)就不再等影像，以免 overlay 卡死
          markStreaming();
        }
        // Signal that camera publication finished — overlay text 切到「正在連接影像…」
        if (isMounted) setCameraReady(true);

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
        // 不清掉 live-mr-app-state：暫時性的連線失敗不該讓老師重整後被踢出教室，
        // 改由 overlay 讓老師選擇重試或結束課程。
        setConnectError(err instanceof Error ? err.message : String(err));
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
      setCameraReady(false);
      setCameraStreaming(false);
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
  const openBigScreen = useCallback((mode: 'display' | 'edit' = 'display') => {
    // 已有大屏視窗 → 廣播切換模式指令,不另開視窗
    const existing = bigScreenWindowRef.current;
    if (existing && !existing.closed) {
      const msg: BigScreenMsg = { type: 'edit-mode-set', editing: mode === 'edit' };
      channelRef.current?.postMessage(msg);
      existing.focus();
      return;
    }
    try {
      sessionStorage.setItem('bigscreen-roomId', roomId);
      // 大屏重開時要查錄影狀態（老師專用 API），一起帶上老師權杖
      sessionStorage.setItem('bigscreen-hostToken', hostToken);
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
      const lessonScreen = lesson ? toLessonScreen(lesson, slotLabelsFor(selectedSceneId)) : null;
      if (lessonScreen) sessionStorage.setItem(BIGSCREEN_LESSON_STORAGE_KEY, JSON.stringify(lessonScreen));
      else sessionStorage.removeItem(BIGSCREEN_LESSON_STORAGE_KEY);
    } catch {/* ignore */ }

    const url = `${window.location.origin}/?screen=bigscreen${mode === 'edit' ? '&mode=edit' : ''}`;
    // 兩種模式共用同一視窗名稱:即使 ref 遺失(教師端重整),也只會重用同一個視窗
    const win = window.open(url, 'live-mr-bigscreen', 'width=1280,height=720,menubar=no,toolbar=no');
    bigScreenWindowRef.current = win;
  }, [selectedSceneId, selectedVrmSourceId, teacherVrmSourceId, slotAssignments, selectedTasks, roomId, hostToken, hintEnabled, hintLevel, lesson]);

  useEffect(() => {
    if (!bigScreenMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest('.hs-bigscreen-fab-wrap')) setBigScreenMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [bigScreenMenuOpen]);

  // ─── Embedded BigScreen preview ────────────────────────────────────────────
  // iframe 有獨立的 sessionStorage，透過 BroadcastChannel 補送完整狀態來同步
  const syncBigScreenState = useCallback(() => {
    const ch = channelRef.current;
    if (!ch) return;
    ch.postMessage({ type: 'scene-change', sceneId: selectedSceneId } satisfies BigScreenMsg);
    ch.postMessage({ type: 'task-change', tasks: selectedTasks } satisfies BigScreenMsg);
    ch.postMessage({ type: 'hint-change', hintEnabled, hintLevel } satisfies BigScreenMsg);
    ch.postMessage({
      type: 'lesson-change',
      lesson: lesson ? toLessonScreen(lesson, slotLabelsFor(selectedSceneId)) : null,
    } satisfies BigScreenMsg);
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
  }, [selectedSceneId, selectedTasks, slotAssignments, connectedRoom, teacherVrmSourceId, studentRoles, hintEnabled, hintLevel, cameraBgDeviceId, bgTypeOverride, lesson]);

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

  // 台下互動點 → 大屏：各選項人數、已作答 / 在線人數（公布後才含正確答案）
  const studentIdsKey = studentList.map(s => s.participant.identity).sort().join('|');
  const studentIds = useMemo(() => (studentIdsKey ? studentIdsKey.split('|') : []), [studentIdsKey]);
  useEffect(() => {
    const screen = checkpointPoll ? toScreenPoll(checkpointPoll, studentIds) : null;
    try {
      if (screen) sessionStorage.setItem(BIGSCREEN_CHECKPOINT_STORAGE_KEY, JSON.stringify(screen));
      else sessionStorage.removeItem(BIGSCREEN_CHECKPOINT_STORAGE_KEY);
    } catch { /* ignore */ }
    const msg: BigScreenMsg = { type: 'checkpoint-change', checkpoint: screen };
    channelRef.current?.postMessage(msg);
  }, [checkpointPoll, studentIds]);

  // Derived state: allowed VRMs for current scene
  const currentScenePreset = SCENE_PRESETS[selectedSceneId] || SCENE_PRESETS[DEFAULT_SCENE_ID];

  /** Find which group (if any) contains this slot — used for the slot-card ⚙ shortcut */
  // const groupForSlot = (slotId: string) => {
  //   return currentScenePreset.groups?.find(g =>
  //     g.members.some(m => m.kind === 'slot' && m.id === slotId)
  //   );
  // };
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
  /** 可指派的人員（老師在最前面） */
  const assignableParticipants = [
    ...(teacherIdentity ? [{ identity: teacherIdentity, name: teacherName ? `${teacherName} (老師)` : '老師' }] : []),
    ...studentList.map(info => ({ identity: info.participant.identity, name: info.participant.name || info.participant.identity })),
  ];
  /**
   * 角色配置的「指派給」選項：已經演其他角色的人標出角色名稱，
   * 選了會從原角色移過來（原角色變成未指派）。
   */
  const participantOptionsFor = (slotId: string) => assignableParticipants.map(p => {
    const otherSlotId = Object.entries(slotAssignments).find(([sid, id]) => id === p.identity && sid !== slotId)?.[0];
    const otherLabel = otherSlotId ? currentScenePreset.slots?.find(s => s.id === otherSlotId)?.label ?? otherSlotId : null;
    return {
      value: p.identity,
      label: (
        <div className="custom-select-option-content">
          <span>{p.name}</span>
          {otherLabel && <span className="slot-option-role" title={`目前演「${otherLabel}」，選擇後改演這個角色`}>{otherLabel}</span>}
        </div>
      ),
    };
  });

  const hasSlots = currentScenePreset.slots && currentScenePreset.slots.length > 0;
  // 選定任務後只列出有台詞的角色（依場景 slot 順序）；尚未選任務時列出場景全部角色
  // 依目前演出人數併角後的台詞計算（例如 2 人版時店員B 的台詞算在店員A）
  const castLines = useMemo(
    () => new Map(lesson ? taskCast(lessonTask(lesson)).map(c => [c.slotId, c.lines] as const) : []),
    [lesson],
  );
  /** 任務可選的演出人數（只有一種時不顯示切換） */
  const castOptions = useMemo(() => (lesson ? castChoices(lesson.record.task) : []), [lesson]);
  const castFull = castOptions[castOptions.length - 1]?.size;
  const activeCastSize = lesson?.castSize ?? castFull;
  /** 台下互動題目的角色代號（{customer2}）發布時換成演出者名字，依目前演出人數併角 */
  const checkpointCast = useMemo<CheckpointCast>(() => {
    const names: Record<string, string> = {};
    if (teacherIdentity) names[teacherIdentity] = teacherName || 'Teacher';
    for (const { participant: p } of participants.values()) {
      if (!p.identity.startsWith('host-')) names[p.identity] = p.name || p.identity;
    }
    return {
      slotLabels: Object.fromEntries((currentScenePreset.slots ?? []).map(s => [s.id, s.label])),
      merge: castOptions.find(c => c.size === activeCastSize)?.merge ?? {},
      slotAssignments,
      names,
    };
  }, [teacherIdentity, teacherName, participants, currentScenePreset.slots, castOptions, activeCastSize, slotAssignments]);
  // ── 逐句演練：推導這一輪並廣播給學生與大屏 ──────────────────────────────
  const turnCast = useMemo<TurnCast>(() => ({
    slots: currentScenePreset.slots ?? [],
    slotAssignments,
    names: checkpointCast.names,
  }), [currentScenePreset.slots, slotAssignments, checkpointCast.names]);
  const scriptTurn = useMemo(
    () => (lesson?.turn && lesson.phase === 'during' && !lessonAllDone ? resolveTurn(lesson, lesson.turn, turnCast) : null),
    [lesson, lessonAllDone, turnCast],
  );
  const scriptLines = useMemo(() => (lesson ? stepCastLines(lesson, turnCast) : []), [lesson, turnCast]);
  // 同一句演到一半換了演出者（重新指派角色）：seq + 1，讓舊發言者的「說完了」失效
  const turnSpeakerId = scriptTurn?.speaker.identity ?? null;
  const turnSpeakerRef = useRef<{ seq: number; id: string | null } | null>(null);
  useEffect(() => {
    const prev = turnSpeakerRef.current;
    const seq = scriptTurn?.seq;
    turnSpeakerRef.current = seq === undefined ? null : { seq, id: turnSpeakerId };
    if (!prev || seq === undefined || prev.seq !== seq || prev.id === turnSpeakerId) return;
    setLesson(p => (p?.turn && p.turn.seq === seq ? { ...p, turn: { ...p.turn, seq: seq + 1 } } : p));
  }, [scriptTurn?.seq, turnSpeakerId]);
  const sendScriptTurn = useCallback(() => {
    const room = roomRef.current;
    if (!room || room.state !== 'connected') return;
    try {
      const bytes = new TextEncoder().encode(JSON.stringify({ type: 'script-turn', turn: scriptTurnRef.current }));
      void room.localParticipant.publishData(bytes, { reliable: true }).catch(() => { /* ignore */ });
    } catch { /* ignore */ }
  }, []);
  const scriptTurnKey = scriptTurn ? JSON.stringify(scriptTurn) : '';
  useEffect(() => {
    scriptTurnRef.current = scriptTurn;
    if (scriptTurn) lastTurnSeqRef.current = scriptTurn.seq;
    try {
      if (scriptTurn) sessionStorage.setItem(BIGSCREEN_TURN_STORAGE_KEY, JSON.stringify(scriptTurn));
      else sessionStorage.removeItem(BIGSCREEN_TURN_STORAGE_KEY);
    } catch { /* ignore */ }
    channelRef.current?.postMessage({ type: 'script-turn', scriptTurn } satisfies BigScreenMsg);
    if (!connectedRoom) return;
    sendScriptTurn();
    if (!scriptTurn) return;
    const timer = window.setInterval(() => sendScriptTurn(), SCRIPT_TURN_RESEND_MS);
    return () => window.clearInterval(timer);
    // scriptTurnKey 代表 scriptTurn 的內容；物件本身每次重新推導都會變
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedRoom, scriptTurnKey, sendScriptTurn]);
  // 換句後清掉上一句的逐字稿
  const scriptTurnSeq = scriptTurn?.seq;
  useEffect(() => { setTurnTranscript(null); }, [scriptTurnSeq]);
  const liveTurnTranscript = turnTranscript && turnTranscript.seq === scriptTurnSeq ? turnTranscript.text : '';
  const liveTurnHint = turnHint && turnHint.seq === scriptTurnSeq ? turnHint : null;
  /** 老師手動指定發言者的提示等級（只送給發言者） */
  const giveTurnHint = useCallback((level: TurnHintLevel) => {
    const t = scriptTurnRef.current;
    const room = roomRef.current;
    if (!t?.speaker.identity || t.status !== 'running' || !room || room.state !== 'connected') return;
    if (level < 0 || level > MAX_HINT_LEVEL) return;
    setTurnHint({ seq: t.seq, level, by: 'teacher' });
    try {
      const bytes = new TextEncoder().encode(JSON.stringify({ type: 'turn-hint', seq: t.seq, level }));
      void room.localParticipant.publishData(bytes, { reliable: true, destinationIdentities: [t.speaker.identity] }).catch(() => { /* ignore */ });
    } catch { /* ignore */ }
  }, []);
  const setTurnHintAuto = useCallback((auto: boolean) => {
    setLesson(prev => {
      if (!prev) return prev;
      const next = { ...prev };
      if (auto) next.turnHintAuto = true;
      else delete next.turnHintAuto;
      return next;
    });
  }, []);
  const setTurnHintMode = useCallback((mode: TurnHintMode) => {
    setLesson(prev => {
      if (!prev) return prev;
      const next = { ...prev };
      if (mode === 'full') next.turnHintMode = 'full';
      else delete next.turnHintMode;
      return next;
    });
  }, []);
  useEffect(() => {
    channelRef.current?.postMessage({ type: 'turn-transcript', turnTranscript: liveTurnTranscript } satisfies BigScreenMsg);
  }, [liveTurnTranscript]);

  // 老師演角色時的逐字稿：先隱藏（老師電腦語音辨識 → 送給學生與大屏）。恢復時取消註解，並加回 TURN_TRANSCRIPT_THROTTLE_MS 匯入。
  // // 老師演角色：用老師端語音辨識產生逐字稿並送給學生（不送 AI）
  // const teacherTurn = !!scriptTurn && scriptTurn.status === 'running' && !!teacherIdentity
  //   && scriptTurn.speaker.identity === teacherIdentity;
  // const scriptSttRef = useRef(false);
  // useEffect(() => {
  //   if (!sttSupported) return;
  //   if (teacherTurn && !scriptSttRef.current && !sttRecordingRef.current && interactionPhaseRef.current === 'idle') {
  //     scriptSttRef.current = true;
  //     startRec();
  //   } else if (!teacherTurn && scriptSttRef.current) {
  //     scriptSttRef.current = false;
  //     stopRec(() => clearTranscript());
  //   }
  // }, [teacherTurn, sttSupported, startRec, stopRec, clearTranscript]);
  // const teacherTurnText = teacherTurn ? [sttTranscript, sttInterim].filter(Boolean).join(' ') : '';
  // useEffect(() => {
  //   if (!teacherTurn || scriptTurnSeq === undefined) return;
  //   setTurnTranscript({ seq: scriptTurnSeq, text: teacherTurnText.slice(-300) });
  // }, [teacherTurn, teacherTurnText, scriptTurnSeq]);
  // // 老師的逐字稿節流後送給學生（學生的逐字稿由發言者 iPad 直接送給全體）
  // const transcriptSentAtRef = useRef(0);
  // useEffect(() => {
  //   if (!teacherTurn || scriptTurnSeq === undefined) return;
  //   const send = () => {
  //     transcriptSentAtRef.current = Date.now();
  //     const room = roomRef.current;
  //     if (!room || room.state !== 'connected') return;
  //     try {
  //       const bytes = new TextEncoder().encode(JSON.stringify({
  //         type: 'turn-transcript', seq: scriptTurnSeq, text: teacherTurnText.slice(-300), final: false,
  //       }));
  //       void room.localParticipant.publishData(bytes, { reliable: false }).catch(() => { /* ignore */ });
  //     } catch { /* ignore */ }
  //   };
  //   const wait = TURN_TRANSCRIPT_THROTTLE_MS - (Date.now() - transcriptSentAtRef.current);
  //   if (wait <= 0) { send(); return; }
  //   const timer = window.setTimeout(send, wait);
  //   return () => window.clearTimeout(timer);
  // }, [teacherTurn, teacherTurnText, scriptTurnSeq]);

  const speakerStatus: SpeakerStatus = !scriptTurn?.speaker.identity ? 'unassigned'
    : scriptTurn.speaker.identity === teacherIdentity ? 'teacher'
      : !participants.has(scriptTurn.speaker.identity) ? 'offline'
        : speakingSet.has(scriptTurn.speaker.identity) ? 'speaking' : 'online';
  const scriptBlockedReason = !lesson ? null
    : lesson.phase !== 'during' ? '切到「任務中」才能開始'
      : lessonAllDone ? '所有步驟已完成'
        : interactionPhase !== 'idle' ? 'AI 互動進行中，結束後才能開始'
          : checkpointPoll ? '台下互動題進行中'
            : null;
  const updateTurn = useCallback((fn: (l: HostLessonState, t: ScriptTurnState) => ScriptTurnState) => {
    setLesson(prev => (prev?.turn ? { ...prev, turn: fn(prev, prev.turn) } : prev));
  }, []);
  const startScriptTurn = useCallback(() => {
    setLesson(prev => (prev ? { ...prev, turn: startTurn(prev, prev.turn ?? { lineIndex: 0, seq: lastTurnSeqRef.current, status: 'running' }) } : prev));
  }, []);
  const endScriptTurn = useCallback(() => {
    setLesson(prev => {
      if (!prev?.turn) return prev;
      const next = { ...prev };
      delete next.turn;
      return next;
    });
  }, []);
  /** 本步結束：完成這一步，下一步從第一句開始 */
  const nextStepScriptTurn = useCallback(() => {
    setLesson(prev => (prev?.turn ? restartTurnIfActive({ ...prev, doneCount: clampDoneCount(prev, prev.doneCount + 1) }) : prev));
  }, []);
  // 台下互動題發布時演練自動暫停（學生畫面讓給作答）
  useEffect(() => {
    if (checkpointPoll && lesson?.turn?.status === 'running') updateTurn((_l, t) => setTurnPaused(t, true));
  }, [checkpointPoll, lesson?.turn?.status, updateTurn]);

  const castSlots = useMemo(
    () => (currentScenePreset.slots ?? []).filter(slot => !lesson || castLines.has(slot.id)),
    [currentScenePreset.slots, lesson, castLines],
  );
  const taskBankModules = useMemo(
    () => resolveModules(currentScenePreset.modules ?? [], lessonPlan?.plan, selectedSceneId),
    [currentScenePreset, lessonPlan, selectedSceneId],
  );
  const hasModules = false //taskBankModules.length > 0;
  const SLOT_COLORS = ['#44aaff', '#ff8844', '#aa88ff', '#44ff88'];
  // SceneConfig has no icon — look it up from THEMES SceneVariant
  const currentSceneVariant = THEMES.flatMap(t => t.scenes).find(s => s.id === selectedSceneId);

  // Index of first non-completed task (highlighted in banner)
  const currentTaskIndex = selectedTasks.findIndex(t => !t.completed);

  // Helpers to open exactly one panel at a time
  // 題目發布中（checkpointPoll 進行中）時封鎖所有面板切換，避免誤操作
  const openScene = () => { if (checkpointPoll) return; setShowScenePanel(v => !v); setShowSlotPanel(false); setShowTaskPanel(false); setShowPendingPanel(false); setShowOccludersPanel(false); setShowLessonPanel(false); };
  const openSlot = () => { if (checkpointPoll) return; setShowSlotPanel(v => !v); setShowScenePanel(false); setShowTaskPanel(false); setShowPendingPanel(false); setShowOccludersPanel(false); setShowLessonPanel(false); };
  const openTask = () => { if (checkpointPoll) return; setShowTaskPanel(v => !v); setShowScenePanel(false); setShowSlotPanel(false); setShowPendingPanel(false); setShowOccludersPanel(false); setShowLessonPanel(false); };
  const openPending = () => { if (checkpointPoll) return; setShowPendingPanel(v => !v); setShowScenePanel(false); setShowSlotPanel(false); setShowTaskPanel(false); setShowOccludersPanel(false); setShowLessonPanel(false); };
  const openLesson = () => { if (checkpointPoll) return; setShowLessonPanel(v => !v); setShowScenePanel(false); setShowSlotPanel(false); setShowTaskPanel(false); setShowPendingPanel(false); setShowOccludersPanel(false); };
  const closeAll = () => { setShowScenePanel(false); setShowSlotPanel(false); setShowTaskPanel(false); setShowPendingPanel(false); setShowOccludersPanel(false); setShowLessonPanel(false); setSceneEditorGroupId(null); };

  // 導師任務管理用：老師帳號（與 App 的 teacherUidOf 同規則）與場景角色名稱
  const teacherUid = user
    ? ((typeof user.uid === 'string' && user.uid) || (typeof user.id === 'string' && user.id) || user.email || null)
    : null;
  const lessonStep = lesson ? lesson.record.task.steps[currentStepIndex(lesson)] : undefined;
  const lessonDone = lessonAllDone;
  const lessonPhaseContent = lesson ? phaseContent(lesson.record.task, lesson.phase) : null;
  const lessonQuestion = lesson && lessonPhaseContent ? lessonPhaseContent.questions[lesson.questionIndex] : undefined;

  const handleBrandClick = () => {
    setShowExitConfirm(true);
    // sessionStorage.clear();
    // window.location.href = '/';
  };

  return (
    <div className="host-session">
      {/* Hidden video for teacher pose detection */}
      <video ref={teacherVideoRef} autoPlay playsInline muted style={{ display: 'none' }} aria-hidden="true" />

      {/* ── Loading Overlay ─────────────────────────────────────────────────── */}
      {!cameraStreaming && (
        <div className="hs-loading-overlay" aria-label="載入中">
          <div className="hs-loading-card">
            <div className="hs-loading-logo">
              <img src="/logo.webp" alt="Logo" />
            </div>
            {connectError ? (
              <>
                <div className="hs-loading-text">連線失敗：{connectError}</div>
                <button
                  type="button"
                  className="hs-loading-skip-btn"
                  onClick={() => window.location.reload()}
                >
                  重試
                </button>
                <button
                  type="button"
                  className="hs-loading-skip-btn"
                  onClick={() => { sessionStorage.clear(); window.location.href = '/'; }}
                >
                  結束課程
                </button>
              </>
            ) : (
              <>
                <div className="hs-loading-spinner" aria-hidden="true">
                  <span /><span /><span /><span />
                </div>
                <div className="hs-loading-text">
                  {!connectedRoom ? '正在連線…' : !cameraReady ? '正在啟動鏡頭…' : '正在連接影像…'}
                </div>
              </>
            )}
            {cameraReady && !connectError && (
              <button
                type="button"
                className="hs-loading-skip-btn"
                onClick={() => setCameraStreaming(true)}
              >
                直接進入教室
              </button>
            )}
          </div>
        </div>
      )}

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

          <RecordingPanel isRecording={isRecording} bigScreenEditing={bigScreenEditing} onStart={start} onStop={stop} />

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

          {user && (
            <div className="hs-user-menu-wrap" style={{ position: 'relative' }}>
              <button
                className={`hs-action-btn hs-action--on ${showUserMenu ? 'hs-action--menu-open' : ''}`}
                onClick={() => setShowUserMenu(v => !v)}
                title="帳號選單"
              >
                <span className="material-symbols-outlined hs-badge-btn" style={{ fontSize: '20px' }}>
                  account_circle
                </span>
                <span className="hs-action-label">{user.full_name || user.email}</span>
                <span
                  className="material-symbols-outlined hs-user-arrow"
                  style={{ transition: 'transform 0.2s', transform: showUserMenu ? 'rotate(180deg)' : 'rotate(0deg)' }}
                >
                  keyboard_arrow_down
                </span>
              </button>

              {showUserMenu && (
                <>
                  {/* 點外部關閉 */}
                  <div
                    className="hs-user-menu-backdrop"
                    onClick={() => setShowUserMenu(false)}
                  />
                  <div className="hs-user-dropdown">
                    {/* 帳號資訊 */}
                    <div className="hs-user-info">
                      <span className="material-symbols-outlined hs-user-info-icon">account_circle</span>
                      <div className="hs-user-info-text">
                        {user.full_name && (
                          <span className="hs-user-name">{user.full_name}</span>
                        )}
                        <span className="hs-user-email">{user.email}</span>
                      </div>
                    </div>
                    <div className="hs-user-divider" />
                    {/* 登出 */}
                    <button
                      className="hs-user-menu-item hs-user-logout"
                      onClick={async () => { setShowUserMenu(false); await logout(); }}
                    >
                      <span className="material-symbols-outlined">logout</span>
                      <span>登出</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

        </div>
      </div>

      {/* ── Settlement Modal ──────────────────────────────────────────────────── */}
      {showSettlement && (
        <div className="settlement-backdrop" onClick={() => setShowSettlement(false)}>
          <div className="settlement-modal settlement-modal--resizable" onClick={e => e.stopPropagation()}>
            {/* Close button */}
            <button className="settlement-close" onClick={() => setShowSettlement(false)}>✕</button>

            {/* Header — matches BigScreen style */}
            <div className="bs-settlement-header">
              <div className="bs-settlement-trophy">
                <img src="/images/UI/medal.png" alt="Trophy" />
              </div>
              <div className="bs-settlement-title">情境對話結束</div>
              <div className="bs-settlement-subtitle">
                {lessonDone && lesson
                  ? `${lesson.record.task.title} · 全部步驟完成！`
                  : '所有任務已完成！'}
              </div>
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

              {/* ── Content tab: task list / lesson steps ───────────────────────── */}
              {(() => {
                const hasTasks = selectedTasks.length > 0;
                const hasSteps = !!(lesson && lesson.record.task.steps.length > 0);
                const activeTab = hasTasks && hasSteps
                  ? settlementTab
                  : hasTasks ? 'tasks' : 'steps';

                return (
                  <div className="bs-settlement-col settlement-content-col">
                    {/* Tab buttons — only rendered when both lists exist */}
                    {/* {hasTasks && hasSteps && (
                      <div className="settlement-tab-bar">
                        <button
                          className={`settlement-tab-btn ${activeTab === 'tasks' ? 'active' : ''}`}
                          onClick={() => setSettlementTab('tasks')}
                        >
                          <span className="material-symbols-outlined">task_alt</span>
                          任務清單
                          <span className="settlement-tab-badge">
                            {selectedTasks.filter(t => t.completed).length}/{selectedTasks.length}
                          </span>
                        </button>
                        <button
                          className={`settlement-tab-btn ${activeTab === 'steps' ? 'active' : ''}`}
                          onClick={() => setSettlementTab('steps')}
                        >
                          <span className="material-symbols-outlined">menu_book</span>
                          課程步驟
                          <span className="settlement-tab-badge">
                            {Math.min(lesson!.doneCount, lesson!.record.task.steps.length)}/{lesson!.record.task.steps.length}
                          </span>
                        </button>
                      </div>
                    )} */}

                    {/* Tasks List */}
                    {activeTab === 'tasks' && hasTasks && (
                      <>
                        {!hasSteps && <div className="bs-settlement-col-title">任務清單</div>}
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
                      </>
                    )}

                    {/* Lesson Steps */}
                    {activeTab === 'steps' && hasSteps && lesson && (
                      <>
                        {!hasTasks && (
                          <div className="bs-settlement-col-title settlement-lesson-col-title">
                            <span className="material-symbols-outlined settlement-lesson-icon">menu_book</span>
                            <span>課程步驟</span>
                            <span className="settlement-lesson-task-name" title={lesson.record.task.title}>{lesson.record.task.title}</span>
                            <span className="settlement-lesson-progress">
                              {Math.min(lesson.doneCount, lesson.record.task.steps.length)}/{lesson.record.task.steps.length}
                            </span>
                          </div>
                        )}
                        <div className="bs-settlement-tasklist settlement-steps-list">
                          {lesson.record.task.steps.map((step, idx) => {
                            const done = idx < lesson.doneCount;
                            return (
                              <div key={step.id} className={`bs-settlement-task settlement-step-row ${done ? 'done' : 'undone'}`}>
                                <div className="bs-task-num">{idx + 1}</div>
                                <div className="settlement-step-body">
                                  <span className="bs-task-label">{step.title}</span>
                                  {step.purpose && (
                                    <span className="settlement-step-purpose">{step.purpose}</span>
                                  )}
                                </div>
                                <span className="bs-task-check">
                                  {done
                                    ? <span className="material-symbols-outlined">check</span>
                                    : <span className="material-symbols-outlined">close</span>}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}

            </div>

            <div className="bs-settlement-footer">
              <button className="bs-settlement-dismiss" onClick={() => setShowSettlement(false)}>關閉</button>
            </div>

            {/* Resize handle (bottom-right corner) */}
            <div className="settlement-resize-handle" title="拖曳調整大小" />
          </div>
        </div>
      )}

      {/* ── Main Body: Sidebar + Video ────────────────────────────────────────── */}
      <div className="hs-body">

        {/* ── Left Sidebar ──────────────────────────────────────────────────── */}
        <div className={`hs-sidebar${checkpointPoll ? ' is-poll-active' : ''}`}>

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

          {/* 場景物件(遮罩)卡 — 在 camera 背景下用虛擬物件擋住真實環境干擾 */}
          {/* <div
            className={`hs-card hs-card--scene ${showOccludersPanel ? 'hs-card--open' : ''}`}
            onClick={openOccluders}
          >
            <div className="hs-card-header">
              <span className="hs-card-icon">🪴</span>
              <span className="hs-card-title">場景物件</span>
              <span className="hs-badge hs-badge--info">{occluderInstances.length}</span>
            </div>
          </div> */}

          {/* Lesson card：導師任務管理 */}
          <div className={`hs-card hs-card--lesson ${showLessonPanel ? 'hs-card--open' : ''}`} onClick={openLesson}>
            <div className="hs-card-header">
              <span className="hs-card-icon">📋</span>
              <span className="hs-card-title">任務</span>
              <span className="hs-badge hs-badge--lesson">{lesson ? `${lesson.doneCount}/${lesson.record.task.steps.length}` : '0/0'}</span>
            </div>
            {lesson ? (
              <div className="hs-task-preview hs-lesson-steps">
                <span className="hs-lesson-preview-title">{lesson.record.task.title}</span>
                <div className="hs-lesson-phases" role="tablist" aria-label="課程階段">
                  {LESSON_PHASES.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      role="tab"
                      aria-selected={lesson.phase === p.id}
                      className={`hs-lesson-phase ${lesson.phase === p.id ? 'is-active' : ''}`}
                      title={p.sub}
                      onClick={e => { e.stopPropagation(); changeLessonPhase(p.id); }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                {lesson.phase !== 'during' && lessonPhaseContent ? (
                  <div className="hs-lesson-phase-body">
                    <div className="hs-lesson-phase-sub">{phaseMeta(lesson.phase).sub}</div>
                    <div className="hs-task-preview-list">
                      {lessonPhaseContent.questions.map((q, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className={`hs-lesson-question ${idx === lesson.questionIndex ? 'is-current' : ''}`}
                          aria-pressed={idx === lesson.questionIndex}
                          onClick={e => { e.stopPropagation(); focusLessonQuestion(idx); }}
                        >
                          <span className="hs-lesson-question-en">{idx + 1}. {q.en}</span>
                          {/* <span className="hs-lesson-question-zh">{q.zh}</span> */}
                        </button>
                      ))}
                    </div>
                    {lessonPhaseContent.focusPoints.length > 0 && (
                      <div className="hs-lesson-chips">
                        <span className="hs-lesson-chips-label">語法重點</span>
                        {lessonPhaseContent.focusPoints.map(f => <span key={f} className="hs-lesson-chip">{f}</span>)}
                      </div>
                    )}
                    {lessonPhaseContent.frames.length > 0 && (
                      <div className="hs-lesson-chips">
                        <span className="hs-lesson-chips-label">句型框架</span>
                        {lessonPhaseContent.frames.map(f => <span key={f} className="hs-lesson-chip hs-lesson-chip--frame">{f}</span>)}
                      </div>
                    )}
                  </div>
                ) : (
                <>
                <div className="hs-task-progress-bar">
                  <div
                    className="hs-task-progress-fill"
                    style={{ width: `${Math.round((lesson.doneCount / lesson.record.task.steps.length) * 100)}%` }}
                  />
                </div>
                <div className="hs-task-preview-list">
                  {lesson.record.task.steps.map((step, idx) => {
                    const done = idx < lesson.doneCount;
                    const current = idx === lesson.doneCount;
                    return (
                      <label
                        key={step.id}
                        className={`hs-task-preview-row ${done ? 'completed' : current ? 'current' : ''}`}
                        title={done ? '點擊取消完成' : current ? '點擊標記此階段完成' : '請依序完成前面的步驟'}
                        onClick={e => { e.stopPropagation(); e.preventDefault(); toggleLessonStep(idx); }}
                      >
                        <input type="checkbox" checked={done} disabled={!done && !current} readOnly onClick={e => e.stopPropagation()} />
                        <span>{idx + 1}. </span>
                        <span>{step.purpose ? `${step.purpose}` : ''}</span>
                        {/* <span>{idx + 1}. {step.title || '未命名步驟'}{step.purpose ? `（${step.purpose}）` : ''}</span> */}
                      </label>
                    );
                  })}
                  {/* {lessonDone && <div className="hs-lesson-done">✓ 所有步驟完成</div>} */}
                </div>
                <ScriptTurnHostPanel
                  turn={scriptTurn}
                  lines={scriptLines}
                  speakerStatus={speakerStatus}
                  transcript={liveTurnTranscript}
                  hintMode={lesson.turnHintMode ?? 'tiered'}
                  hintLevel={liveTurnHint?.level ?? null}
                  hintBy={liveTurnHint?.by ?? 'auto'}
                  onHintModeChange={setTurnHintMode}
                  hintAuto={lesson.turnHintAuto === true}
                  onHintAutoChange={setTurnHintAuto}
                  onGiveHint={giveTurnHint}
                  blockedReason={scriptBlockedReason}
                  isLastStep={lesson.doneCount >= lesson.record.task.steps.length - 1}
                  onStart={startScriptTurn}
                  onPrev={() => updateTurn(backTurn)}
                  onNext={() => updateTurn(advanceTurn)}
                  onTogglePause={() => updateTurn((_l, t) => setTurnPaused(t, t.status !== 'paused'))}
                  onJump={i => updateTurn((l, t) => jumpTurn(l, t, i))}
                  onNextStep={nextStepScriptTurn}
                  onEnd={endScriptTurn}
                />
                <CheckpointHostPanel
                  steps={lesson.record.task.steps}
                  currentIndex={currentStepIndex(lesson)}
                  level={lesson.record.task.level}
                  poll={checkpointPoll}
                  studentIds={studentIds}
                  cast={checkpointCast}
                  onPublish={publishCheckpoint}
                  onToggleQuestionText={toggleCheckpointQuestionText}
                  onClose={closeCheckpoint}
                  onReveal={revealCheckpoint}
                  onEnd={endCheckpoint}
                />
                <div className="hs-task-reset" onClick={(e) => { e.stopPropagation(); resetAllLessons(); }}>↺ 重置全部</div>
                </>
                )}
              </div>
            ) : (
              <div className="hs-task-empty">點擊選擇任務</div>
            )}
          </div>

          {/* Character / Slot card：排在任務之後——選定任務才知道需要哪些角色、各幾句台詞 */}
          {hasSlots && (
            <div className={`hs-card hs-card--character ${showSlotPanel ? 'hs-card--open' : ''}`} onClick={openSlot}>
              <div className="hs-card-header">
                <span className="hs-card-icon">🎭</span>
                <span className="hs-card-title">角色</span>
                <span className="hs-badge hs-badge--info">
                  {castSlots.filter(slot => slotAssignments[slot.id]).length}/{castSlots.length}
                </span>
              </div>
              {!lesson && <div className="hs-slot-hint">建議先選定任務，再指定角色</div>}
              <div className="hs-slot-list">
                {castSlots.map((slot, i) => {
                  const assigned = slotAssignments[slot.id];
                  const assignedParticipant = assigned ? (
                    assigned === teacherIdentity
                      ? (teacherName ? teacherName : '老師')
                      : studentList.find(info => info.participant.identity === assigned)?.participant.name || assigned
                  ) : '─';
                  const lines = castLines.get(slot.id);
                  return (
                    <div
                      key={slot.id}
                      className={`hs-slot-row ${assigned ? 'hs-slot-row--filled' : 'hs-slot-row--empty'}`}
                      style={{ '--slot-color': SLOT_COLORS[i % SLOT_COLORS.length] } as React.CSSProperties}
                    >
                      <span className="hs-slot-dot" />
                      <span className="hs-slot-label">
                        {slot.icon} {slot.label}
                        {lines !== undefined && <span className="hs-slot-lines">{lines} 句</span>}
                      </span>
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

          {/* Lesson banner：導師任務管理的目前步驟 */}
          {lesson && lessonStep && (
            <div className={`hs-lesson-banner ${lessonDone ? 'hs-lesson-banner--done' : ''}`}>
              <div className="hs-task-banner-bar">
                <div
                  className="hs-task-banner-fill"
                  style={{ width: `${Math.round((lesson.doneCount / lesson.record.task.steps.length) * 100)}%` }}
                />
              </div>
              <div className="hs-lesson-banner-text">
                <span className="hs-lesson-banner-task" title={lesson.record.task.title}>{lesson.record.task.title}</span>
                <span className={`hs-lesson-banner-phase hs-lesson-banner-phase--${lesson.phase}`}>{phaseMeta(lesson.phase).label}</span>
                {lesson.phase !== 'during' ? (
                  lessonQuestion && (
                    <>
                      {lessonPhaseContent!.questions.length > 1 && (
                        <span className="hs-lesson-banner-step">提問 {lesson.questionIndex + 1}/{lessonPhaseContent!.questions.length}</span>
                      )}
                      <span className="hs-lesson-banner-title" title={lessonQuestion.zh}>{lessonQuestion.en}</span>
                    </>
                  )
                ) : lessonDone ? (
                  <>
                    <span className="hs-lesson-banner-title">✓ 課程完成</span>
                    <button className="hs-settlement-btn" onClick={e => { e.stopPropagation(); setSettlementTab('steps'); setShowSettlement(true); }}><span className="material-symbols-outlined">finance</span>結算</button>
                  </>
                ) : (
                  <>
                    <span className="hs-lesson-banner-step">步驟 {currentStepIndex(lesson) + 1}/{lesson.record.task.steps.length}</span>
                    <span className="hs-lesson-banner-title">{lessonStep.title}</span>
                    {lessonStep.purpose && <span className="hs-lesson-banner-purpose">{lessonStep.purpose}</span>}
                  </>
                )}
                {/* <span className="hs-lesson-banner-actions">
                  <button
                    className={`hs-lesson-lines-btn ${lesson.showLines ? 'is-on' : ''}`}
                    onClick={toggleLessonLines}
                    disabled={lessonDone}
                    title={lesson.showLines ? '大螢幕隱藏台詞提示' : '大螢幕顯示台詞提示'}
                  >
                    <span className="material-symbols-outlined">lightbulb</span>台詞提示 {lesson.showLines ? 'ON' : 'OFF'}
                  </button>
                  <button className="hs-lesson-nav-btn" onClick={() => shiftLessonDone(-1)} disabled={lesson.doneCount === 0} aria-label="上一步（取消完成）" title="上一步">
                    <span className="material-symbols-outlined">chevron_left</span>
                  </button>
                  <button
                    className="hs-lesson-nav-btn hs-lesson-nav-btn--next"
                    onClick={() => shiftLessonDone(1)}
                    disabled={lessonDone}
                    aria-label="完成此步驟"
                    title="完成此步驟"
                  >
                    <span className="material-symbols-outlined">chevron_right</span>
                  </button>
                </span> */}
              </div>
            </div>
          )}

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
                      <button className="hs-settlement-btn" onClick={e => { e.stopPropagation(); setSettlementTab('tasks'); setShowSettlement(true); }}><span className="material-symbols-outlined">finance</span>結算</button>
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
              const hint = currentTask ? resolveTaskHint(currentTask.id, lessonPlan?.plan) : undefined;
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
              const hasConstraint = !!sceneConstraint;
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
                    <AiAssistantPanel
                      sttSupported={sttSupported}
                      hasConstraint={hasConstraint}
                      interactionPhase={interactionPhase}
                      aiBusy={aiBusy}
                      bigScreenEditing={bigScreenEditing}
                      scriptActive={!!lesson?.turn}
                      onStartInteraction={startInteraction}
                      onTeacherDone={handleTeacherDone}
                      onTeacherTakeover={handleTeacherTakeover}
                      onEndInteraction={endInteraction}
                      sttRecording={sttRecording}
                      recordDuration={recordDuration}
                      sttError={sttError}
                      sttInterim={sttInterim}
                      sttTranscript={sttTranscript}
                      tooShort={tooShort}
                      onSimulate={text => {
                        cancelAutoCountdown();
                        setAiError(null);
                        simulateTranscript(text);
                      }}
                      aiModel={aiModel}
                      latestHint={latestHint}
                      detectedQuestion={detectedQuestion}
                      aiUsage={aiUsage}
                      aiCumulativeTokens={aiCumulativeTokens}
                      countdown={countdown}
                      canTrigger={canTrigger}
                      onHint={mode => handleHint(mode)}
                      aiError={aiError}
                      lessonPlanNotice={lessonPlanNotice}
                      onClearHint={handleClearAIHint}
                    />
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* ── Big Screen FAB (bottom-right) ────────────────────────────────────── */}
      <div className="hs-bigscreen-fab-wrap">
        {bigScreenMenuOpen && (
          <div className="hs-bigscreen-fab-menu">
            <button
              className="hs-bigscreen-fab-menu-item"
              onClick={() => { openBigScreen('display'); setBigScreenMenuOpen(false); }}
            >
              <span className="material-symbols-outlined">visibility</span> 顯示模式
            </button>
            <button
              className="hs-bigscreen-fab-menu-item"
              disabled={interactionPhase !== 'idle'}
              title={interactionPhase !== 'idle' ? '互動進行中，無法進入編輯模式' : undefined}
              onClick={() => { openBigScreen('edit'); setBigScreenMenuOpen(false); }}
            >
              <span className="material-symbols-outlined">edit</span> 編輯模式
            </button>
          </div>
        )}
        <button
          id="open-bigscreen-btn"
          className="hs-bigscreen-fab"
          onClick={() => setBigScreenMenuOpen(v => !v)}
          title="在新視窗開啟大屏"
        >
          <span className="material-symbols-outlined">rocket_launch</span>
          <span className="hs-fab-label">開啟大屏</span>
          <span className="material-symbols-outlined" style={{ marginLeft: '4px', fontSize: '20px', transition: 'transform 0.2s ease', transform: bigScreenMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>
            expand_less
          </span>
        </button>
      </div>

      {/* ── Drawer Backdrop ───────────────────────────────────────────────────── */}
      {(showScenePanel || showSlotPanel || showTaskPanel || showPendingPanel || showLessonPanel || sceneEditorGroupId) && (
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
            {lesson ? (
              <div className="slot-drawer-banner slot-drawer-banner--cast">
                <span>任務「{lesson.record.task.title}」需要 {castSlots.length} 個角色，依台詞句數分配學生</span>
                {castOptions.length > 1 && (
                  <div className="slot-cast-size" role="radiogroup" aria-label="演出人數">
                    <span className="slot-cast-size-label">演出人數</span>
                    {castOptions.map(c => (
                      <button
                        key={c.size}
                        type="button"
                        role="radio"
                        aria-checked={c.size === activeCastSize}
                        className={`slot-cast-size-btn ${c.size === activeCastSize ? 'is-active' : ''}`}
                        onClick={() => changeCastSize(c.size)}
                      >
                        {c.size} 人
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="slot-drawer-banner slot-drawer-banner--todo">
                <span>尚未選定任務：先選任務，才知道需要哪些角色</span>
                <button type="button" className="slot-drawer-banner-btn" onClick={openLesson}>選擇任務</button>
              </div>
            )}
            {/* 任務沒有台詞的角色不列出；若之前已指定了人，仍顯示出來讓老師移除 */}
            {currentScenePreset.slots!.filter(slot => castSlots.includes(slot) || slotAssignments[slot.id]).map(sceneSlot => {
              const assignedIdentity = slotAssignments[sceneSlot.id];
              const lines = castLines.get(sceneSlot.id);
              const unused = !!lesson && lines === undefined;
              const assignedVrmId = assignedIdentity
                ? (assignedIdentity === teacherIdentity
                  ? teacherVrmSourceId
                  : (studentRoles[assignedIdentity] ?? sceneSlot.defaultVrmId ?? selectedVrmSourceId))
                : (sceneSlot.defaultVrmId ?? selectedVrmSourceId);
              return (
                <div key={sceneSlot.id} className={`slot-card ${unused ? 'slot-card--unused' : ''}`}>
                  <div className="slot-card-top">
                    <div className="slot-icon-container">
                      {sceneSlot.icon}
                    </div>
                    {/* {(() => {
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
                    })()} */}
                    <div className="slot-info">
                      <div className="slot-name">{sceneSlot.label}</div>
                      <div className="slot-status-badge">
                        {assignedIdentity ? '已指派' : '未指派'}
                      </div>
                      {lines !== undefined && <div className="slot-line-count">{lines} 句台詞</div>}
                      {unused && <div className="slot-line-count slot-line-count--none">目前人數沒有這個角色的台詞，可移除指派</div>}
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
                        ...participantOptionsFor(sceneSlot.id)
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

      {/* ── 場景遮罩物件 Drawer ────────────────────────────────────────────── */}
      <SceneOccludersPanel
        sceneId={selectedSceneId}
        instances={occluderInstances}
        onChange={handleOccludersChange}
        open={showOccludersPanel}
        onClose={() => setShowOccludersPanel(false)}
      />

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

      {/* ── Task Drawer（舊有任務庫）──────────────────────────────────────────── */}
      {hasModules && (
        <TaskBankDrawer
          open={showTaskPanel}
          onClose={() => setShowTaskPanel(false)}
          modules={taskBankModules}
          planTitle={lessonPlan && lessonPlan.plan.sceneId === selectedSceneId ? lessonPlan.plan.title : null}
          expandedModuleIds={expandedModuleIds}
          onToggleModule={toggleModuleExpansion}
          selectedTasks={selectedTasks}
          onToggleTask={toggleTaskSelection}
          onClear={() => { setSelectedTasks([]); broadcastTaskChange([]); }}
          dropIndicator={dropIndicator}
          onDragStart={handleTaskDragStart}
          onDragOver={handleTaskDragOver}
          onDrop={handleTaskDrop}
          onDragEnd={handleTaskDragEnd}
        />
      )}

      {/* ── Lesson Drawer（導師任務管理）─────────────────────────────────────── */}
      <LessonTaskDrawer
        open={showLessonPanel}
        onClose={() => setShowLessonPanel(false)}
        teacherUid={teacherUid}
        sceneId={selectedSceneId}
        sceneLabel={currentSceneVariant?.label ?? currentScenePreset.label}
        activeTaskId={lesson?.record.id ?? null}
        onSelect={startLesson}
        onEnd={endLesson}
        onOpenPrep={teacherUid ? openPrep : undefined}
      />

      {/* ── 備課中心覆蓋層（上課中快速編輯，返回後課堂照常進行）──────────────── */}
      {prepTarget && teacherUid && (
        <div className="hs-prep-overlay" role="dialog" aria-modal="true" aria-label="備課中心">
          <Suspense fallback={<div className="hs-prep-loading"><div className="gradient-spinner" /></div>}>
            <LessonPrep
              teacherUid={teacherUid}
              institutionId={user?.institution_id != null ? String(user.institution_id) : undefined}
              classMode
              initialTaskId={prepTarget.taskId}
              onBack={closePrep}
            />
          </Suspense>
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
