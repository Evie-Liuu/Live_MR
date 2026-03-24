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
import type { BigScreenMsg } from './BigScreen.tsx';

// ─── LocalVideo: teacher's self-view camera ────────────────────────────────
function LocalVideo({ room }: { room: Room }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const attachCamera = () => {
      const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (camPub?.track) {
        const stream = new MediaStream([camPub.track.mediaStreamTrack]);
        el.srcObject = stream;
      }
    };

    attachCamera();
    const handleLocalTrack = () => attachCamera();
    room.localParticipant.on('localTrackPublished', handleLocalTrack);

    return () => {
      room.localParticipant.off('localTrackPublished', handleLocalTrack);
      el.srcObject = null;
    };
  }, [room]);

  return (
    <div className="teacher-tile">
      <video ref={videoRef} autoPlay playsInline muted className="tile-video" />
      <div className="teacher-label">老師 (我)</div>
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

const LIVEKIT_URL = (import.meta.env.VITE_LIVEKIT_URL as string) || 'ws://localhost:7880';
const CHANNEL_NAME = 'live-mr-bigscreen';

// ─── Main component ──────────────────────────────────────────────────────────
export default function HostSession({ roomId, livekitToken }: HostSessionProps) {
  const [participants, setParticipants] = useState<Map<string, ParticipantInfo>>(new Map());
  const [connectedRoom, setConnectedRoom] = useState<Room | null>(null);
  const roomRef = useRef<Room | null>(null);

  // Big-screen pop-out window reference
  const bigScreenWindowRef = useRef<Window | null>(null);
  // BroadcastChannel to push pose data to big screen
  const channelRef = useRef<BroadcastChannel | null>(null);

  // Teacher's own video ref (for pose detection)
  const teacherVideoRef = useRef<HTMLVideoElement>(null);

  // Latest pose snapshot for all participants (used when opening big screen mid-session)
  const poseSnapshotRef = useRef<Record<string, unknown>>({});

  // ─── BroadcastChannel setup ───────────────────────────────────────────────
  useEffect(() => {
    const ch = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = ch;
    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, []);

  // ─── Teacher pose detection ───────────────────────────────────────────────
  // We reuse usePoseDetection but intercept via a custom roomRef that
  // publishes to LiveKit AND to the big screen channel.
  // Instead of a real Room, we pass a proxy roomRef that captures the data.
  const teacherPoseInterceptRef = useRef<Room | null>(null);

  // Override publish so we can capture teacher pose without publishing to LiveKit
  // (teacher is the host sender; no need to echo back).
  useEffect(() => {
    // Create a lightweight proxy object that satisfies the Room interface
    // enough for usePoseDetection to call publishData on it.
    const proxy = {
      localParticipant: {
        publishData: (_data: Uint8Array, _opts: unknown) => {
          // Decode and relay to big screen
          try {
            const text = new TextDecoder().decode(_data);
            const parsed = JSON.parse(text) as unknown;
            const identity = connectedRoom?.localParticipant.identity ?? 'host-teacher';
            poseSnapshotRef.current[identity] = parsed;
            const msg: BigScreenMsg = { type: 'pose', identity, poseData: parsed };
            channelRef.current?.postMessage(msg);
          } catch {/* ignore */ }
        },
      },
    } as unknown as Room;
    teacherPoseInterceptRef.current = proxy;
  }, [connectedRoom]);

  // Run pose detection using the teacher's camera video
  usePoseDetection(teacherVideoRef, teacherPoseInterceptRef);

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
      // Notify big screen to remove avatar
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
        const text = new TextDecoder().decode(payload);
        const data = JSON.parse(text) as unknown;

        console.log('handleDataReceived', data);


        // Update local React state (for StudentTile per-tile avatars)
        updateParticipant(participant.identity, (info) => ({
          ...info,
          poseData: data,
        }));

        // Relay to big screen
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
    
    connectPromise.then(async () => {
      if (!isMounted) return;
      setConnectedRoom(room);

      try {
        await room.localParticipant.setCameraEnabled(true);
      } catch (err) {
        if (isMounted) console.error('Failed to enable camera:', err);
      }

      // Attach teacher camera to hidden video element for pose detection
      const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (camPub?.track && teacherVideoRef.current) {
        const stream = new MediaStream([camPub.track.mediaStreamTrack]);
        teacherVideoRef.current.srcObject = stream;
        teacherVideoRef.current.play().catch(() => {/* autoplay */ });
      }

      for (const [, p] of room.remoteParticipants) {
        handleConnected(p);
        for (const [, pub] of p.trackPublications) {
          if (pub.kind === Track.Kind.Video && pub.track) {
            handleTrackSubscribed(pub.track, pub as RemoteTrackPublication, p);
          }
        }
      }
    }).catch((err) => {
      if (isMounted) {
        console.error('Failed to connect to room:', err);
      }
    });

    return () => {
      isMounted = false;
      setConnectedRoom(null);
      connectPromise.catch(() => {}).finally(() => {
        room.disconnect();
      });
    };
  }, [livekitToken, updateParticipant]);

  // Also attach camera to teacher video ref when connectedRoom changes
  useEffect(() => {
    if (!connectedRoom) return;
    const camPub = connectedRoom.localParticipant.getTrackPublication(Track.Source.Camera);
    if (camPub?.track && teacherVideoRef.current) {
      const stream = new MediaStream([camPub.track.mediaStreamTrack]);
      teacherVideoRef.current.srcObject = stream;
      teacherVideoRef.current.play().catch(() => {/* autoplay */ });
    }
  }, [connectedRoom]);

  // ─── Big-screen controls ───────────────────────────────────────────────────
  const openBigScreen = useCallback(() => {
    // Save current snapshot so the new window can prime its avatars
    try {
      sessionStorage.setItem('bigscreen-snapshot', JSON.stringify(poseSnapshotRef.current));
    } catch {/* ignore */ }

    const url = `${window.location.origin}/?screen=bigscreen`;
    const win = window.open(url, 'live-mr-bigscreen', 'width=1280,height=720,menubar=no,toolbar=no');
    bigScreenWindowRef.current = win;
  }, []);

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
        <button
          id="open-bigscreen-btn"
          className="bigscreen-btn"
          onClick={openBigScreen}
          title="在新視窗開啟大屏顯示"
        >
          🖥️ 開啟大屏
        </button>
      </div>

      {connectedRoom && <LocalVideo room={connectedRoom} />}

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
