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
}

export default function StudentTile({
  participant,
  videoTrack,
  poseData,
  vrmSourceId,
  muteState,
  onToggleMute,
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

  return (
    <div className="student-tile" style={{ position: 'relative' }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="tile-video"
        style={{ display: isCameraOff ? 'none' : 'block' }}
      />
      {isCameraOff && (
        <div
          className="camera-off-placeholder"
          style={{
            width: '100%',
            height: '100%',
            background: '#1a1a2e',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 6,
            color: '#888',
            fontSize: 13,
          }}
        >
          {/* 鏡頭關閉且無 VRM 才顯示圖示文字 */}
          {vrmSourceId === null && (
            <>
              <span style={{ fontSize: 28 }}>📷</span>
              <span>鏡頭已關閉</span>
            </>
          )}
        </div>
      )}
      {/* VRM canvas 永遠疊在最上層，不論鏡頭狀態 */}
      {vrmSourceId !== null && (
        <canvas
          ref={canvasRef}
          className="avatar-canvas"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            opacity: 0.9,
          }}
        />
      )}
      <div
        className="student-name"
        style={{
          position: 'absolute',
          bottom: 5,
          right: 5,
          background: 'rgba(0,0,0,0.5)',
          color: '#fff',
          padding: '2px 5px',
        }}
      >
        {participant.identity}
      </div>

      {onToggleMute && (
        <div
          className="mute-controls"
          style={{
            position: 'absolute',
            bottom: 5,
            left: 5,
            display: 'flex',
            gap: 4,
          }}
        >
          <button
            className={`mute-btn ${muteState?.audio ? 'muted' : 'active'}`}
            onClick={() => onToggleMute(participant.identity, 'audio')}
            title={muteState?.audio ? '取消靜音' : '靜音'}
          >
            {muteState?.audio ? '🔇' : '🎤'}
          </button>
          <button
            className={`mute-btn ${muteState?.video ? 'muted' : 'active'}`}
            onClick={() => onToggleMute(participant.identity, 'video')}
            title={muteState?.video ? '開啟鏡頭' : '關閉鏡頭'}
          >
            {muteState?.video ? '📷' : '📹'}
          </button>
        </div>
      )}
    </div>
  )
}
