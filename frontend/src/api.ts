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
  const url = `/api/rooms/${roomId}/events?token=${encodeURIComponent(hostToken)}`;
  const source = new EventSource(url);

  source.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data as string) as RoomEvent;
      onEvent(data);
    } catch {
      // ignore malformed events
    }
  };

  source.onerror = () => {
    // EventSource will auto-reconnect
  };

  return () => source.close();
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

export async function startRecording(roomId: string): Promise<StartRecordingResponse> {
  const res = await fetch(`/api/rooms/${roomId}/recording/start`, { method: 'POST' });
  console.log(res);

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
  console.log(res);

  if (!res.ok) throw new Error(`muteParticipant failed: ${res.status}`);
}
