import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { usePoseDetection } from '../hooks/usePoseDetection';
import PoseDebugOverlay from './PoseDebugOverlay';

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
  const [landmarks, setLandmarks] = useState<any[] | null>(null);
  const [videoSize, setVideoSize] = useState({ width: 320, height: 240 });

  // Pose detection sends data via the room
  usePoseDetection(videoRef, roomRef, (lms) => {
    if (videoRef.current) {
      setVideoSize({
        width: videoRef.current.clientWidth,
        height: videoRef.current.clientHeight,
      });
    }
    setLandmarks(lms);
  });

  useEffect(() => {
    let isMounted = true;
    const room = new Room();
    roomRef.current = room;

    room.on(RoomEvent.Connected, () => {
      if (isMounted) setConnected(true);
    });
    room.on(RoomEvent.Disconnected, () => {
      if (isMounted) setConnected(false);
    });

    // Capture the promise to handle cleanup safely
    const connectPromise = room.connect(LIVEKIT_URL, token);

    connectPromise
      .then(async () => {
        if (!isMounted) return;
        setConnected(true);

        try {
          await room.localParticipant.setCameraEnabled(true);
          if (!isMounted) return;

          // Attach local video to self-view
          const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
          if (camPub?.track && videoRef.current) {
            const mediaTrack = camPub.track.mediaStreamTrack;
            const stream = new MediaStream([mediaTrack]);
            videoRef.current.srcObject = stream;
          }
        } catch (e) {
          if (isMounted) {
            console.error("Failed to enable camera:", e);
          }
        }
      })
      .catch((e) => {
        if (isMounted) {
          console.error("Room connection failed:", e);
        }
      });

    return () => {
      isMounted = false;
      roomRef.current = null;
      // Ensure we only disconnect after the connection attempt has settled
      // to avoid "WebSocket is closed before the connection is established" warning.
      connectPromise.catch(() => { }).finally(() => {
        room.disconnect();
      });
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
      <div className="self-view" style={{ position: 'relative', display: 'inline-block' }}>
        <video ref={videoRef} autoPlay playsInline muted />
        {landmarks && (
          <PoseDebugOverlay
            landmarks={[landmarks]}
            width={videoSize.width}
            height={videoSize.height}
          />
        )}
      </div>
    </div>
  );
}
