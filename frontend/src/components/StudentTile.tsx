import { useEffect, useRef, useState } from 'react';
import type { RemoteParticipant, RemoteTrackPublication } from 'livekit-client';
import { useVrmAvatar } from '../hooks/useVrmAvatar';
import PoseDebugOverlay from './PoseDebugOverlay';

interface StudentTileProps {
  participant: RemoteParticipant;
  videoTrack: RemoteTrackPublication | null;
  poseData: any | null; // Using any to quickly access landmarks
}

export default function StudentTile({ participant, videoTrack, poseData }: StudentTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { applyPose } = useVrmAvatar(canvasRef);
  const [videoSize, setVideoSize] = useState({ width: 320, height: 240 });

  // Attach video track
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoTrack?.track) return;

    const mediaTrack = videoTrack.track.mediaStreamTrack;
    const stream = new MediaStream([mediaTrack]);
    el.srcObject = stream;

    const handleLoadedMetadata = () => {
      setVideoSize({
        width: el.clientWidth || 320,
        height: el.clientHeight || 240,
      });
    };
    el.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      el.srcObject = null;
      el.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [videoTrack]);

  // Apply pose data to VRM
  useEffect(() => {
    if (poseData) {
      applyPose(poseData);
      
      // Also update size if it hasn't been set correctly
      if (videoRef.current && (videoSize.width !== videoRef.current.clientWidth || videoSize.height !== videoRef.current.clientHeight)) {
        if (videoRef.current.clientWidth > 0) {
          setVideoSize({
            width: videoRef.current.clientWidth,
            height: videoRef.current.clientHeight,
          });
        }
      }
    }
  }, [poseData, applyPose, videoSize.width, videoSize.height]);

  const landmarks = poseData?.landmarks;

  return (
    <div className="student-tile" style={{ position: 'relative' }}>
      <video ref={videoRef} autoPlay playsInline muted className="tile-video" />
      <canvas ref={canvasRef} className="avatar-canvas" width={320} height={240} style={{ position: 'absolute', top: 0, left: 0, opacity: 0.8 }} />
      {landmarks && (
        <PoseDebugOverlay 
          landmarks={[landmarks]} 
          width={videoSize.width} 
          height={videoSize.height} 
        />
      )}
      <div className="student-name" style={{ position: 'absolute', bottom: 5, right: 5, background: 'rgba(0,0,0,0.5)', color: '#fff', padding: '2px 5px' }}>{participant.identity}</div>
    </div>
  );
}
