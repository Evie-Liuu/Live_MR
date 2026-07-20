import { randomUUID } from 'crypto'

export interface RecordingSession {
  sessionId: string
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
    basePath: string,
    sessionId?: string,
  ): RecordingSession {
    const session: RecordingSession = {
      sessionId: sessionId ?? randomUUID(),
      status: 'recording',
      mergeStatus: 'pending',
      startedAt: Date.now(),
      files: [],
      basePath,
      participantIdentities: [],
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
    // 每人音訊一律是瀏覽器端 MediaRecorder 上傳的 .webm（不再有 Egress 的 .ogg）
    const audioFiles = session.participantIdentities.map(
      (id) => `${session.basePath}/audio_${id}.webm`,
    )
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
