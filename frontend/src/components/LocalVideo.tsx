import { useEffect, useRef, useState } from 'react';
import type { Room } from 'livekit-client';
import { Track } from 'livekit-client';
import PoseDebugOverlay from './PoseDebugOverlay';
import type { PoseFrame } from '../types/vrm';
import { useVrmAvatar } from '../hooks/useVrmAvatar';

interface LocalVideoProps {
  room: Room;
  poseData?: unknown;
  vrmSourceId?: string | null;
  slotLabel?: string | null;
}

/**
 * Teacher self-view tile: attaches the local camera track to a <video>
 * and overlays the pose debug skeleton if poseData is available.
 */
export default function LocalVideo({ room, poseData, vrmSourceId, slotLabel }: LocalVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { applyPose } = useVrmAvatar(canvasRef, { vrmSourceId });
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

  // Apply pose to VRM avatar
  useEffect(() => {
    if (poseData) {
      applyPose(poseData);
    }
  }, [poseData, applyPose]);

  // Keep size in sync with poseData updates
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

  const landmarks = (poseData as PoseFrame | null)?.landmarks;
  const identityText = room.localParticipant.name || room.localParticipant.identity;
  const labelText = slotLabel || '未指派';

  return (
    <div className="student-tile-new teacher-tile-new">
      <div className="tile-main-view">
        <video ref={videoRef} autoPlay playsInline muted className="tile-video-new" />

        {vrmSourceId !== null && (
          <canvas ref={canvasRef} className="avatar-canvas-new" />
        )}

        {landmarks && (
          <PoseDebugOverlay
            landmarks={[landmarks as never]}
            width={videoSize.width}
            height={videoSize.height}
          />
        )}

        {/* Top Overlay Bar - Matching StudentTile's current state (commented out) */}
        {/* 
        <div className="tile-top-overlay">
          <span className="tile-id-badge">{identityText}</span>
          <span className="tile-status-badge">{labelText}</span>
        </div> 
        */}
      </div>

      <div className="tile-footer-bar">
        <span className="footer-id">👨‍🏫 {identityText}</span>
        <span className="footer-status">{labelText}</span>
      </div>
    </div>
  );
}
