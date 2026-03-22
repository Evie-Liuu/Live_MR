import { describe, it, expect } from 'vitest'
import { createToken } from './livekit.js'

describe('createToken', () => {
  it('returns a JWT string', async () => {
    const token = await createToken('test-room', 'alice', true)
    expect(typeof token).toBe('string')
    // JWT has 3 dot-separated parts
    const parts = token.split('.')
    expect(parts).toHaveLength(3)
  })

  it('produces different tokens for host and student', async () => {
    const hostToken = await createToken('room1', 'host-user', true)
    const studentToken = await createToken('room1', 'student-user', false)
    expect(hostToken).not.toBe(studentToken)
  })

  it('encodes participant identity in payload', async () => {
    const token = await createToken('room1', 'bob', false)
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
    expect(payload.sub).toBe('bob')
  })

  it('encodes room name in video grant', async () => {
    const token = await createToken('my-room', 'alice', true)
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
    expect(payload.video.room).toBe('my-room')
    expect(payload.video.roomJoin).toBe(true)
  })

  it('sets canSubscribe true for host', async () => {
    const token = await createToken('room1', 'host', true)
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
    expect(payload.video.canSubscribe).toBe(true)
  })

  it('sets canSubscribe false for student', async () => {
    const token = await createToken('room1', 'student', false)
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
    expect(payload.video.canSubscribe).toBe(false)
  })
})
