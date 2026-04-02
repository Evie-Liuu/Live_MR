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
// LIVEKIT_URL is set in .env (ws:// or http://); RoomServiceClient needs http(s)://
const _lkUrl = (process.env.LIVEKIT_URL || process.env.LIVEKIT_SERVER_URL || 'ws://livekit:7880').trim()
const SERVER_URL = _lkUrl.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://')
console.log(_lkUrl);
console.log(SERVER_URL);

export interface StartRecordingResult {
  compositeEgressId: string
  trackEgressIds: Record<string, string>   // identity → egressId
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

    // 1. Room composite egress (video + audio)
    const compositeOutput = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath: `${basePath}/composite.mp4`,
      disableManifest: true,
    })
    const compositeInfo = await this.egress.startRoomCompositeEgress(roomId, compositeOutput)

    // 2. Per-participant audio track egress
    const participants = await this.roomService.listParticipants(roomId)
    const trackEgressIds: Record<string, string> = {}

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
    }

    return {
      compositeEgressId: compositeInfo.egressId,
      trackEgressIds,
    }
  }

  async stopRecording(
    compositeEgressId: string,
    trackEgressIds: Record<string, string>,
  ): Promise<void> {
    await this.egress.stopEgress(compositeEgressId)
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

    // Try finding by source first, then by type
    let track = participant.tracks.find((t) => t.source === source)
    if (!track) {
      track = participant.tracks.find((t) => t.type === kind)
    }

    if (!track) {
      // If we're trying to mute and there's no track, it's effectively muted
      if (muted) return
      throw new Error(`No ${trackType} track found for ${identity} to ${muted ? 'mute' : 'unmute'}`)
    }

    await this.roomService.mutePublishedTrack(roomId, identity, track.sid, muted)
  }
}
