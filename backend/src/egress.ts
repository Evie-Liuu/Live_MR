import {
  EgressClient,
  RoomServiceClient,
  EncodedFileOutput,
  EncodedFileType,
  TrackSource,
  TrackType,
} from 'livekit-server-sdk'

const API_KEY = (process.env.LIVEKIT_API_KEY || 'devkey').trim()
const API_SECRET = (process.env.LIVEKIT_API_SECRET || 'devsecret1234567890devsecret1234567890').trim()
const _lkUrl = (process.env.LIVEKIT_URL || process.env.LIVEKIT_SERVER_URL || 'ws://livekit:7880').trim()
const SERVER_URL = _lkUrl.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://')

export interface StartRecordingResult {
  trackEgressIds: Record<string, string>   // identity → egressId
  participantIdentities: string[]
}

export class EgressService {
  private egress: EgressClient
  private roomService: RoomServiceClient

  constructor(serverUrl = SERVER_URL, apiKey = API_KEY, apiSecret = API_SECRET) {
    this.egress = new EgressClient(serverUrl, apiKey, apiSecret)
    this.roomService = new RoomServiceClient(serverUrl, apiKey, apiSecret)
  }

  async startRecording(
    roomId: string,
    sessionId: string,
  ): Promise<StartRecordingResult> {
    const basePath = `/recordings/${roomId}/${sessionId}`

    // Per-participant audio track egress
    const participants = await this.roomService.listParticipants(roomId)
    const trackEgressIds: Record<string, string> = {}
    const participantIdentities: string[] = []

    for (const participant of participants) {
      const audioTrack = participant.tracks.find(
        (t) => t.source === TrackSource.MICROPHONE,
      )
      if (!audioTrack) continue

      const audioOutput = new EncodedFileOutput({
        fileType: EncodedFileType.OGG,
        filepath: `${basePath}/audio_${participant.identity}.ogg`,
        disableManifest: true,
      })
      const trackInfo = await this.egress.startTrackCompositeEgress(
        roomId,
        audioOutput,
        { audioTrackId: audioTrack.sid },
      )
      trackEgressIds[participant.identity] = trackInfo.egressId
      participantIdentities.push(participant.identity)
    }

    return { trackEgressIds, participantIdentities }
  }

  async stopRecording(
    trackEgressIds: Record<string, string>,
  ): Promise<void> {
    for (const egressId of Object.values(trackEgressIds)) {
      await this.egress.stopEgress(egressId)
    }
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
}
