import { useEffect, useRef, useState, useCallback } from 'react';
import { Room, RoomEvent, Track, RemoteParticipant, Participant } from 'livekit-client';
import { DisconnectReason } from '@livekit/protocol';
import { usePoseDetection } from '../hooks/usePoseDetection';
import type { PoseLandmark } from '../types/vrm';
import PoseDebugOverlay from './PoseDebugOverlay';
import { LIVEKIT_URL } from '../config/constants.ts';
import type { AIHintPayload } from '../config/aiAssistant.ts';
import { buildStudentExtendPrompt } from '../config/aiAssistant.ts';
import { generateHint, toFriendlyError } from '../utils/geminiClient.ts';

interface StudentSessionProps {
  roomId: string;
  token: string;
  name: string;
  onExit: () => void;
}

/** 判斷是否為行動裝置（手機 / 平板），支援 touch 事件且非桌機 */
function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const isIPad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const hasTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  return hasTouch && (!/Macintosh/.test(navigator.userAgent) || isIPad);
}

export default function StudentSession({ roomId, token, name, onExit }: StudentSessionProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [connected, setConnected] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const [landmarks, setLandmarks] = useState<PoseLandmark[] | null>(null);
  // 追蹤目前本地預覽用的 stream，確保切換鏡頭時能正確釋放
  const displayStreamRef = useRef<MediaStream | null>(null);
  const [videoSize, setVideoSize] = useState({ width: 320, height: 240 });
  const [faceEnabled, setFaceEnabled] = useState(true);
  const [handEnabled, _] = useState(faceEnabled);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const isMobile = isMobileDevice();
  const [isSwitchingCamera, setIsSwitchingCamera] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [kicked, setKicked] = useState(false);
  const [hostLeft, setHostLeft] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const MAX_RETRIES = 3;
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 教師端離線寬限期 — 重整/網路短暫斷線時不立刻把學生踢到「課堂已結束」畫面,
  // 給老師 N 秒重連回來;期間若有任何 host-* 重新加入就取消倒數。
  const hostGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const HOST_GRACE_PERIOD_MS = 15000;
  const [aiHint, setAiHint] = useState<AIHintPayload | null>(null);
  const [interactionPhase, setInteractionPhase] = useState<
    'idle' | 'teacher' | 'generating' | 'student'
  >('idle');
  const [showSource, setShowSource] = useState(false);
  const [extension, setExtension] = useState<string | null>(null);
  const [extending, setExtending] = useState(false);
  const [extendError, setExtendError] = useState<string | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);

  // ── 拖曳移動 & 縮放提示卡片 ──────────────────────────────────────────────
  const cardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const reszRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originW: number;
    originH: number;
  } | null>(null);

  const handleCardDragStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;
    // Resolve actual pixel position from current rendered rect (works whether
    // the card is CSS-centered via transform or already explicitly positioned)
    const rect = card.getBoundingClientRect();
    card.style.left = `${rect.left}px`;
    card.style.top = `${rect.top}px`;
    card.style.transform = 'none';
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: rect.left,
      originY: rect.top,
    };
    card.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, []);

  const handleResizeStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;
    reszRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originW: card.offsetWidth,
      originH: card.offsetHeight,
    };
    card.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleCardDragMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const resz = reszRef.current;
    const card = cardRef.current;
    if (!card) return;
    if (drag && e.pointerId === drag.pointerId) {
      const x = drag.originX + (e.clientX - drag.startX);
      const y = drag.originY + (e.clientY - drag.startY);
      const maxX = window.innerWidth - card.offsetWidth;
      const maxY = window.innerHeight - card.offsetHeight;
      card.style.left = `${Math.max(0, Math.min(x, maxX))}px`;
      card.style.top = `${Math.max(0, Math.min(y, maxY))}px`;
    } else if (resz && e.pointerId === resz.pointerId) {
      const newW = Math.max(300, resz.originW + (e.clientX - resz.startX));
      card.style.width = `${newW}px`;
      card.style.maxWidth = 'none';

      // Temporarily set height to auto to measure the natural content height at the new width
      const prevHeight = card.style.height;
      card.style.height = 'auto';
      const naturalHeight = card.scrollHeight;
      card.style.height = prevHeight;

      // Ensure height does not go below the natural height to avoid content compression
      const newH = Math.max(naturalHeight, resz.originH + (e.clientY - resz.startY));
      card.style.height = `${newH}px`;
    }
  }, []);

  const handleCardDragEnd = useCallback(() => {
    dragRef.current = null;
    reszRef.current = null;
  }, []);

  // 內容區塊展開/收合時，若有固定高度且自然高度超過目前高度，自動把卡片撐高（不縮）
  useEffect(() => {
    const card = cardRef.current;
    if (!card || !card.style.height || isMinimized) return;
    const prevHeight = card.style.height;
    card.style.height = 'auto';
    const natural = card.scrollHeight;
    card.style.height = prevHeight;
    // if (natural > card.clientHeight) {
    card.style.height = `${natural}px`;
    // }
  }, [showSource, extension, extending, extendError, aiHint, isMinimized, interactionPhase]);

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
  }, faceEnabled, handEnabled);

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
      if (isMounted) {
        setConnected(true);
        setConnectionError(null);
        // NOTE: do NOT setRetryCount(0) here — retryCount is a useEffect dep,
        // resetting it would trigger cleanup (room.disconnect) on a live connection.
      }
      // Initial check for host metadata if they are already in the room
      for (const [, p] of room.remoteParticipants) {
        checkHostMetadata(p);
      }
    });

    room.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
      checkHostMetadata(p);
      // 教師重連回來 — 取消任何進行中的「課堂已結束」倒數
      if (p.identity.startsWith('host-') && hostGraceTimerRef.current) {
        clearTimeout(hostGraceTimerRef.current);
        hostGraceTimerRef.current = null;
      }
    });

    room.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
      if (!isMounted || !p.identity.startsWith('host-')) return;
      // 若房內還有其他 host-*(多教師情境),不啟動倒數
      const stillHasHost = Array.from(room.remoteParticipants.values()).some(
        (rp) => rp.identity.startsWith('host-'),
      );
      if (stillHasHost) return;
      // 啟動寬限期 — 期間若 host 重連會在 ParticipantConnected 取消
      if (hostGraceTimerRef.current) clearTimeout(hostGraceTimerRef.current);
      hostGraceTimerRef.current = setTimeout(() => {
        hostGraceTimerRef.current = null;
        if (isMounted) setHostLeft(true);
      }, HOST_GRACE_PERIOD_MS);
    });

    room.on(RoomEvent.ParticipantMetadataChanged, (_metadata: string | undefined, p: Participant) => {
      checkHostMetadata(p);
    });

    room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      if (!isMounted) return;
      setConnected(false);
      if (reason === DisconnectReason.PARTICIPANT_REMOVED) {
        setKicked(true);
      }
    });

    room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant) => {
      if (!participant?.identity.startsWith('host-')) return;
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload)) as {
          type?: string;
          payload?: AIHintPayload;
          phase?: 'idle' | 'teacher' | 'generating' | 'student';
        };
        if (msg.type === 'ai-hint') {
          const p = msg.payload ?? null;
          if (isMounted) {
            setAiHint(p && p.content ? p : null);
            // New hint arrived from teacher — drop any stale student-side extension
            setExtension(null);
            setExtendError(null);
          }
        } else if (msg.type === 'interaction-phase' && msg.phase) {
          if (isMounted) setInteractionPhase(msg.phase);
        }
      } catch { /* pose / other messages */ }
    });

    // Capture the promise to handle cleanup safely
    const connectPromise = room.connect(LIVEKIT_URL, token);

    connectPromise
      .then(async () => {
        if (!isMounted) return;
        setConnected(true);
        setConnectionError(null);

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
        if (!isMounted) return;
        console.error("Room connection failed:", e);
        // 自動重試：指數退避，最多 MAX_RETRIES 次
        // retryCount 從 closure 讀取（此次 effect 執行時的值），避免在 state updater 中做 side effect
        const next = retryCount + 1;
        if (next <= MAX_RETRIES) {
          const delay = Math.min(2000 * Math.pow(2, retryCount), 16000); // 2s, 4s, 8s
          console.log(`Retrying connection in ${delay}ms (attempt ${next}/${MAX_RETRIES})...`);
          retryTimerRef.current = setTimeout(() => {
            if (isMounted) setRetryCount(next);
          }, delay);
        } else {
          setConnectionError(String(e));
        }
      });

    return () => {
      isMounted = false;
      roomRef.current = null;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (hostGraceTimerRef.current) {
        clearTimeout(hostGraceTimerRef.current);
        hostGraceTimerRef.current = null;
      }
      // 釋放本地預覽的 camera stream
      if (displayStreamRef.current) {
        displayStreamRef.current.getTracks().forEach(t => t.stop());
        displayStreamRef.current = null;
      }
      // 立即斷線，避免 React StrictMode 開發環境下兩次 mount 用同一 identity 搶連線。
      // 若連線尚未建立則 disconnect() 內部會安全忽略。
      room.disconnect();
    };
  }, [token, retryCount]);

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

  const handleExtend = useCallback(async () => {
    if (!aiHint?.content || !aiHint.sourceText || extending) return;
    setExtending(true);
    setExtendError(null);
    try {
      const result = await generateHint(
        buildStudentExtendPrompt(aiHint.sourceText, aiHint.content),
      );
      setExtension(result.text);
    } catch (e) {
      setExtendError(toFriendlyError(e));
    } finally {
      setExtending(false);
    }
  }, [aiHint, extending]);

  const speakExtension = useCallback(() => {
    if (!extension) return;
    try {
      const u = new SpeechSynthesisUtterance(extension);
      u.lang = 'en-US';
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }, [extension]);

  const sendStudentDone = useCallback(() => {
    const room = roomRef.current;
    if (!room || room.state !== 'connected') return;
    try {
      const bytes = new TextEncoder().encode(JSON.stringify({ type: 'student-done' }));
      // publishData returns a Promise; swallow async rejection too (we already optimistically
      // flipped phase to 'teacher'; teacher's authoritative re-broadcast or the 輪到自己 escape
      // covers the lost-message case).
      void room.localParticipant.publishData(bytes, { reliable: true }).catch(() => { /* ignore */ });
    } catch { /* ignore */ }
  }, []);

  const handleStudentDoneClick = useCallback(() => {
    // 樂觀本地切回 teacher（隱藏卡）；老師端會用權威 phase 廣播確認
    setInteractionPhase('teacher');
    sendStudentDone();
  }, [sendStudentDone]);

  const initials = name ? name.substring(0, 2).toLowerCase() : 'ss';

  if (kicked) {
    return (
      <div className="student-kicked-screen">
        <div className="student-kicked-card">
          <div className="student-kicked-icon-wrapper">
            <span className="material-symbols-outlined student-kicked-icon">person_remove</span>
          </div>
          <h2 className="student-kicked-title">
            <span className="title-orange">已被</span>
            <span className="title-teal">移出教室</span>
          </h2>
          <p className="student-kicked-subtitle">老師已將你從課堂移出。</p>
          <button className="student-kicked-back-btn" onClick={onExit}>
            返回首頁
          </button>
        </div>
      </div>
    );
  }

  if (hostLeft) {
    return (
      <div className="student-kicked-screen">
        <div className="student-kicked-card">
          <div className="student-kicked-icon-wrapper student-kicked-icon-wrapper--ended">
            <span className="material-symbols-outlined student-kicked-icon student-kicked-icon--ended">meeting_room</span>
          </div>
          <h2 className="student-kicked-title">
            <span className="title-orange">課堂</span>
            <span className="title-teal">已結束</span>
          </h2>
          <p className="student-kicked-subtitle">老師已離開房間，本次課堂結束。</p>
          <button className="student-kicked-back-btn" onClick={onExit}>
            返回首頁
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="student-session-container">
      <div className="student-session-header">
        <div className="room-id-box">
          房間：{roomId}
        </div>
        <div className="connection-status-pill">
          {connected ? '已連線' : connectionError ? '連線失敗' : '連線中...'}
        </div>
        <div className="user-initials-circle">
          {initials}
        </div>
      </div>

      <div className="student-main-card">
        <div className="video-container-new">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ display: connected ? 'block' : 'none' }}
          />

          {(!connected || !videoRef.current?.srcObject) && (
            <div className="video-placeholder-new">
              <span className="material-symbols-outlined no-video-icon">
                videocam_off
              </span>
            </div>
          )}

          {landmarks && (
            <PoseDebugOverlay
              landmarks={[landmarks]}
              width={videoSize.width}
              height={videoSize.height}
            />
          )}

          {/* 切換鏡頭按鈕（保留功能但隱藏，如圖所示）*/}
          {false && connected && (
            <button
              onClick={switchCamera}
              disabled={isSwitchingCamera}
              className="tile-action-btn"
              style={{
                position: 'absolute',
                bottom: '16px',
                right: '16px',
                zIndex: 10,
              }}
            >
              <span className="material-symbols-outlined">flip_camera_ios</span>
            </button>
          )}
        </div>
        <button
          className="student-session-exit-btn tile-action-btn--danger"
          title="離開課堂"
          onClick={() => setShowExitConfirm(true)}
        >
          <span className="material-symbols-outlined">logout</span>
        </button>
      </div>

      {/* 連線中重試提示 */}
      {!connected && !connectionError && retryCount > 0 && retryCount <= MAX_RETRIES && (
        <div style={{ color: '#facc15', fontSize: '0.85rem', marginTop: 12, textAlign: 'center' }}>
          連線重試中… ({retryCount}/{MAX_RETRIES})
        </div>
      )}

      {/* 輪到學生說話時的整合面板（保留老師提示功能：延伸 / 原話 / 拖曳 / 縮放 / 最小化） */}
      {interactionPhase === 'student' && (
        <div
          className={`ss-ai-card ss-ai-card--turn${isMinimized ? ' ss-ai-card--minimized' : ''}`}
          ref={cardRef}
          onPointerMove={handleCardDragMove}
          onPointerUp={handleCardDragEnd}
          onPointerCancel={handleCardDragEnd}
          role="dialog"
          aria-modal="false"
          aria-labelledby="ss-turn-title"
        >
          <div
            className="ss-ai-card-header"
            onPointerDown={handleCardDragStart}
          >
            <span className="ss-ai-card-icon ss-ai-card-icon--mic">
              <span className="material-symbols-outlined">mic</span>
            </span>
            <span id="ss-turn-title" className="ss-ai-card-title">輪到你說話了</span>
            {aiHint?.content && (
              <span className={`ss-ai-mode-badge ai-mode--${aiHint.mode}`}>
                {aiHint.mode === 'complete' ? '完整' : aiHint.mode === 'rearrange' ? '重組' : '延伸'}
              </span>
            )}
            <button
              className="ss-ai-card-minimize"
              title={isMinimized ? '展開' : '最小化'}
              onClick={() => setIsMinimized(v => !v)}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <span className="material-symbols-outlined">
                {isMinimized ? 'expand_more' : 'expand_less'}
              </span>
            </button>
          </div>

          {!isMinimized && (
            <>
              <div className="ss-ai-card-body">
                {aiHint?.content ? (
                  aiHint.mode === 'rearrange'
                    ? <div className="ss-ai-chips">{aiHint.content.split(' ').map((w, i) => <span key={i} className="ai-chip">{w}</span>)}</div>
                    : <div className="ss-ai-content">{aiHint.content}</div>
                ) : (
                  <div className="ss-ai-content ss-ai-content--empty">（尚無提示）</div>
                )}
              </div>

              {/* 延伸提示（rearrange / complete 才顯示；extend 已是延伸版） */}
              {aiHint?.content && aiHint.mode !== 'extend' && aiHint.sourceText && (
                <div className="ss-ai-extend">
                  {!extension && !extending && (
                    <button
                      className="ss-ai-extend-btn"
                      onClick={handleExtend}
                      disabled={extending}
                    >
                      <span className="material-symbols-outlined">auto_awesome</span>
                      延伸提示
                    </button>
                  )}
                  {extending && (
                    <div className="ss-ai-extend-loading">AI 生成中…</div>
                  )}
                  {extendError && (
                    <div className="ss-ai-extend-error">{extendError}</div>
                  )}
                  {extension && (
                    <div className="ss-ai-extend-result">
                      <div className="ss-ai-extend-label">延伸</div>
                      <div className="ss-ai-extend-text">{extension}</div>
                      <div className="ss-ai-extend-actions">
                        <button
                          className="ss-ai-extend-action"
                          title="朗讀"
                          onClick={speakExtension}
                        >
                          <span className="material-symbols-outlined">volume_up</span>
                        </button>
                        <button
                          className="ss-ai-extend-action"
                          title="再延伸一次"
                          onClick={handleExtend}
                          disabled={extending}
                        >
                          <span className="material-symbols-outlined">refresh</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {aiHint?.sourceText && (
                <div className="ss-ai-source">
                  <button className="ss-ai-source-toggle" onClick={() => setShowSource(v => !v)}>
                    {showSource ? '▴' : '▾'} 老師原話
                  </button>
                  {showSource && <div className="ss-ai-source-text">"{aiHint.sourceText}"</div>}
                </div>
              )}

              <div className="ss-ai-card-action">
                <button className="ss-turn-done-btn" onClick={handleStudentDoneClick} autoFocus>
                  ✓ 說完了
                </button>
              </div>

              {/* 縮放把手 */}
              <div
                className="ss-ai-card-resize-handle"
                onPointerDown={handleResizeStart}
              />
            </>
          )}
        </div>
      )}

      {/* 連線失敗畫面 */}
      {connectionError && (
        <div className="connection-error-overlay">
          <div className="connection-error-card">
            <span className="material-symbols-outlined connection-error-icon">signal_disconnected</span>
            <h3 className="connection-error-title">無法連接伺服器</h3>
            <p className="connection-error-detail">{connectionError}</p>
            <p className="connection-error-hint">
              請確認網路連線正常，且伺服器已啟動。
            </p>
            <div className="connection-error-actions">
              <button
                className="connection-retry-btn"
                onClick={() => {
                  setConnectionError(null);
                  setRetryCount(0);
                }}
              >
                <span className="material-symbols-outlined">refresh</span>
                重新連線
              </button>
              <button
                className="connection-back-btn"
                onClick={() => window.location.reload()}
              >
                返回
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 離開課堂確認 modal */}
      {showExitConfirm && (
        <div className="ss-confirm-backdrop" onClick={() => setShowExitConfirm(false)}>
          <div className="ss-confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="ss-confirm-icon-wrapper">
              <span className="material-symbols-outlined ss-confirm-icon">logout</span>
            </div>
            <h3 className="ss-confirm-title">離開課堂</h3>
            <p className="ss-confirm-body">確定要離開課堂並返回首頁嗎？</p>
            <div className="ss-confirm-actions">
              <button
                className="ss-confirm-btn ss-confirm-btn--cancel"
                onClick={() => setShowExitConfirm(false)}
              >
                取消
              </button>
              <button
                className="ss-confirm-btn ss-confirm-btn--confirm"
                onClick={onExit}
              >
                確認離開
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
