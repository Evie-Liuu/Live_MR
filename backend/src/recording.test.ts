import { describe, it, expect, beforeEach } from 'vitest'
import { RecordingStore } from './recording.js'

describe('RecordingStore', () => {
  let store: RecordingStore

  beforeEach(() => {
    store = new RecordingStore()
  })

  it('starts a session and returns it', () => {
    const session = store.startSession('room-1', '/recordings/room-1/sess-1')
    expect(session.sessionId).toBeDefined()
    expect(session.status).toBe('recording')
    expect(session.basePath).toBe('/recordings/room-1/sess-1')
    expect(session.participantIdentities).toEqual([])
    expect(session.files).toEqual([])
  })

  it('getActiveSession returns session while recording', () => {
    store.startSession('room-1', '/recordings/room-1/s1')
    expect(store.getActiveSession('room-1')?.status).toBe('recording')
  })

  it('getActiveSession returns null when no active session', () => {
    expect(store.getActiveSession('room-1')).toBeNull()
  })

  it('stopSession marks session stopped and populates files from uploaded participants', () => {
    const session = store.startSession('room-1', '/recordings/room-1/sess-1')
    session.participantIdentities.push('alice', 'bob')
    const stopped = store.stopSession('room-1')
    expect(stopped!.status).toBe('stopped')
    expect(stopped!.files).toEqual([
      '/recordings/room-1/sess-1/bigscreen.webm',
      '/recordings/room-1/sess-1/audio_alice.webm',
      '/recordings/room-1/sess-1/audio_bob.webm',
    ])
  })

  it('stopSession with no participants only includes bigscreen', () => {
    store.startSession('room-1', '/recordings/room-1/s1')
    const stopped = store.stopSession('room-1')
    expect(stopped!.files).toEqual(['/recordings/room-1/s1/bigscreen.webm'])
  })

  it('getActiveSession returns null after stop', () => {
    store.startSession('room-1', '/recordings/room-1/s1')
    store.stopSession('room-1')
    expect(store.getActiveSession('room-1')).toBeNull()
  })

  it('listSessions returns all sessions for a room', () => {
    store.startSession('room-1', '/recordings/room-1/s1')
    store.stopSession('room-1')
    store.startSession('room-1', '/recordings/room-1/s2')
    expect(store.listSessions('room-1')).toHaveLength(2)
  })

  it('accepts an explicit sessionId', () => {
    const session = store.startSession('room-1', '/recordings/room-1/s1', 'my-fixed-id')
    expect(session.sessionId).toBe('my-fixed-id')
  })
})
