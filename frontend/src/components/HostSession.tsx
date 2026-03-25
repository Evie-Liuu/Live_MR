import { useEffect, useState, useRef, useCallback } from 'react';
import {
  Room,
  RoomEvent,
  RemoteParticipant,
  RemoteTrackPublication,
  Track,
  DataPacket_Kind,
} from 'livekit-client';
import StudentTile from './StudentTile.tsx';
import { usePoseDetection } from '../hooks/usePoseDetection.ts';
import type { BigScreenMsg } from './BigScreen';
import PoseDebugOverlay from './PoseDebugOverlay';
import { SCENE_PRESETS, DEFAULT_SCENE_ID } from '../config/scenes.ts';
import { VRM_SOURCES, DEFAULT_VRM_SOURCE_ID } from '../config/vrmSources.ts';
import PerformanceMonitor from './PerformanceMonitor.tsx';
import { LIVEKIT_URL, BIGSCREEN_CHANNEL_NAME } from '../config/constants.ts';

// ─── LocalVideo: teacher's self-view camera ────────────────────────────────
function LocalVideo({ room, poseData }: { room: Room; poseData?: unknown }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoSize, setVideoSize] = useState({ width: 320, height: 240 });

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const attachCamera = () => {
      const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (camPub?.track) {
        el.srcObject = new MediaStream([camPub.track.mediaStreamTrack]);
      }
    };

    const handleLoadedMetadata = () => {
      setVideoSize({
        width: el.clientWidth || 320,
        height: el.clientHeight || 240,
      });
    };
    el.addEventListener('loadedmetadata', handleLoadedMetadata);

    attachCamera();
    room.localParticipant.on('localTrackPublished', attachCamera);

    return () => {
      room.localParticipant.off('localTrackPublished', attachCamera);
      el.srcObject = null;
      el.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [room]);

  // Keep size in sync with poseData triggers
  useEffect(() => {
    const el = videoRef.current;
    if (poseData && el && el.clientWidth > 0) {
      setVideoSize((prev) => {
        if (prev.width !== el.clientWidth || prev.height !== el.clientHeight) {
          return { width: el.clientWidth, height: el.clientHeight };
        }
        return prev;
      });
    }
  }, [poseData]);

  const frame = poseData as { landmarks?: unknown[] } | null;
  const landmarks = frame?.landmarks;

  return (
    <div className="teacher-tile" style={{ position: 'relative' }}>
      <video ref={videoRef} autoPlay playsInline muted className="tile-video" />
      {landmarks && (
        <PoseDebugOverlay
          landmarks={[landmarks as never]}
          width={videoSize.width}
          height={videoSize.height}
        />
      )}
      <div
        className="teacher-label"
        style={{
          position: 'absolute',
          bottom: 5,
          right: 5,
          background: 'rgba(0,0,0,0.5)',
          color: '#fff',
          padding: '2px 5px',
        }}
      >
        老師 (我)
      </div>
    </div>
  );
}

// ─── Types ──────────────────────────────────────────────────────────────────
interface HostSessionProps {
  roomId: string;
  livekitToken: string;
}

interface ParticipantInfo {
  participant: RemoteParticipant;
  videoTrack: RemoteTrackPublication | null;
  poseData: unknown | null;
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function HostSession({ roomId, livekitToken }: HostSessionProps) {
  const [participants, setParticipants] = useState<Map<string, ParticipantInfo>>(new Map());
  const [connectedRoom, setConnectedRoom] = useState<Room | null>(null);
  const roomRef = useRef<Room | null>(null);
  const [teacherPoseData, setTeacherPoseData] = useState<unknown | null>(null);

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
  const [selectedVrmSourceId, setSelectedVrmSourceId] = useState<string>(
    () => sessionStorage.getItem('bigscreen-vrmSourceId') ?? DEFAULT_VRM_SOURCE_ID,
  );

  // Broadcast scene/VRM changes to any open BigScreen window
  const broadcastSceneChange = useCallback((sceneId: string) => {
    sessionStorage.setItem('bigscreen-sceneId', sceneId);
    const msg: BigScreenMsg = { type: 'scene-change', sceneId };
    channelRef.current?.postMessage(msg);
  }, []);

  const broadcastVrmChange = useCallback((vrmSourceId: string) => {
    sessionStorage.setItem('bigscreen-vrmSourceId', vrmSourceId);
    const msg: BigScreenMsg = { type: 'vrm-change', vrmSourceId };
    channelRef.current?.postMessage(msg);
  }, []);

  const handleSceneChange = useCallback(
    (sceneId: string) => {
      setSelectedSceneId(sceneId);
      broadcastSceneChange(sceneId);
    },
    [broadcastSceneChange],
  );

  const handleVrmChange = useCallback(
    (vrmSourceId: string) => {
      setSelectedVrmSourceId(vrmSourceId);
      broadcastVrmChange(vrmSourceId);
    },
    [broadcastVrmChange],
  );

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
      if (!connectedRoom) return; // guard: don't broadcast until connected
      try {
        const text = new TextDecoder().decode(data);
        const parsed = JSON.parse(text) as unknown;
        const identity = connectedRoom.localParticipant.identity;
        poseSnapshotRef.current[identity] = parsed;
        setTeacherPoseData(parsed);
        const msg: BigScreenMsg = { type: 'pose', identity, poseData: parsed };
        channelRef.current?.postMessage(msg);
      } catch { /* ignore */ }
    },
    [connectedRoom],
  );

  usePoseDetection(teacherVideoRef, teacherPublishPose);

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
    };

    const handleDisconnected = (participant: RemoteParticipant) => {
      setParticipants((prev) => {
        const next = new Map(prev);
        next.delete(participant.identity);
        return next;
      });
      channelRef.current?.postMessage({ type: 'leave', identity: participant.identity });
      delete poseSnapshotRef.current[participant.identity];
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
        const data = JSON.parse(new TextDecoder().decode(payload)) as unknown;

        updateParticipant(participant.identity, (info) => ({
          ...info,
          poseData: data,
        }));

        poseSnapshotRef.current[participant.identity] = data;
        const msg: BigScreenMsg = { type: 'pose', identity: participant.identity, poseData: data };
        channelRef.current?.postMessage(msg);
      } catch {
        // ignore malformed data
      }
    };

    let isMounted = true;
    room.on(RoomEvent.ParticipantConnected, handleConnected);
    room.on(RoomEvent.ParticipantDisconnected, handleDisconnected);
    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed as never);
    room.on(RoomEvent.DataReceived, handleDataReceived as never);

    const connectPromise = room.connect(LIVEKIT_URL, livekitToken);

    connectPromise
      .then(async () => {
        if (!isMounted) return;
        setConnectedRoom(room);

        try {
          await room.localParticipant.setCameraEnabled(true);
        } catch (err) {
          if (isMounted) console.error('Failed to enable camera:', err);
        }

        // Attach teacher camera to hidden video for pose detection
        const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        if (camPub?.track && teacherVideoRef.current) {
          teacherVideoRef.current.srcObject = new MediaStream([camPub.track.mediaStreamTrack]);
          teacherVideoRef.current.play().catch(() => {/* autoplay */});
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
      connectPromise.catch(() => {}).finally(() => {
        room.disconnect();
      });
    };
  }, [livekitToken, updateParticipant]);

  // Re-attach teacher camera when connectedRoom changes
  useEffect(() => {
    if (!connectedRoom) return;
    const camPub = connectedRoom.localParticipant.getTrackPublication(Track.Source.Camera);
    if (camPub?.track && teacherVideoRef.current) {
      teacherVideoRef.current.srcObject = new MediaStream([camPub.track.mediaStreamTrack]);
      teacherVideoRef.current.play().catch(() => {/* autoplay */});
    }
  }, [connectedRoom]);

  // ─── Big-screen controls ───────────────────────────────────────────────────
  const openBigScreen = useCallback(() => {
    try {
      sessionStorage.setItem('bigscreen-snapshot', JSON.stringify(poseSnapshotRef.current));
      sessionStorage.setItem('bigscreen-sceneId', selectedSceneId);
      sessionStorage.setItem('bigscreen-vrmSourceId', selectedVrmSourceId);
    } catch {/* ignore */}

    const url = `${window.location.origin}/?screen=bigscreen`;
    const win = window.open(url, 'live-mr-bigscreen', 'width=1280,height=720,menubar=no,toolbar=no');
    bigScreenWindowRef.current = win;
  }, [selectedSceneId, selectedVrmSourceId]);

  // ─── Render ────────────────────────────────────────────────────────────────
  const studentList = Array.from(participants.values()).filter(
    (p) => !p.participant.identity.startsWith('host-'),
  );

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

        {/* ── 場景選擇器 ── */}
        <label htmlFor="scene-select" className="control-label">場景：</label>
        <select
          id="scene-select"
          className="control-select"
          value={selectedSceneId}
          onChange={(e) => handleSceneChange(e.target.value)}
        >
          {Object.values(SCENE_PRESETS).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>

        {/* ── 角色模型選擇器 ── */}
        <label htmlFor="vrm-select" className="control-label">角色：</label>
        <select
          id="vrm-select"
          className="control-select"
          value={selectedVrmSourceId}
          onChange={(e) => handleVrmChange(e.target.value)}
        >
          {Object.values(VRM_SOURCES).map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>

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

      {connectedRoom && <LocalVideo room={connectedRoom} poseData={teacherPoseData} />}

      <div className="student-grid">
        {studentList.map((info) => (
          <StudentTile
            key={info.participant.identity}
            participant={info.participant}
            videoTrack={info.videoTrack}
            poseData={info.poseData}
          />
        ))}
      </div>
    </div>
  );
}
