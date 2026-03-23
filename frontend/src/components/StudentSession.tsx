import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { usePoseDetection } from '../hooks/usePoseDetection.ts';

interface StudentSessionProps {
  roomId: string;
  token: string;
  name: string;
}

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL as string || 'ws://localhost:7880';

export default function StudentSession({ roomId, token, name }: StudentSessionProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [connected, setConnected] = useState(false);
  const roomRef = useRef<Room | null>(null);

  // Pose detection sends data via the room
  usePoseDetection(videoRef, roomRef);

  useEffect(() => {
    const room = new Room();
    roomRef.current = room;

    room.on(RoomEvent.Connected, () => setConnected(true));
    room.on(RoomEvent.Disconnected, () => setConnected(false));

    const connectAndPublish = async () => {
      try {
        await room.connect(LIVEKIT_URL, token);
        setConnected(true);
      } catch (e) {
        console.error("Room connection failed:", e);
        return;
      }

      // Publish local video
      await room.localParticipant.setCameraEnabled(true);

      // Attach local video to self-view
      const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (camPub?.track && videoRef.current) {
        const mediaTrack = camPub.track.mediaStreamTrack;
        const stream = new MediaStream([mediaTrack]);
        videoRef.current.srcObject = stream;
      }
    };

    connectAndPublish();

    return () => {
      room.disconnect();
      roomRef.current = null;
    };
  }, [token]);

  return (
    <div className="student-session">
      <div className="session-header">
        <h2>課堂進行中</h2>
        <span className="room-badge">房間: {roomId}</span>
        <span className="name-badge">{name}</span>
        <span className={`status-badge ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? '已連線' : '連線中...'}
        </span>
      </div>
      <div className="self-view">
        <video ref={videoRef} autoPlay playsInline muted />
      </div>
    </div>
  );
}
