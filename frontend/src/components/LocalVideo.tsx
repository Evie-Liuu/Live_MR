import { useEffect, useRef, useState } from 'react';
import type { Room } from 'livekit-client';
import { Track } from 'livekit-client';
import PoseDebugOverlay from './PoseDebugOverlay';
import type { PoseFrame } from '../types/vrm';
import { useVrmAvatar } from '../hooks/useVrmAvatar';
import { coverRect, POSE_STALE_MS, selfViewStatus } from '../utils/selfViewStatus.ts';

interface LocalVideoProps {
  room: Room;
  poseData?: unknown;
  vrmSourceId?: string | null;
  slotLabel?: string | null;
}

/** 左上角的追蹤狀態提示（沒入鏡、看不到手等）；先隱藏，要用時改成 true */
const SHOW_TRACKING_STATUS = true;
/** 檢查姿勢是否過時的間隔 */
const STALE_CHECK_MS = 400;

/**
 * 教師端自己的鏡頭畫面：照鏡子方向的影像，疊上角色與追蹤骨架（骨架對齊裁切後的影像）。
 */
export default function LocalVideo({ room, poseData, vrmSourceId, slotLabel }: LocalVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { applyPose } = useVrmAvatar(canvasRef, { vrmSourceId });
  /** 畫面容器與影像原始尺寸，用來算出 object-fit: cover 後影像的實際位置（骨架要對齊它） */
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [videoDims, setVideoDims] = useState({ width: 0, height: 0 });
  const lastPoseAtRef = useRef(0);
  const [stale, setStale] = useState(true);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const attachCamera = () => {
      const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (camPub?.track) {
        el.srcObject = new MediaStream([camPub.track.mediaStreamTrack]);
      }
    };
    // 鏡頭解析度可能中途改變（換鏡頭、低耗電模式），每次都重新讀
    const readDims = () => setVideoDims({ width: el.videoWidth, height: el.videoHeight });
    el.addEventListener('loadedmetadata', readDims);
    el.addEventListener('resize', readDims);

    attachCamera();
    room.localParticipant.on('localTrackPublished', attachCamera);

    return () => {
      room.localParticipant.off('localTrackPublished', attachCamera);
      el.srcObject = null;
      el.removeEventListener('loadedmetadata', readDims);
      el.removeEventListener('resize', readDims);
    };
  }, [room]);

  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 收到新的姿勢：驅動角色，並記錄時間（偵測不到人時不會再收到新的一幀）
  useEffect(() => {
    if (!poseData) return;
    applyPose(poseData);
    lastPoseAtRef.current = performance.now();
  }, [poseData, applyPose]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const next = performance.now() - lastPoseAtRef.current > POSE_STALE_MS;
      setStale(prev => (prev === next ? prev : next));
    }, STALE_CHECK_MS);
    return () => window.clearInterval(id);
  }, []);

  const landmarks = (poseData as PoseFrame | null)?.landmarks;
  const status = selfViewStatus(landmarks, stale);
  const rect = coverRect(box.width, box.height, videoDims.width, videoDims.height);
  const identityText = room.localParticipant.name || room.localParticipant.identity;
  const labelText = slotLabel || '未指派';

  return (
    <div className="student-tile-new teacher-tile-new">
      <div className="tile-main-view self-view" ref={viewRef}>
        <video ref={videoRef} autoPlay playsInline muted className="tile-video-new" />

        {vrmSourceId !== null && (
          <canvas key={vrmSourceId} ref={canvasRef} className="avatar-canvas-new" />
        )}

        {landmarks && !stale && (
          <div
            className="self-view-skeleton"
            style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
          >
            <PoseDebugOverlay
              landmarks={[landmarks as never]}
              width={Math.round(rect.width) || 320}
              height={Math.round(rect.height) || 240}
              mirrored
            />
          </div>
        )}

        {/* 左上：追蹤狀態（目前隱藏） */}
        {SHOW_TRACKING_STATUS && (
          <div className={`self-view-status self-view-status--${status.level}`} role="status" aria-live="polite">
            <span className="self-view-status-dot" aria-hidden="true" />
            {status.text}
          </div>
        )}
      </div>

      <div className="tile-footer-bar">
        <span className="footer-id">👨‍🏫 {identityText}</span>
        <span className="footer-status">{labelText}</span>
      </div>
    </div>
  );
}
