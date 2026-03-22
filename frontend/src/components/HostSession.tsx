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

interface HostSessionProps {
  roomId: string;
  livekitToken: string;
}

interface ParticipantInfo {
  participant: RemoteParticipant;
  videoTrack: RemoteTrackPublication | null;
  poseData: unknown | null;
}

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL as string || 'ws://localhost:7880';

export default function HostSession({ roomId, livekitToken }: HostSessionProps) {
  const [participants, setParticipants] = useState<Map<string, ParticipantInfo>>(new Map());
  const roomRef = useRef<Room | null>(null);

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
        updateParticipant(participant.identity, (info) => ({
          ...info,
          poseData: data,
        }));
      } catch {
        // ignore malformed data
      }
    };

    room.on(RoomEvent.ParticipantConnected, handleConnected);
    room.on(RoomEvent.ParticipantDisconnected, handleDisconnected);
    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed as never);
    room.on(RoomEvent.DataReceived, handleDataReceived as never);

    // Add existing participants
    room.connect(LIVEKIT_URL, livekitToken).then(() => {
      for (const [, p] of room.remoteParticipants) {
        handleConnected(p);
        for (const [, pub] of p.trackPublications) {
          if (pub.kind === Track.Kind.Video && pub.track) {
            handleTrackSubscribed(pub.track, pub as RemoteTrackPublication, p);
          }
        }
      }
    });

    return () => {
      room.disconnect();
    };
  }, [livekitToken, updateParticipant]);

  const participantList = Array.from(participants.values());

  return (
    <div className="host-session">
      <div className="session-header">
        <h2>課堂進行中</h2>
        <span className="room-badge">房間: {roomId}</span>
        <span className="count-badge">{participantList.length} 位學生</span>
      </div>
      <div className="student-grid">
        {participantList.map((info) => (
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
