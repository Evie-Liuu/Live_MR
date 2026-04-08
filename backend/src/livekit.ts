import { AccessToken } from 'livekit-server-sdk'

export async function createToken(roomName: string, participantName: string, isHost: boolean): Promise<string> {
  const apiKey = (process.env.LIVEKIT_API_KEY || 'devkey').trim()
  const apiSecret = (process.env.LIVEKIT_API_SECRET || 'devsecret1234567890devsecret1234567890').trim()
  
  const at = new AccessToken(apiKey, apiSecret, { identity: participantName, ttl: '6h' })
  at.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: isHost, canPublishData: true, canUpdateOwnMetadata: true })
  return await at.toJwt()
}
