import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectionQuality, RoomEvent, Track, type Participant, type RemoteParticipant, type Room } from 'livekit-client';
import { BIGSCREEN_CHANNEL_NAME } from '../config/constants';
import {
  buildPerfReport,
  describeDevice,
  perfGauge,
  sanitizeDevice,
  sanitizeMetrics,
  summarizeInboundVideo,
  type InboundVideoRow,
  type PerfDevice,
  type PerfEvent,
  type PerfSample,
} from '../utils/perfRecorder';
import { PERF_HEARTBEAT_MS, usePerfSampler } from './usePerfSampler';

const HOST_SAMPLE_MS = 1000;
const VIDEO_STATS_MS = 5000;
/** 停止後等平板和大屏送完最後一筆的時間 */
const FINAL_SAMPLE_WAIT_MS = 2000;

function downloadReport(report: unknown, startedAt: number) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report)], { type: 'application/json' }));
  const stamp = new Date(startedAt).toISOString().slice(0, 19).replace(/[-:T]/g, '');
  const a = document.createElement('a');
  a.href = url;
  a.download = `live-mr-perf-${stamp}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function readInboundVideo(room: Room): Promise<InboundVideoRow[]> {
  const rows: InboundVideoRow[] = [];
  for (const participant of room.remoteParticipants.values()) {
    const publication = participant.getTrackPublication(Track.Source.Camera);
    const report = await publication?.track?.getRTCStatsReport?.();
    report?.forEach((stat) => {
      if (stat.type !== 'inbound-rtp' || stat.kind !== 'video') return;
      rows.push({
        id: `${participant.identity}/${stat.id}`,
        fps: typeof stat.framesPerSecond === 'number' ? stat.framesPerSecond : null,
        bytesReceived: stat.bytesReceived ?? 0,
        packetsLost: stat.packetsLost ?? 0,
        framesDropped: stat.framesDropped ?? 0,
        jitter: typeof stat.jitter === 'number' ? stat.jitter : null,
      });
    });
  }
  return rows;
}

/**
 * 教師端：Alt+Shift+P 開始／停止記錄。把大屏和每台平板回傳的取樣、自己的指標與事件放在同一條時間軸上，
 * 停止時下載一個 JSON。
 */
export function usePerfRecording(room: Room | null, roomId: string, taskLabel: string) {
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const samplesRef = useRef<PerfSample[]>([]);
  const eventsRef = useRef<PerfEvent[]>([]);
  const devicesRef = useRef<Record<string, PerfDevice>>({});
  const startedAtRef = useRef(0);

  const logEvent = useCallback((label: string) => {
    eventsRef.current.push({ t: Date.now(), label });
  }, []);

  const toggle = useCallback(() => {
    if (saving) return;
    if (!recording) {
      samplesRef.current = [];
      eventsRef.current = [];
      devicesRef.current = { host: describeDevice() };
      startedAtRef.current = Date.now();
      setRecording(true);
      return;
    }
    const stoppedAt = Date.now();
    setRecording(false);
    setSaving(true);
    // 等平板和大屏送完最後一筆再下載
    window.setTimeout(() => {
      downloadReport(buildPerfReport({
        roomId,
        startedAt: startedAtRef.current,
        stoppedAt,
        devices: devicesRef.current,
        events: eventsRef.current,
        samples: samplesRef.current,
      }), startedAtRef.current);
      startedAtRef.current = 0;
      samplesRef.current = [];
      eventsRef.current = [];
      setSaving(false);
    }, FINAL_SAMPLE_WAIT_MS);
  }, [recording, saving, roomId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && e.code === 'KeyP' && !e.repeat) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);

  usePerfSampler(
    recording,
    HOST_SAMPLE_MS,
    (metrics) => samplesRef.current.push({ t: Date.now(), source: 'host', metrics }),
    () => {
      if (!room) return;
      let weak = 0;
      for (const participant of room.remoteParticipants.values()) {
        if (participant.connectionQuality === ConnectionQuality.Poor || participant.connectionQuality === ConnectionQuality.Lost) weak += 1;
      }
      perfGauge('participants', room.remoteParticipants.size);
      perfGauge('participantsWeakConnection', weak);
    },
  );

  /** 平板回傳的一筆取樣（HostSession 收到 perf-sample 時呼叫） */
  const addStudentSample = useCallback((identity: string, msg: { metrics?: unknown; device?: unknown }) => {
    if (startedAtRef.current === 0) return;
    const metrics = sanitizeMetrics(msg.metrics);
    if (metrics) samplesRef.current.push({ t: Date.now(), source: 'student', identity, metrics });
    const device = sanitizeDevice(msg.device);
    if (device) devicesRef.current[identity] = device;
  }, []);

  // 開始／停止訊號：記錄中定期重送，晚進來或重連的裝置也會開始記錄
  useEffect(() => {
    const channel = new BroadcastChannel(BIGSCREEN_CHANNEL_NAME);
    channel.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as { type?: string; metrics?: unknown; device?: unknown };
      if (msg.type !== 'perf-sample' || startedAtRef.current === 0) return;
      const metrics = sanitizeMetrics(msg.metrics);
      if (metrics) samplesRef.current.push({ t: Date.now(), source: 'bigscreen', metrics });
      const device = sanitizeDevice(msg.device);
      if (device) devicesRef.current.bigscreen = device;
    };
    const signal = (active: boolean) => {
      channel.postMessage({ type: 'perf-record', active });
      if (room?.state !== 'connected') return;
      const bytes = new TextEncoder().encode(JSON.stringify({ type: 'perf-record', active }));
      void room.localParticipant.publishData(bytes, { reliable: true }).catch(() => { /* ignore */ });
    };
    let timer = 0;
    if (recording) {
      signal(true);
      timer = window.setInterval(() => signal(true), PERF_HEARTBEAT_MS);
    }
    return () => {
      window.clearInterval(timer);
      if (recording) signal(false);
      // 停止後還要收最後一筆，稍後才關閉
      window.setTimeout(() => channel.close(), recording ? FINAL_SAMPLE_WAIT_MS + 500 : 0);
    };
  }, [recording, room]);

  // 接收影像（教師端 getStats 較耗資源，5 秒一次）
  useEffect(() => {
    if (!recording || !room) return;
    let cancelled = false;
    let prev = new Map<string, InboundVideoRow>();
    let lastAt = performance.now();
    const timer = window.setInterval(() => {
      void readInboundVideo(room).then((rows) => {
        if (cancelled) return;
        const now = performance.now();
        for (const [name, value] of Object.entries(summarizeInboundVideo(rows, prev, now - lastAt))) perfGauge(name, value);
        prev = new Map(rows.map((row) => [row.id, row]));
        lastAt = now;
      }).catch(() => { /* ignore */ });
    }, VIDEO_STATS_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [recording, room]);

  // 連線事件
  useEffect(() => {
    if (!recording || !room) return;
    const onJoin = (p: RemoteParticipant) => logEvent(`加入 ${p.identity}`);
    const onLeave = (p: RemoteParticipant) => logEvent(`離開 ${p.identity}`);
    const onReconnecting = () => logEvent('教師端重新連線中');
    const onReconnected = () => logEvent('教師端已重新連線');
    const onQuality = (quality: ConnectionQuality, p: Participant) => {
      if (quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost) logEvent(`連線變差 ${p.identity}：${quality}`);
    };
    room.on(RoomEvent.ParticipantConnected, onJoin);
    room.on(RoomEvent.ParticipantDisconnected, onLeave);
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    room.on(RoomEvent.ConnectionQualityChanged, onQuality);
    return () => {
      room.off(RoomEvent.ParticipantConnected, onJoin);
      room.off(RoomEvent.ParticipantDisconnected, onLeave);
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
      room.off(RoomEvent.ConnectionQualityChanged, onQuality);
    };
  }, [recording, room, logEvent]);

  // 課程進度（任務階段、步驟、第幾句）
  useEffect(() => {
    if (recording && taskLabel) logEvent(taskLabel);
  }, [recording, taskLabel, logEvent]);

  return { recording, saving, toggle, addStudentSample };
}
