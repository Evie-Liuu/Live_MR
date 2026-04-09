import { useEffect, useRef, useState, useCallback } from 'react';
import { Room, RoomEvent, Track, RemoteParticipant, Participant } from 'livekit-client';
import { usePoseDetection } from '../hooks/usePoseDetection';
import type { PoseLandmark } from '../types/vrm';
import PoseDebugOverlay from './PoseDebugOverlay';
import { LIVEKIT_URL } from '../config/constants.ts';

interface StudentSessionProps {
  roomId: string;
  token: string;
  name: string;
}

/** 判斷是否為行動裝置（手機 / 平板），支援 touch 事件且非桌機 */
function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const isIPad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const hasTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  return hasTouch && (!/Macintosh/.test(navigator.userAgent) || isIPad);
}

export default function StudentSession({ roomId, token, name }: StudentSessionProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [connected, setConnected] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const [landmarks, setLandmarks] = useState<PoseLandmark[] | null>(null);
  // 追蹤目前本地預覽用的 stream，確保切換鏡頭時能正確釋放
  const displayStreamRef = useRef<MediaStream | null>(null);
  const [videoSize, setVideoSize] = useState({ width: 320, height: 240 });
  const [faceEnabled, setFaceEnabled] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const isMobile = isMobileDevice();
  const [isSwitchingCamera, setIsSwitchingCamera] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const publishPose = useCallback(
    (data: Uint8Array) => {
      const room = roomRef.current;
      if (room?.state === 'connected') {
        room.localParticipant.publishData(data, { reliable: false });
      }
    },
    [], // roomRef is a stable ref, empty deps is correct
  );

  usePoseDetection(videoRef, publishPose, (lms) => {
    if (videoRef.current) {
      setVideoSize({
        width: videoRef.current.clientWidth,
        height: videoRef.current.clientHeight,
      });
    }
    setLandmarks(lms);
  }, faceEnabled);

  useEffect(() => {
    let isMounted = true;
    const room = new Room();
    roomRef.current = room;

    const checkHostMetadata = (p: Participant) => {
      if (p.identity.startsWith('host-') && p.metadata) {
        try {
          const data = JSON.parse(p.metadata);
          if (typeof data.faceEnabled === 'boolean' && isMounted) {
            setFaceEnabled(data.faceEnabled);
          }
        } catch { /* ignore */ }
      }
    };

    room.on(RoomEvent.Connected, () => {
      if (isMounted) setConnected(true);
      // Initial check for host metadata if they are already in the room
      for (const [, p] of room.remoteParticipants) {
        checkHostMetadata(p);
      }
    });

    room.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
      checkHostMetadata(p);
    });

    room.on(RoomEvent.ParticipantMetadataChanged, (_metadata: string | undefined, p: Participant) => {
      checkHostMetadata(p);
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
          // 直接使用 getUserMedia 取得鏡頭串流，確保 iPad Safari 相容（與 webcamtests.com 相同方式）
          // 再透過 publishTrack 發布至 LiveKit，避免 setCameraEnabled + attach() 在 iPad 上的問題
          let stream: MediaStream;
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: isMobile ? { facingMode: 'user' } : true,
            });
          } catch {
            stream = await navigator.mediaDevices.getUserMedia({ video: true });
          }

          if (!isMounted) return;

          // 直接設定 srcObject + play()，確保 iPad Safari 顯示畫面
          displayStreamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(() => { });
          }

          // Safari/WebKit 限制：同一個 MediaStreamTrack 不能同時被 video element
          // 渲染又被 RTCPeerConnection.addTrack() 使用，否則 video element 會變黑畫面。
          // 解法：publish 給 LiveKit 的用 clone()，本地顯示用原始 stream。
          await room.localParticipant.publishTrack(stream.getVideoTracks()[0].clone(), {
            source: Track.Source.Camera,
          });
          await room.localParticipant.setMicrophoneEnabled(true);
        } catch (e) {
          if (isMounted) {
            console.error("Failed to enable camera/microphone:", e);
          }
        }
      })
      .catch((e) => {
        if (isMounted) {
          console.error("Room connection failed:", e);
          setConnectionError(String(e));
        }
      });

    return () => {
      isMounted = false;
      roomRef.current = null;
      // 釋放本地預覽的 camera stream
      if (displayStreamRef.current) {
        displayStreamRef.current.getTracks().forEach(t => t.stop());
        displayStreamRef.current = null;
      }
      // 立即斷線，避免 React StrictMode 開發環境下兩次 mount 用同一 identity 搶連線。
      // 若連線尚未建立則 disconnect() 內部會安全忽略。
      room.disconnect();
    };
  }, [token]);

  // Publish metadata whenever faceEnabled changes (or on connect)
  // useEffect(() => {
  //   const room = roomRef.current;
  //   if (!connected || !room || room.state !== 'connected') return;
  //   const metadata = JSON.stringify({ faceEnabled });
  //   room.localParticipant.setMetadata(metadata);
  // }, [connected, faceEnabled]);

  /** 切換前/後鏡頭 */
  const switchCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room || room.state !== 'connected' || isSwitchingCamera) return;

    const nextFacing = facingMode === 'user' ? 'environment' : 'user';
    setIsSwitchingCamera(true);
    try {
      // 行動裝置用 exact 精確指定前/後鏡頭；桌機用 ideal 不強制（避免 OverconstrainedError）
      const constraint = isMobile
        ? { facingMode: { exact: nextFacing } }
        : { facingMode: { ideal: nextFacing } };
      const newStream = await navigator.mediaDevices.getUserMedia({ video: constraint });
      const newTrack = newStream.getVideoTracks()[0];

      // 取得目前已發布的 camera publication
      const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (camPub?.track) {
        // 停止舊的本地預覽 stream
        if (displayStreamRef.current) {
          displayStreamRef.current.getTracks().forEach(t => t.stop());
        }
        displayStreamRef.current = newStream;

        // 更新自畫面預覽（直接設 srcObject，確保 iPad Safari 顯示）
        if (videoRef.current) {
          videoRef.current.srcObject = newStream;
          videoRef.current.play().catch(() => { });
        }

        // 同樣用 clone() 給 LiveKit，避免 Safari track 共用導致 video 黑畫面
        await camPub.track.replaceTrack(newTrack.clone());
      }

      setFacingMode(nextFacing);
    } catch (err) {
      console.error('切換鏡頭失敗:', err);
    } finally {
      setIsSwitchingCamera(false);
    }
  }, [facingMode, isSwitchingCamera]);

  return (
    <div className="student-session">
      <div className="session-header">
        <h2>課堂進行中</h2>
        <span className="room-badge">房間: {roomId}</span>
        <span className="name-badge">{name}</span>
        <span className={`status-badge ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? '已連線' : connectionError ? '連線失敗' : '連線中...'}
        </span>
        {connectionError && (
          <span style={{ color: '#f87171', fontSize: '0.75em', marginLeft: 8 }}>
            {connectionError}
          </span>
        )}
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
        {/* 連線後顯示切換鏡頭按鈕（行動裝置前/後鏡頭；桌機視裝置支援情況）*/}
        {connected && (
          <button
            onClick={switchCamera}
            disabled={isSwitchingCamera}
            title={facingMode === 'user' ? '切換到後鏡頭（外）' : '切換到前鏡頭（內）'}
            style={{
              position: 'absolute',
              bottom: '8px',
              right: '8px',
              background: 'rgba(0,0,0,0.55)',
              border: '1.5px solid rgba(255,255,255,0.35)',
              borderRadius: '50%',
              width: '44px',
              height: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: isSwitchingCamera ? 'not-allowed' : 'pointer',
              opacity: isSwitchingCamera ? 0.5 : 1,
              transition: 'opacity 0.2s',
              zIndex: 10,
            }}
          >
            {/* 相機旋轉 SVG icon */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 7h-3.5l-2-3h-5l-2 3H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="13" r="3" />
              <path d="M15 3l2 2-2 2" />
              <path d="M9 3L7 5l2 2" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
