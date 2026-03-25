import { useEffect, useRef, useState } from 'react';
import type { Room } from 'livekit-client';
import { Track } from 'livekit-client';
import PoseDebugOverlay from './PoseDebugOverlay';
import type { PoseFrame } from '../types/vrm';

interface LocalVideoProps {
  room: Room;
  poseData?: unknown;
}

/**
 * Teacher self-view tile: attaches the local camera track to a <video>
 * and overlays the pose debug skeleton if poseData is available.
 */
export default function LocalVideo({ room, poseData }: LocalVideoProps) {
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
