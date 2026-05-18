import { useEffect, useRef, useState } from 'react'
import type { RemoteParticipant, RemoteTrackPublication } from 'livekit-client'
import { useVrmAvatar } from '../hooks/useVrmAvatar'
// import PoseDebugOverlay from './PoseDebugOverlay';
import type { PoseFrame } from '../types/vrm'
import type { MuteState } from '../hooks/useRecording'

interface StudentTileProps {
  participant: RemoteParticipant
  videoTrack: RemoteTrackPublication | null
  poseData: PoseFrame | null
  vrmSourceId?: string | null
  muteState?: MuteState
  onToggleMute?: (identity: string, trackType: 'audio' | 'video') => void
  slotLabel?: string | null
}

export default function StudentTile({
  participant,
  videoTrack,
  poseData,
  vrmSourceId,
  muteState,
  onToggleMute,
  slotLabel,
}: StudentTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { applyPose } = useVrmAvatar(canvasRef, { vrmSourceId })
  const [_, setVideoSize] = useState({ width: 320, height: 240 })

  const isCameraOff = muteState?.video === true

  // Attach video track
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    if (!videoTrack?.track || isCameraOff) {
      el.srcObject = null
      return
    }
    const mediaTrack = videoTrack.track.mediaStreamTrack
    const stream = new MediaStream([mediaTrack])
    el.srcObject = stream
    const handleLoadedMetadata = () => {
      if (el.clientWidth > 0) {
        setVideoSize({ width: el.clientWidth, height: el.clientHeight })
      }
    }
    el.addEventListener('loadedmetadata', handleLoadedMetadata)
    return () => {
      el.srcObject = null
      el.removeEventListener('loadedmetadata', handleLoadedMetadata)
    }
  }, [videoTrack, isCameraOff])

  // Apply pose data to VRM
  useEffect(() => {
    if (poseData && !isCameraOff) applyPose(poseData)
  }, [poseData, applyPose, isCameraOff])

  const labelText = slotLabel || '未指派'
  const identityText = participant.identity

  return (
    <div className="student-tile-new">
      {/* Top Video Area */}
      <div className="tile-main-view">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="tile-video-new"
          style={{ display: isCameraOff ? 'none' : 'block' }}
        />

        {isCameraOff && (
          <div className="camera-off-placeholder-new">
            {vrmSourceId === null && (
              <div className="placeholder-center-icon">
                <div className="rounded-rect" />
              </div>
            )}
          </div>
        )}

        {/* VRM canvas – key forces a fresh canvas on model switch so the new
            WebGLRenderer always gets a clean WebGL context */}
        {vrmSourceId !== null && (
          <canvas key={vrmSourceId} ref={canvasRef} className="avatar-canvas-new" />
        )}

        {/* Top Overlay Bar */}
        {/* <div className="tile-top-overlay">
          <span className="tile-id-badge">{identityText}</span>
          <span className="tile-status-badge">{labelText}</span>
        </div> */}

        {/* Bottom Right Mute Controls */}
        {onToggleMute && (
          <div className="tile-action-controls">
            <button
              className={`tile-action-btn ${muteState?.audio ? 'muted' : 'active'}`}
              onClick={() => onToggleMute(participant.identity, 'audio')}
              title={muteState?.audio ? '取消靜音' : '靜音'}
            >
              <span className="material-symbols-outlined">
                {muteState?.audio ? 'mic_off' : 'mic'}
              </span>
            </button>
            <button
              className={`tile-action-btn ${muteState?.video ? 'muted' : 'active'}`}
              onClick={() => onToggleMute(participant.identity, 'video')}
              title={muteState?.video ? '開啟鏡頭' : '關閉鏡頭'}
            >
              <span className="material-symbols-outlined">
                {muteState?.video ? 'videocam_off' : 'videocam'}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Bottom Info Bar */}
      <div className="tile-footer-bar">
        <span className="footer-id">{identityText}</span>
        <span className="footer-status">{labelText}</span>
      </div>
    </div>
  )
}
