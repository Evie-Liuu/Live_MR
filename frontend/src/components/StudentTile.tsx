import { useEffect, useRef } from 'react';
import type { RemoteParticipant, RemoteTrackPublication } from 'livekit-client';
import { useVrmAvatar } from '../hooks/useVrmAvatar.ts';

interface StudentTileProps {
  participant: RemoteParticipant;
  videoTrack: RemoteTrackPublication | null;
  poseData: unknown | null;
}

export default function StudentTile({ participant, videoTrack, poseData }: StudentTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { applyPose } = useVrmAvatar(canvasRef);

  // Attach video track
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoTrack?.track) return;

    const mediaTrack = videoTrack.track.mediaStreamTrack;
    const stream = new MediaStream([mediaTrack]);
    el.srcObject = stream;

    return () => {
      el.srcObject = null;
    };
  }, [videoTrack]);

  // Apply pose data to VRM
  useEffect(() => {
    if (poseData) {
      applyPose(poseData);
    }
  }, [poseData, applyPose]);

  return (
    <div className="student-tile">
      <video ref={videoRef} autoPlay playsInline muted className="tile-video" />
      <canvas ref={canvasRef} className="avatar-canvas" width={320} height={240} />
      <div className="student-name">{participant.identity}</div>
    </div>
  );
}
