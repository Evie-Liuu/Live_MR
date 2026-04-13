import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Room,
  RoomEvent,
  RemoteParticipant,
  RemoteTrackPublication,
  Track,
  DataPacket_Kind,
  type Participant,
} from 'livekit-client';
import StudentTile from './StudentTile.tsx';
import LocalVideo from './LocalVideo.tsx';
import { usePoseDetection } from '../hooks/usePoseDetection.ts';
import type { BigScreenMsg, TaskEntry } from './BigScreen';
import type { PoseFrame } from '../types/vrm';
import { SCENE_PRESETS, DEFAULT_SCENE_ID, THEMES } from '../config/scenes.ts';
import { VRM_SOURCES, DEFAULT_VRM_SOURCE_ID } from '../config/vrmSources.ts';
import PerformanceMonitor from './PerformanceMonitor.tsx';
import { LIVEKIT_URL, BIGSCREEN_CHANNEL_NAME } from '../config/constants.ts';
import { decodePoseFrame } from '../utils/poseCodec.ts';
import { useRecording } from '../hooks/useRecording.ts';
import RecordingPanel from './RecordingPanel.tsx';

// ─── Types ──────────────────────────────────────────────────────────────────
interface HostSessionProps {
  roomId: string;
  livekitToken: string;
}

interface ParticipantInfo {
  participant: RemoteParticipant;
  videoTrack: RemoteTrackPublication | null;
  poseData: PoseFrame | null;
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function HostSession({ roomId, livekitToken }: HostSessionProps) {
  const [participants, setParticipants] = useState<Map<string, ParticipantInfo>>(new Map());
  const [connectedRoom, setConnectedRoom] = useState<Room | null>(null);
  const roomRef = useRef<Room | null>(null);
  const [teacherPoseData, setTeacherPoseData] = useState<PoseFrame | null>(null);
  const [faceEnabled, setFaceEnabled] = useState(true);
  // Set of participant identities currently speaking
  const [speakingSet, setSpeakingSet] = useState<Set<string>>(new Set());

  // Big-screen pop-out window reference
  const bigScreenWindowRef = useRef<Window | null>(null);
  // BroadcastChannel to push pose data to big screen
  const channelRef = useRef<BroadcastChannel | null>(null);

  // Teacher's own video ref (for pose detection)
  const teacherVideoRef = useRef<HTMLVideoElement>(null);

  // Latest pose snapshot for all participants (used when opening big screen mid-session)
  const poseSnapshotRef = useRef<Record<string, unknown>>({});

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
      const taskClearMsg: BigScreenMsg = { type: 'task-change', tasks: [] };
      channelRef.current?.postMessage(taskClearMsg);
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
    [broadcastSceneChange, broadcastTeacherVrmChange, broadcastVrmChange],
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

  // ─── Teacher pose detection ───────────────────────────────────────────────
  const teacherPublishPose = useCallback(
    (data: Uint8Array) => {
      try {
        const parsed = decodePoseFrame(data);
        // Always update local overlay regardless of connection state
        setTeacherPoseData(parsed);
        if (!connectedRoom) return;
        const identity = connectedRoom.localParticipant.identity;
        poseSnapshotRef.current[identity] = parsed;
        // Update sessionStorage to keep snapshot in sync
        try {
          sessionStorage.setItem('bigscreen-snapshot', JSON.stringify(poseSnapshotRef.current));
        } catch {/* ignore */ }
        const msg: BigScreenMsg = { type: 'pose', identity, poseData: parsed };
        channelRef.current?.postMessage(msg);
      } catch { /* ignore */ }
    },
    [connectedRoom],
  );

  usePoseDetection(teacherVideoRef, teacherPublishPose, undefined, faceEnabled);

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
    };

    const handleDisconnected = (participant: RemoteParticipant) => {
      setParticipants((prev) => {
        const next = new Map(prev);
        next.delete(participant.identity);
        return next;
      });
      channelRef.current?.postMessage({ type: 'leave', identity: participant.identity });
      delete poseSnapshotRef.current[participant.identity];
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
      _kind?: DataPacket_Kind,
    ) => {
      if (!participant) return;
      try {
        const data = decodePoseFrame(payload);

        updateParticipant(participant.identity, (info) => ({
          ...info,
          poseData: data,
        }));

        poseSnapshotRef.current[participant.identity] = data;
        // Update sessionStorage to keep snapshot in sync
        try {
          sessionStorage.setItem('bigscreen-snapshot', JSON.stringify(poseSnapshotRef.current));
        } catch {/* ignore */ }
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
        if (isMounted) console.error('Failed to connect to room:', err);
      });

    return () => {
      isMounted = false;
      setConnectedRoom(null);
      setSpeakingSet(new Set());
      connectPromise.catch(() => { }).finally(() => {
        room.disconnect();
      });
    };
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
    } catch {/* ignore */ }

    const url = `${window.location.origin}/?screen=bigscreen`;
    const win = window.open(url, 'live-mr-bigscreen', 'width=1280,height=720,menubar=no,toolbar=no');
    bigScreenWindowRef.current = win;
  }, [selectedSceneId, selectedVrmSourceId, teacherVrmSourceId, slotAssignments, selectedTasks, roomId]);

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
  const allowedVrms = currentScenePreset.allowedVrmIds
    ? currentScenePreset.allowedVrmIds.map(id => VRM_SOURCES[id]).filter(Boolean)
    : Object.values(VRM_SOURCES);

  // Reverse map: identity → slotId
  const identityToSlotId = Object.fromEntries(
    Object.entries(slotAssignments).map(([slotId, identity]) => [identity, slotId])
  );

  // All participants for slot assignment dropdown (teacher + students)
  const teacherIdentity = connectedRoom?.localParticipant.identity;
  const allParticipantOptions = [
    ...(teacherIdentity ? [{ identity: teacherIdentity, label: `老師 (${teacherIdentity})` }] : []),
    ...studentList.map(info => ({ identity: info.participant.identity, label: info.participant.name || info.participant.identity })),
  ];

  const hasSlots = currentScenePreset.slots && currentScenePreset.slots.length > 0;

  const SLOT_COLORS = ['#44aaff', '#ff8844', '#aa88ff', '#44ff88'];

  return (
    <div className="host-session">
      {/* Hidden video element used solely for teacher pose detection */}
      <video
        ref={teacherVideoRef}
        autoPlay
        playsInline
        muted
        style={{ display: 'none' }}
        aria-hidden="true"
      />

      <div className="session-header">
        <h2>課堂進行中</h2>
        <span className="room-badge">房間: {roomId}</span>
        <span className="count-badge">{studentList.length} 位學生</span>

        <RecordingPanel
          isRecording={isRecording}
          onStart={start}
          onStop={stop}
        />

        {/* ── 場景選擇器（依 Theme 分組）── */}
        <label htmlFor="scene-select" className="control-label">場景：</label>
        <select
          id="scene-select"
          className="control-select"
          value={selectedSceneId}
          onChange={(e) => handleSceneChange(e.target.value)}
        >
          {THEMES.map((theme) => (
            <optgroup key={theme.id} label={`${theme.icon ?? ''} ${theme.label}`}>
              {theme.scenes.map((scene) => (
                <option key={scene.id} value={scene.id}>
                  {scene.icon ? `${scene.icon} ` : ''}{scene.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        <button
          className={`control-btn ${faceEnabled ? 'active' : ''}`}
          onClick={() => setFaceEnabled((v) => !v)}
          title={faceEnabled ? '關閉臉部辨識' : '開啟臉部辨識'}
        >
          {faceEnabled ? '🔴 臉部辨識 ON' : '⚪ 臉部辨識 OFF'}
        </button>

        <button
          id="open-bigscreen-btn"
          className="bigscreen-btn"
          onClick={openBigScreen}
          title="在新視窗開啟大屏顯示"
        >
          🖥️ 開啟大屏
        </button>
      </div>

      <PerformanceMonitor label="App Render FPS" position="top-left" />
      <PerformanceMonitor label="Pose Data FPS" trigger={teacherPoseData} position="bottom-left" />

      {/* {connectedRoom && <LocalVideo room={connectedRoom} poseData={teacherPoseData} />} */}

      <div className={hasSlots ? 'host-main-two-col' : undefined}>
        {/* ── Slot Panel (only shown when scene has slots) ── */}
        {hasSlots && (
          <div className="slot-panel">
            <div className="slot-panel-header">🎭 場景角色 SLOTS</div>
            {currentScenePreset.slots!.map((sceneSlot, slotIndex) => {
              const assignedIdentity = slotAssignments[sceneSlot.id];
              const assignedVrmId = assignedIdentity
                ? (assignedIdentity === teacherIdentity
                  ? teacherVrmSourceId
                  : (studentRoles[assignedIdentity] ?? sceneSlot.defaultVrmId ?? selectedVrmSourceId))
                : (sceneSlot.defaultVrmId ?? selectedVrmSourceId);
              return (
                <div
                  key={sceneSlot.id}
                  className="slot-block"
                  style={{ '--slot-color': SLOT_COLORS[slotIndex % SLOT_COLORS.length] } as React.CSSProperties}
                >
                  <div className="slot-block-title">
                    {sceneSlot.icon && <span style={{ fontSize: '18px' }}>{sceneSlot.icon}</span>}
                    <div>
                      <div style={{ color: SLOT_COLORS[slotIndex % SLOT_COLORS.length], fontSize: '12px', fontWeight: 700 }}>
                        {sceneSlot.label}
                      </div>
                      <div className="slot-block-position-hint">
                        位置：{sceneSlot.position[0] >= 0 ? '右側' : '左側'} (x={sceneSlot.position[0]})
                      </div>
                    </div>
                    <span className={`slot-status ${assignedIdentity ? 'assigned' : 'unassigned'}`}>
                      {assignedIdentity ? '● 已指派' : '未指派'}
                    </span>
                  </div>
                  <label className="slot-field-label">指派給</label>
                  <select
                    className="control-select slot-select"
                    value={assignedIdentity ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      handleSlotAssign(sceneSlot.id, val === '' ? null : val);
                    }}
                  >
                    <option value="">─ 移除指派</option>
                    {allParticipantOptions.map(opt => (
                      <option key={opt.identity} value={opt.identity}>{opt.label}</option>
                    ))}
                  </select>
                  <label className="slot-field-label">角色模型</label>
                  <select
                    className="control-select slot-select"
                    value={assignedVrmId ?? ''}
                    disabled={!assignedIdentity}
                    onChange={(e) => {
                      if (assignedIdentity) {
                        if (assignedIdentity === teacherIdentity) {
                          handleTeacherVrmChange(e.target.value);
                        } else {
                          handleStudentRoleChange(assignedIdentity, e.target.value);
                        }
                      }
                    }}
                  >
                    {allowedVrms.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.id === sceneSlot.defaultVrmId ? `★ ${s.label}` : s.label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
            <div className="slot-panel-footer">未指派者不出現在大屏</div>
          </div>
        )}

        {/* ── Right Column (task selector + participant grid) ── */}
        <div className="host-right-col">
          <div className="student-grid">
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
                  className={`student-container teacher-card${isTeacherSpeaking ? ' is-speaking' : ''}`}
                  style={{ position: 'relative', opacity: hasSlots && !teacherSlot ? 0.5 : 1 }}
                >
                  <LocalVideo room={connectedRoom} poseData={teacherPoseData} vrmSourceId={hasSlots && !teacherSlot ? null : teacherVrmSourceId} />
                  <div className="teacher-card-tab">老師</div>
                  {teacherSlot && (
                    <div style={{ position: 'absolute', top: '4px', right: '4px', background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: '11px', padding: '2px 5px', borderRadius: '4px' }}>
                      {teacherSlot.icon} {teacherSlot.label}
                    </div>
                  )}
                  {!teacherSlot && hasSlots && (
                    <div style={{ position: 'absolute', top: '4px', right: '4px', background: 'rgba(0,0,0,0.5)', color: '#aaa', fontSize: '11px', padding: '2px 5px', borderRadius: '4px' }}>
                      未指派
                    </div>
                  )}
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
                  className={`student-container${isStudentSpeaking ? ' is-speaking' : ''}`}
                  style={{ position: 'relative', opacity: hasSlots && !assignedSlot ? 0.5 : 1 }}
                >
                  <StudentTile
                    participant={info.participant}
                    videoTrack={info.videoTrack}
                    poseData={info.poseData}
                    vrmSourceId={hasSlots && !assignedSlot ? null : currentVrmId}
                    muteState={muteState[info.participant.identity]}
                    onToggleMute={toggleMute}
                  />
                  {assignedSlot && (
                    <div style={{ position: 'absolute', top: '4px', right: '4px', background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: '11px', padding: '2px 5px', borderRadius: '4px' }}>
                      {assignedSlot.icon} {assignedSlot.label}
                    </div>
                  )}
                  {!assignedSlot && hasSlots && (
                    <div style={{ position: 'absolute', top: '4px', right: '4px', background: 'rgba(0,0,0,0.5)', color: '#aaa', fontSize: '11px', padding: '2px 5px', borderRadius: '4px' }}>
                      未指派
                    </div>
                  )}
                  {/* {!hasSlots && (
                    <div style={{ position: 'absolute', bottom: '30px', left: '5px', padding: '2px 4px', borderRadius: '4px' }}>
                      <select
                        className="control-select"
                        value={currentVrmId}
                        onChange={(e) => handleStudentRoleChange(info.participant.identity, e.target.value)}
                        style={{ fontSize: '11px', padding: '1px' }}
                      >
                        {allowedVrms.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )} */}
                </div>
              );
            })}
          </div>

          {(() => {
            const modules = currentScenePreset.modules;
            if (!modules || modules.length === 0) return null;

            return (
              <div className="task-manager">
                {/* 1. Task Bank (Selection Tree) */}
                <div className="task-bank">
                  <div className="task-bank-header">
                    <span>📚 任務庫 (Module → Task)</span>
                    <span className={`task-count ${selectedTasks.length >= 7 ? 'limit' : ''}`}>
                      {selectedTasks.length}/7
                    </span>
                  </div>
                  <div className="task-bank-tree">
                    {modules.map((mod) => (
                      <div key={mod.id} className="module-group">
                        <div
                          className={`module-header ${expandedModuleIds.has(mod.id) ? 'expanded' : ''}`}
                          onClick={() => toggleModuleExpansion(mod.id)}
                        >
                          <span className="module-icon">{mod.icon || '📁'}</span>
                          <span className="module-label">{mod.label}</span>
                          <span className="module-arrow">{expandedModuleIds.has(mod.id) ? '▼' : '▶'}</span>
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
                                    {isSelected ? '✓' : ''}
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

                {/* 2. Active Session Progress */}
                <div className="active-tasks">
                  <div className="active-tasks-header">⚡ 進行中任務 (教學順序)</div>
                  {selectedTasks.length === 0 ? (
                    <div className="active-tasks-empty">
                      請從左側任務庫中點選任務，<br />
                      跨 Module 多選最多 7 項，並按順序排列。
                    </div>
                  ) : (
                    <div className="active-tasks-list">
                      {selectedTasks.map((task, idx) => (
                        <div key={`${task.id}-${idx}`} className={`active-task-row ${task.completed ? 'completed' : ''}`}>
                          <div className="task-index">{idx + 1}</div>
                          <div className="task-info">
                            <span className="task-label">{task.label}</span>
                          </div>
                          <label className="completion-toggle" title={task.completed ? '標記為未完成' : '標記為完成'}>
                            <input
                              type="checkbox"
                              checked={task.completed}
                              onChange={() => toggleTaskCompletion(task.id)}
                            />
                            <div className="toggle-slider">
                              {task.completed ? 'DONE' : 'GO'}
                            </div>
                          </label>
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedTasks.length > 0 && (
                    <button className="clear-tasks-btn" onClick={() => {
                      setSelectedTasks([]);
                      broadcastTaskChange([]);
                    }}>
                      🗑️ 清空所有任務
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

        </div>
      </div>
    </div>
  );
}
