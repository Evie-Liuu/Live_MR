import { randomUUID } from 'crypto'

export interface RecordingSession {
  sessionId: string
  compositeEgressId: string
  trackEgressIds: Record<string, string>   // identity → egressId
  status: 'recording' | 'stopped'
  startedAt: number
  files: string[]
}

export class RecordingStore {
  // roomId → all sessions (most recent last)
  private sessions = new Map<string, RecordingSession[]>()

  startSession(
    roomId: string,
    compositeEgressId: string,
    trackEgressIds: Record<string, string>,
    sessionId?: string,
  ): RecordingSession {
    const session: RecordingSession = {
      sessionId: sessionId ?? randomUUID(),
      compositeEgressId,
      trackEgressIds,
      status: 'recording',
      startedAt: Date.now(),
      files: [],
    }
    const list = this.sessions.get(roomId) ?? []
    list.push(session)
    this.sessions.set(roomId, list)
    return session
  }

  getActiveSession(roomId: string): RecordingSession | null {
    const list = this.sessions.get(roomId) ?? []
    return list.find((s) => s.status === 'recording') ?? null
  }

  stopSession(roomId: string, files: string[]): RecordingSession | null {
    const session = this.getActiveSession(roomId)
    if (!session) return null
    session.status = 'stopped'
    session.files = files
    return session
  }

  listSessions(roomId: string): RecordingSession[] {
    return this.sessions.get(roomId) ?? []
  }
}
