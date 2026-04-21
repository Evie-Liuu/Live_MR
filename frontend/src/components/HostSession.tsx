import React, { useEffect, useState, useRef, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
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
import { subscribeToRoomEvents, approveRequest, rejectRequest } from '../api.ts';
import type { RoomEvent as ApiRoomEvent } from '../api.ts';

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

// ─── Main component ──────────────────────────────────────────────────────────
export default function HostSession({ roomId, livekitToken, hostToken }: HostSessionProps) {
  const [participants, setParticipants] = useState<Map<string, ParticipantInfo>>(new Map());
  const [connectedRoom, setConnectedRoom] = useState<Room | null>(null);
  const roomRef = useRef<Room | null>(null);
  const [teacherPoseData, setTeacherPoseData] = useState<PoseFrame | null>(null);
  const [faceEnabled, setFaceEnabled] = useState(true);
  const [handEnabled, _] = useState(faceEnabled);
  // Panel drawer open states
  const [showScenePanel, setShowScenePanel] = useState(false);
  const [showSlotPanel, setShowSlotPanel] = useState(false);
  const [showTaskPanel, setShowTaskPanel] = useState(false);
  const [showPendingPanel, setShowPendingPanel] = useState(false);
  const [pending, setPending] = useState<PendingStudent[]>([]);
  // Settlement modal (shown when allDone)
  const [showSettlement, setShowSettlement] = useState(false);
  // QR Code share modal
  const [showQRModal, setShowQRModal] = useState(false);
  // Track whether a recording was ever started this session
  const [hasRecorded, setHasRecorded] = useState(false);
  // Set of participant identities currently speaking
  const [speakingSet, setSpeakingSet] = useState<Set<string>>(new Set());
  // Embedded BigScreen preview in sidebar
  const [showBigScreenPreview, setShowBigScreenPreview] = useState(false);

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

  // Track if recording was ever started this session
  useEffect(() => {
    if (isRecording) setHasRecorded(true);
  }, [isRecording]);

  // Force stop recording when all tasks are completed
  useEffect(() => {
    if (selectedTasks.length > 0) {
      const allDone = selectedTasks.every(t => t.completed);
      if (allDone && isRecording) {
        stop();
      }
    }
  }, [selectedTasks, isRecording, stop]);

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
      setHasRecorded(false);
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

  usePoseDetection(teacherVideoRef, teacherPublishPose, undefined, faceEnabled, handEnabled);

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
      // _kind?: DataPacket_Kind,
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

  // ─── Embedded BigScreen preview ────────────────────────────────────────────
  // iframe 有獨立的 sessionStorage，透過 BroadcastChannel 補送完整狀態來同步
  const syncBigScreenState = useCallback(() => {
    const ch = channelRef.current;
    if (!ch) return;
    ch.postMessage({ type: 'scene-change', sceneId: selectedSceneId } satisfies BigScreenMsg);
    ch.postMessage({ type: 'task-change', tasks: selectedTasks } satisfies BigScreenMsg);
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
  }, [selectedSceneId, selectedTasks, slotAssignments, connectedRoom, teacherVrmSourceId, studentRoles]);

  const toggleBigScreenPreview = useCallback(() => {
    setShowBigScreenPreview(prev => {
      if (!prev) {
        // 延遲 1s 等 iframe 內的 BigScreen React app 掛載完成後再 sync
        setTimeout(syncBigScreenState, 1000);
      }
      return !prev;
    });
  }, [syncBigScreenState]);

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
  const closeAll = () => { setShowScenePanel(false); setShowSlotPanel(false); setShowTaskPanel(false); setShowPendingPanel(false); };

  return (
    <div className="host-session">
      {/* Hidden video for teacher pose detection */}
      <video ref={teacherVideoRef} autoPlay playsInline muted style={{ display: 'none' }} aria-hidden="true" />

      <PerformanceMonitor label="App Render FPS" position="top-left" />
      <PerformanceMonitor label="Pose Data FPS" trigger={teacherPoseData} position="bottom-left" />

      {/* ── Top Bar ──────────────────────────────────────────────────────────── */}
      <div className="hs-topbar">
        <div className="hs-brand">
          <div className="hs-brand-dot" />
          <span className="hs-brand-title">課堂進行中</span>
        </div>

        <div className="hs-topbar-actions">
          <button className="hs-action-btn" onClick={() => setShowQRModal(true)} title="分享房間 QR Code">
            <span className="hs-action-icon">📱</span>
            <span className="hs-action-label">分享</span>
          </button>

          <button
            className={`hs-action-btn ${pending.length > 0 ? 'hs-action--alert' : ''} ${showPendingPanel ? 'hs-action--active' : ''}`}
            onClick={openPending}
            title="學生管理"
          >
            <span className="hs-action-icon">👥</span>
            <span className="hs-action-label">{studentList.length} 位學生</span>
            {pending.length > 0 && <span className="hs-badge hs-badge--alert">{pending.length}</span>}
          </button>

          <button
            className={`hs-action-btn ${faceEnabled ? 'hs-action--on' : 'hs-action--off'}`}
            onClick={() => setFaceEnabled(v => !v)}
            title={faceEnabled ? '關閉臉部辨識' : '開啟臉部辨識'}
          >
            <span className="hs-action-icon">{faceEnabled ? '😊' : '😶'}</span>
            <span className="hs-action-label">臉部</span>
            <span className={`hs-badge ${faceEnabled ? 'hs-badge--on' : 'hs-badge--off'}`}>{faceEnabled ? 'ON' : 'OFF'}</span>
          </button>

          <RecordingPanel isRecording={isRecording} onStart={start} onStop={stop} />

          <button
            className={`hs-action-btn hs-action-preview ${showBigScreenPreview ? 'hs-action--active' : ''}`}
            onClick={toggleBigScreenPreview}
            title={showBigScreenPreview ? '關閉大屏預覽' : '開啟大屏預覽'}
          >
            <span className="hs-action-icon">🖥️</span>
            <span className="hs-action-label">預覽</span>
            <span className={`hs-badge ${showBigScreenPreview ? 'hs-badge--on' : 'hs-badge--off'}`}>
              {showBigScreenPreview ? 'ON' : 'OFF'}
            </span>
          </button>
        </div>
      </div>

      {/* ── Settlement Modal ──────────────────────────────────────────────────── */}
      {showSettlement && (
        <div className="settlement-backdrop" onClick={() => setShowSettlement(false)}>
          <div className="settlement-modal" onClick={e => e.stopPropagation()}>
            <div className="settlement-header">
              <span className="settlement-trophy">🏆</span>
              <div>
                <div className="settlement-title">課堂結算</div>
                <div className="settlement-subtitle">所有任務已完成</div>
              </div>
              <button className="settlement-close" onClick={() => setShowSettlement(false)}>✕</button>
            </div>

            <div className="settlement-body">
              <div className="settlement-section">
                <div className="settlement-section-title">👥 參與人員</div>
                <div className="settlement-participants">
                  {connectedRoom && (
                    <div className="settlement-participant settlement-participant--host">
                      <span className="settlement-participant-icon">👨‍🏫</span>
                      <span>{connectedRoom.localParticipant.name || connectedRoom.localParticipant.identity}</span>
                      <span className="settlement-participant-role">老師</span>
                    </div>
                  )}
                  {studentList.map(info => (
                    <div key={info.participant.identity} className="settlement-participant">
                      <span className="settlement-participant-icon">👤</span>
                      <span>{info.participant.name || info.participant.identity}</span>
                    </div>
                  ))}
                  {studentList.length === 0 && <div className="settlement-empty">無學生參與</div>}
                </div>
              </div>

              <div className="settlement-section">
                <div className="settlement-section-title">🎬 錄製狀態</div>
                <div className="settlement-recording">
                  {isRecording ? (
                    <div className="settlement-recording-row settlement-recording--active">
                      <span className="recording-dot" />
                      <span>錄製中</span>
                      <button className="settlement-stop-btn" onClick={async () => { await stop(); }}>⏹ 停止錄製</button>
                    </div>
                  ) : hasRecorded ? (
                    <div className="settlement-recording-row settlement-recording--done"><span>✓</span><span>已保存錄製</span></div>
                  ) : (
                    <div className="settlement-recording-row settlement-recording--none"><span>✕</span><span>無錄製</span></div>
                  )}
                </div>
              </div>

              <div className="settlement-section">
                <div className="settlement-section-title">📋 任務清單</div>
                <div className="settlement-tasks">
                  {selectedTasks.map((task, idx) => (
                    <div key={task.id} className={`settlement-task-row ${task.completed ? 'completed' : 'incomplete'}`}>
                      <div className="settlement-task-num">{idx + 1}</div>
                      <span className="settlement-task-label">{task.label}</span>
                      <span className="settlement-task-status">{task.completed ? '✓' : '✕'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="settlement-footer">
              <button className="settlement-dismiss-btn" onClick={() => setShowSettlement(false)}>關閉</button>
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
              <span className="hs-card-arrow">{showScenePanel ? '▲' : '▼'}</span>
            </div>
            <div className="hs-scene-preview">
              <div
                className={`hs-scene-thumb ${!currentScenePreset.backgroundValue ? 'hs-scene-thumb--no-img' : ''}`}
                style={currentScenePreset.backgroundValue ? { backgroundImage: `url(${currentScenePreset.backgroundValue})` } : undefined}
              >
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
                  const assignedOption = assigned ? allParticipantOptions.find(o => o.identity === assigned) : null;
                  return (
                    <div
                      key={slot.id}
                      className={`hs-slot-row ${assigned ? 'hs-slot-row--filled' : 'hs-slot-row--empty'}`}
                      style={{ '--slot-color': SLOT_COLORS[i % SLOT_COLORS.length] } as React.CSSProperties}
                    >
                      <span className="hs-slot-dot" />
                      <span className="hs-slot-label">{slot.icon} {slot.label}</span>
                      <span className="hs-slot-assigned">{assignedOption ? assignedOption.label.split('(')[0].trim() : '─'}</span>
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
                    {selectedTasks.slice(0, 4).map((task, idx) => (
                      <label
                        key={task.id}
                        className={`hs-task-preview-row ${task.completed ? 'completed' : idx === currentTaskIndex ? 'current' : ''}`}
                        onClick={e => { e.stopPropagation(); toggleTaskCompletion(task.id); }}
                      >
                        <input type="checkbox" checked={task.completed} readOnly onClick={e => e.stopPropagation()} />
                        <span>{task.label}</span>
                      </label>
                    ))}
                    {selectedTasks.length > 4 && <div className="hs-task-more">+{selectedTasks.length - 4} 更多</div>}
                  </div>
                </div>
              ) : (
                <div className="hs-task-empty">點擊選擇任務</div>
              )}
            </div>
          )}
        </div>

        {/* ── Video Area ────────────────────────────────────────────────────── */}
        <div className="hs-video-area">

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
                      <button className="hs-settlement-btn" onClick={e => { e.stopPropagation(); setShowSettlement(true); }}>📊 結算</button>
                    </>
                  ) : (
                    <>
                      <span className="hs-task-arrow">▸</span>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {selectedTasks[currentTaskIndex]?.label}
                      </span>
                      <span className="hs-task-counter">{doneCount}/{selectedTasks.length}</span>
                    </>
                  )}
                </div>
              </div>
            );
          })()}

          {/* BigScreen embedded preview */}
          {showBigScreenPreview && (
            <div className="hs-preview-pane">
              <div className="hs-preview-header">
                <span className="hs-preview-title">🖥️ 大屏預覽</span>
                <button className="hs-preview-close" onClick={toggleBigScreenPreview} title="關閉預覽">✕</button>
              </div>
              <iframe
                className="hs-preview-iframe"
                src={`${window.location.origin}/?screen=bigscreen`}
                title="BigScreen Preview"
                allow="camera; microphone"
              />
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
                  style={{ opacity: hasSlots && !teacherSlot ? 0.5 : 1 }}
                >
                  <LocalVideo room={connectedRoom} poseData={teacherPoseData} vrmSourceId={hasSlots && !teacherSlot ? null : teacherVrmSourceId} />
                  <div className="hs-video-tag hs-video-tag--teacher">👨‍🏫 老師</div>
                  {teacherSlot && <div className="hs-video-slot-badge">{teacherSlot.icon} {teacherSlot.label}</div>}
                  {!teacherSlot && hasSlots && <div className="hs-video-slot-badge hs-video-slot-badge--unassigned">未指派</div>}
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
                  style={{ opacity: hasSlots && !assignedSlot ? 0.5 : 1 }}
                >
                  <StudentTile
                    participant={info.participant}
                    videoTrack={info.videoTrack}
                    poseData={info.poseData}
                    vrmSourceId={hasSlots && !assignedSlot ? null : currentVrmId}
                    muteState={muteState[info.participant.identity]}
                    onToggleMute={toggleMute}
                  />
                  {assignedSlot && <div className="hs-video-slot-badge">{assignedSlot.icon} {assignedSlot.label}</div>}
                  {!assignedSlot && hasSlots && <div className="hs-video-slot-badge hs-video-slot-badge--unassigned">未指派</div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Big Screen FAB (bottom-right) ────────────────────────────────────── */}
      <button id="open-bigscreen-btn" className="hs-bigscreen-fab" onClick={openBigScreen} title="在新視窗開啟大屏顯示">
        <span className="hs-fab-icon">🖥️</span>
        <span className="hs-fab-label">開啟大屏</span>
      </button>

      {/* ── Drawer Backdrop ───────────────────────────────────────────────────── */}
      {(showScenePanel || showSlotPanel || showTaskPanel || showPendingPanel) && (
        <div className="panel-backdrop" onClick={closeAll} />
      )}

      {/* ── Pending Requests Drawer ───────────────────────────────────────────── */}
      <div className={`panel-drawer ${showPendingPanel ? 'panel-drawer--open' : ''}`}>
        <div className="panel-drawer-header">
          <span>🔔 加入和申請清單</span>
          <button className="panel-close-btn" onClick={() => setShowPendingPanel(false)}>✕</button>
        </div>
        <div className="panel-drawer-body">
          <div className="pending-list" style={{ padding: '0 16px' }}>
            <h3 style={{ marginTop: '16px', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>待審核學生 ({pending.length})</h3>
            {pending.length === 0 && <div style={{ color: '#666', fontSize: '13px' }}>目前沒有加入請求</div>}
            {pending.map((s) => (
              <div key={s.requestId} className="pending-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.1)', padding: '10px', borderRadius: '8px', marginBottom: '8px' }}>
                <span style={{ fontWeight: 'bold' }}>{s.name}</span>
                <div className="pending-actions" style={{ display: 'flex', gap: '8px' }}>
                  <button className="approve-btn" style={{ background: '#4CAF50', color: 'white', border: 'none', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer' }} onClick={() => handleApprove(s.requestId)}>允許</button>
                  <button className="reject-btn" style={{ background: '#F44336', color: 'white', border: 'none', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer' }} onClick={() => handleReject(s.requestId)}>拒絕</button>
                </div>
              </div>
            ))}

            <h3 style={{ marginTop: '24px', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>已加入學生 ({studentList.length})</h3>
            {studentList.length === 0 && <div style={{ color: '#666', fontSize: '13px' }}>目前沒有學生加入</div>}
            {studentList.map((info) => (
              <div key={info.participant.identity} style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '8px', marginBottom: '8px' }}>
                <span style={{ marginRight: '8px' }}>👤</span>
                <span>{info.participant.name || info.participant.identity}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Scene Drawer ─────────────────────────────────────────────────────── */}
      <div className={`panel-drawer ${showScenePanel ? 'panel-drawer--open' : ''}`}>
        <div className="panel-drawer-header">
          <span>🎬 場景選擇</span>
          <button className="panel-close-btn" onClick={() => setShowScenePanel(false)}>✕</button>
        </div>
        <div className="panel-drawer-body">
          {THEMES.map((theme) => (
            <div key={theme.id} className="scene-group">
              <div className="scene-group-label">{theme.icon} {theme.label}</div>
              <div className="scene-options">
                {theme.scenes.map((scene) => (
                  <button
                    key={scene.id}
                    className={`scene-option-btn ${selectedSceneId === scene.id ? 'active' : ''}`}
                    onClick={() => { handleSceneChange(scene.id); setShowScenePanel(false); }}
                  >
                    {SCENE_PRESETS[scene.id]?.backgroundValue && (
                      <div
                        className="scene-option-img-bg"
                        style={{ backgroundImage: `url(${SCENE_PRESETS[scene.id].backgroundValue})` }}
                      />
                    )}
                    {scene.icon && <span>{scene.icon}</span>}
                    <span>{scene.label}</span>
                    {selectedSceneId === scene.id && <span className="scene-check">✓</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Slot Drawer ──────────────────────────────────────────────────────── */}
      {hasSlots && (
        <div className={`panel-drawer ${showSlotPanel ? 'panel-drawer--open' : ''}`}>
          <div className="panel-drawer-header">
            <span>🎭 角色配置 SLOTS</span>
            <button className="panel-close-btn" onClick={() => setShowSlotPanel(false)}>✕</button>
          </div>
          <div className="panel-drawer-body">
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
        </div>
      )}

      {/* ── Task Drawer ──────────────────────────────────────────────────────── */}
      {hasModules && (
        <div className={`panel-drawer panel-drawer--wide ${showTaskPanel ? 'panel-drawer--open' : ''}`}>
          <div className="panel-drawer-header">
            <span>📋 任務管理</span>
            <button className="panel-close-btn" onClick={() => setShowTaskPanel(false)}>✕</button>
          </div>
          <div className="panel-drawer-body task-manager-drawer">
            {/* Left: Task Bank */}
            <div className="task-bank">
              <div className="task-bank-header">
                <span>📚 任務庫</span>
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
                              <div className="btn-check">{isSelected ? '✓' : ''}</div>
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
                <span>⚡ 已選任務</span>
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
                      <span className="task-drag-handle" title="拖曳排序">⠿</span>
                      <div className="task-index">{idx + 1}</div>
                      <div className="task-info">
                        <span className="task-label">{task.label}</span>
                      </div>
                      <button
                        className="task-remove-btn"
                        title="移除此任務"
                        onClick={() => toggleTaskSelection(task.id, task.label)}
                      >✕</button>
                    </div>
                  ))}
                </div>
              )}
              {selectedTasks.length > 0 && (
                <button className="clear-tasks-btn" onClick={() => { setSelectedTasks([]); broadcastTaskChange([]); }}>
                  🗑️ 清空所有任務
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {/* ── QR Code Modal ───────────────────────────────────────────────────── */}
      {showQRModal && (
        <div className="settlement-backdrop" onClick={() => setShowQRModal(false)}>
          <div className="settlement-modal" style={{ width: '320px' }} onClick={(e) => e.stopPropagation()}>
            <div className="settlement-header">
              <span style={{ fontSize: '24px' }}>📱</span>
              <div>
                <div className="settlement-title">分享房間</div>
                <div className="settlement-subtitle">邀請學生加入課堂</div>
              </div>
              <button className="settlement-close" onClick={() => setShowQRModal(false)}>✕</button>
            </div>
            <div className="settlement-body" style={{ alignItems: 'center', gap: '20px', padding: '30px 20px' }}>
              <div style={{ background: '#fff', padding: '12px', borderRadius: '12px' }}>
                <QRCodeSVG value={`${window.location.protocol}//${window.location.host}/?roomId=${roomId}`} size={200} />
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: '#7788ff', fontSize: '12px', fontWeight: 800, letterSpacing: '1px', marginBottom: '4px' }}>房間 ID</div>
                <div style={{ color: '#fff', fontSize: '20px', fontWeight: 800 }}>{roomId}</div>
              </div>
              <button
                className="settlement-dismiss-btn"
                style={{ width: '100%' }}
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.protocol}//${window.location.host}/?roomId=${roomId}`);
                  // Simple alert or toast could go here
                }}
              >
                複製加入連結
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
