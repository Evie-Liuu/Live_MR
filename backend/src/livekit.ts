import { AccessToken } from 'livekit-server-sdk'

const API_KEY = (process.env.LIVEKIT_API_KEY || 'devkey').trim()
const API_SECRET = (process.env.LIVEKIT_API_SECRET || 'devsecret1234567890devsecret1234567890').trim()

export async function createToken(roomName: string, participantName: string, isHost: boolean): Promise<string> {
  const at = new AccessToken(API_KEY, API_SECRET, { identity: participantName, ttl: '6h' })
  at.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: isHost, canPublishData: true })
  return await at.toJwt()
}
