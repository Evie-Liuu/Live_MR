import { describe, it, expect, beforeEach } from 'vitest'
import { RecordingStore } from './recording.js'

describe('RecordingStore', () => {
  let store: RecordingStore

  beforeEach(() => {
    store = new RecordingStore()
  })

  it('starts a session and returns it', () => {
    const session = store.startSession('room-1', 'egress-composite', {
      alice: 'egress-alice',
      bob: 'egress-bob',
    })
    expect(session.sessionId).toBeDefined()
    expect(session.status).toBe('recording')
    expect(session.compositeEgressId).toBe('egress-composite')
    expect(session.trackEgressIds).toEqual({ alice: 'egress-alice', bob: 'egress-bob' })
  })

  it('getActiveSession returns session while recording', () => {
    store.startSession('room-1', 'egress-composite', {})
    const session = store.getActiveSession('room-1')
    expect(session).toBeDefined()
    expect(session!.status).toBe('recording')
  })

  it('getActiveSession returns null when no active session', () => {
    expect(store.getActiveSession('room-1')).toBeNull()
  })

  it('stopSession marks session as stopped and stores files', () => {
    store.startSession('room-1', 'egress-c', {})
    const stopped = store.stopSession('room-1', ['composite.mp4'])
    expect(stopped!.status).toBe('stopped')
    expect(stopped!.files).toEqual(['composite.mp4'])
  })

  it('getActiveSession returns null after stop', () => {
    store.startSession('room-1', 'egress-c', {})
    store.stopSession('room-1', [])
    expect(store.getActiveSession('room-1')).toBeNull()
  })

  it('listSessions returns all sessions for a room', () => {
    store.startSession('room-1', 'e1', {})
    store.stopSession('room-1', [])
    store.startSession('room-1', 'e2', {})
    const sessions = store.listSessions('room-1')
    expect(sessions).toHaveLength(2)
  })

  it('accepts an explicit sessionId', () => {
    const session = store.startSession('room-1', 'e1', {}, 'my-fixed-id')
    expect(session.sessionId).toBe('my-fixed-id')
  })
})
