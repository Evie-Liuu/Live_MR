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
