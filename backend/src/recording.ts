import { randomUUID } from 'crypto'

export interface RecordingSession {
  sessionId: string
  trackEgressIds: Record<string, string>   // identity → egressId
  status: 'recording' | 'stopped'
  mergeStatus: 'pending' | 'merging' | 'done' | 'error'
  mergeOutput?: string   // basePath-relative: e.g. /recordings/{scene}/{folder}/output.mp4
  mergeError?: string
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
      mergeStatus: 'pending',
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
    // Include all possible files that may have been generated (Egress .ogg, client-side .webm)
    const audioFiles: string[] = []
    for (const id of session.participantIdentities) {
      audioFiles.push(`${session.basePath}/audio_${id}.ogg`)
      audioFiles.push(`${session.basePath}/audio_${id}.webm`)
    }
    session.files = [
      `${session.basePath}/bigscreen.webm`,
      ...audioFiles,
    ]
    return session
  }

  listSessions(roomId: string): RecordingSession[] {
    return this.sessions.get(roomId) ?? []
  }

  getSessionById(sessionId: string): RecordingSession | null {
    for (const sessions of this.sessions.values()) {
      const found = sessions.find((s) => s.sessionId === sessionId)
      if (found) return found
    }
    return null
  }
}
