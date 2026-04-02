import { randomUUID } from 'crypto'

export interface RecordingSession {
  sessionId: string
  trackEgressIds: Record<string, string>   // identity → egressId
  status: 'recording' | 'stopped'
  startedAt: number
  files: string[]
  basePath: string
  participantIdentities: string[]
}

export class RecordingStore {
  // roomId → all sessions (most recent last)
  private sessions = new Map<string, RecordingSession[]>()

  startSession(
    roomId: string,
    trackEgressIds: Record<string, string>,
    basePath: string,
    participantIdentities: string[],
    sessionId?: string,
  ): RecordingSession {
    const session: RecordingSession = {
      sessionId: sessionId ?? randomUUID(),
      trackEgressIds,
      status: 'recording',
      startedAt: Date.now(),
      files: [],
      basePath,
      participantIdentities,
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

  stopSession(roomId: string): RecordingSession | null {
    const session = this.getActiveSession(roomId)
    if (!session) return null
    session.status = 'stopped'
    session.files = [
      `${session.basePath}/bigscreen.webm`,
      ...session.participantIdentities.map((id) => `${session.basePath}/audio_${id}.ogg`),
    ]
    return session
  }

  listSessions(roomId: string): RecordingSession[] {
    return this.sessions.get(roomId) ?? []
  }
}
