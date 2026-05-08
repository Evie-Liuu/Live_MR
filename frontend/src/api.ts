// API client — all calls go to /api/... (Nginx proxies to backend)

export interface CreateRoomResponse {
  roomId: string;
  hostToken: string;
  livekitToken: string;
}

export interface JoinRequestResponse {
  requestId: string;
}

export interface RequestStatusResponse {
  status: 'pending' | 'approved' | 'rejected';
  token?: string;
}

export interface RoomEvent {
  type: string;
  [key: string]: unknown;
}

export async function createRoom(): Promise<CreateRoomResponse> {
  const res = await fetch('/api/rooms', { method: 'POST' });
  if (!res.ok) throw new Error(`createRoom failed: ${res.status}`);
  return res.json() as Promise<CreateRoomResponse>;
}

export async function joinRequest(
  roomId: string,
  name: string,
): Promise<JoinRequestResponse> {
  const res = await fetch(`/api/rooms/${roomId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`joinRequest failed: ${res.status}`);
  return res.json() as Promise<JoinRequestResponse>;
}

export async function getRequestStatus(
  roomId: string,
  requestId: string,
): Promise<RequestStatusResponse> {
  const res = await fetch(`/api/rooms/${roomId}/requests/${requestId}`);
  if (!res.ok) throw new Error(`getRequestStatus failed: ${res.status}`);
  return res.json() as Promise<RequestStatusResponse>;
}

export async function approveRequest(
  roomId: string,
  requestId: string,
): Promise<void> {
  const res = await fetch(`/api/rooms/${roomId}/requests/${requestId}/approve`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`approveRequest failed: ${res.status}`);
}

export async function rejectRequest(
  roomId: string,
  requestId: string,
): Promise<void> {
  const res = await fetch(`/api/rooms/${roomId}/requests/${requestId}/reject`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`rejectRequest failed: ${res.status}`);
}

export function subscribeToRoomEvents(
  roomId: string,
  hostToken: string,
  onEvent: (event: RoomEvent) => void,
): () => void {
  let cancelled = false;
  let lastEventId = 0;
  let controller: AbortController | null = null;
  let backoffMs = 1000;

  const poll = async (): Promise<void> => {
    while (!cancelled) {
      controller = new AbortController();
      try {
        const url = `/api/rooms/${roomId}/events?since=${lastEventId}&token=${encodeURIComponent(hostToken)}`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          if (res.status === 404) return;
          await new Promise((r) => setTimeout(r, backoffMs));
          backoffMs = Math.min(backoffMs * 2, 15000);
          continue;
        }
        backoffMs = 1000;
        const data = (await res.json()) as { events: RoomEvent[]; lastEventId: number };
        if (typeof data.lastEventId === 'number' && data.lastEventId > lastEventId) {
          lastEventId = data.lastEventId;
        }
        for (const event of data.events) {
          if (cancelled) return;
          onEvent(event);
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        await new Promise((r) => setTimeout(r, backoffMs));
        backoffMs = Math.min(backoffMs * 2, 15000);
      }
    }
  };

  void poll();

  return () => {
    cancelled = true;
    controller?.abort();
  };
}

// ── Recording ────────────────────────────────────────────────────────────────

export interface RecordingSession {
  sessionId: string;
  status: 'recording' | 'stopped';
  files: string[];
  startedAt: number;
}

export interface StartRecordingResponse {
  sessionId: string;
  status: 'recording';
}

export interface StopRecordingResponse {
  sessionId: string;
  status: 'stopped';
}

export async function startRecording(
  roomId: string,
  sceneId: string,
  participantName: string,
): Promise<StartRecordingResponse> {
  const res = await fetch(`/api/rooms/${roomId}/recording/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sceneId, participantName }),
  });
  if (!res.ok) throw new Error(`startRecording failed: ${res.status}`);
  return res.json() as Promise<StartRecordingResponse>;
}

export async function stopRecording(roomId: string): Promise<StopRecordingResponse> {
  const res = await fetch(`/api/rooms/${roomId}/recording/stop`, { method: 'POST' });
  if (!res.ok) throw new Error(`stopRecording failed: ${res.status}`);
  return res.json() as Promise<StopRecordingResponse>;
}

export async function getRecordings(roomId: string): Promise<RecordingSession[]> {
  const res = await fetch(`/api/rooms/${roomId}/recordings`);
  if (!res.ok) throw new Error(`getRecordings failed: ${res.status}`);
  const data = await res.json() as { recordings: RecordingSession[] };
  return data.recordings;
}

export async function muteParticipant(
  roomId: string,
  identity: string,
  trackType: 'audio' | 'video',
  muted: boolean,
): Promise<void> {
  const res = await fetch(`/api/rooms/${roomId}/participants/${identity}/mute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trackType, muted }),
  });
  if (!res.ok) throw new Error(`muteParticipant failed: ${res.status}`);
}
