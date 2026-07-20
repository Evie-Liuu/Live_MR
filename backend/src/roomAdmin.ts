import {
  RoomServiceClient,
  TrackSource,
  TrackType,
} from 'livekit-server-sdk'

export class RoomAdminService {
  private roomService: RoomServiceClient

  constructor() {
    const key = (process.env.LIVEKIT_API_KEY || 'devkey').trim()
    const secret = (process.env.LIVEKIT_API_SECRET || 'devsecret1234567890devsecret1234567890').trim()
    const _lkUrl = (process.env.LIVEKIT_URL || process.env.LIVEKIT_SERVER_URL || 'ws://localhost:7880').trim()
    const urlHttp = _lkUrl.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://')

    this.roomService = new RoomServiceClient(urlHttp, key, secret)
  }

  async muteTrack(
    roomId: string,
    identity: string,
    trackType: 'audio' | 'video',
    muted: boolean,
  ): Promise<void> {
    const participant = await this.roomService.getParticipant(roomId, identity)
    if (!participant) {
      throw new Error(`Participant ${identity} not found in room ${roomId}`)
    }

    const kind = trackType === 'audio' ? TrackType.AUDIO : TrackType.VIDEO
    const source = trackType === 'audio' ? TrackSource.MICROPHONE : TrackSource.CAMERA

    let track = participant.tracks.find((t) => t.source === source)
    if (!track) {
      track = participant.tracks.find((t) => t.type === kind)
    }

    if (!track) {
      // No published track — effectively already in the desired state
      return
    }

    await this.roomService.mutePublishedTrack(roomId, identity, track.sid, muted)
  }

  /**
   * Forcibly disconnect a participant from a room. The LiveKit server tears
   * down their connection; the client receives a Disconnected event.
   * No-op (does not throw) if the participant has already left.
   */
  async removeParticipant(roomId: string, identity: string): Promise<void> {
    try {
      await this.roomService.removeParticipant(roomId, identity)
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      // LiveKit returns NOT_FOUND when the participant is already gone — that's
      // the desired terminal state, so swallow it.
      if (msg.toLowerCase().includes('not_found') || msg.toLowerCase().includes('not found')) return
      throw err
    }
  }
}
