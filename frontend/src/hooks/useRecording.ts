import { useCallback, useEffect, useState } from 'react'
import { Room, RoomEvent, Track } from 'livekit-client'
import {
  startRecording,
  stopRecording,
  getRecordings,
  muteParticipant,
} from '../api.ts'
import { useLocalAudioRecorder } from './useLocalAudioRecorder.ts'

export interface MuteState {
  audio: boolean
  video: boolean
}

export interface UseRecordingResult {
  isRecording: boolean
  sessionId: string | null
  start: () => Promise<void>
  stop: () => Promise<void>
  muteState: Record<string, MuteState>
  toggleMute: (identity: string, trackType: 'audio' | 'video') => Promise<void>
}

/** 把「錄製開始/停止」廣播給所有學生（老師端目前只用 BroadcastChannel 轉給大屏，學生端在不同裝置收不到）。 */
function broadcastRecordingSignal(room: Room | null, action: 'start' | 'stop', sessionId: string): void {
  if (!room || room.state !== 'connected') return
  try {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ type: 'recording-signal', action, sessionId }),
    )
    room.localParticipant.publishData(bytes, { reliable: true })
  } catch { /* ignore */ }
}

export function useRecording(
  roomId: string,
  room: Room | null,
  sceneId: string,
  participantName: string,
  channelRef?: React.RefObject<BroadcastChannel | null>,
): UseRecordingResult {
  const [isRecording, setIsRecording] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [muteState, setMuteState] = useState<Record<string, MuteState>>({})

  const getMicTrack = useCallback((): MediaStreamTrack | null => {
    const pub = room?.localParticipant.getTrackPublication(Track.Source.Microphone)
    return pub?.track?.mediaStreamTrack ?? null
  }, [room])

  const getIdentity = useCallback((): string | null => {
    return room?.localParticipant.identity ?? null
  }, [room])

  const localAudio = useLocalAudioRecorder(getMicTrack, getIdentity)

  // Restore recording state on mount (e.g. host refreshed mid-recording)
  useEffect(() => {
    if (!roomId) return
    getRecordings(roomId)
      .then((sessions) => {
        const active = sessions.find((s) => s.status === 'recording')
        if (active) {
          setIsRecording(true)
          setSessionId(active.sessionId)
          localAudio.start()
        }
      })
      .catch(() => { /* backend may still be starting */ })
  }, [roomId, localAudio])

  // Sync mute state from LiveKit room
  useEffect(() => {
    if (!room) return

    const buildMuteState = (): Record<string, MuteState> => {
      const state: Record<string, MuteState> = {}
      for (const [, participant] of room.remoteParticipants) {
        let audioMuted = false
        let videoMuted = false
        for (const [, pub] of participant.trackPublications) {
          if (pub.kind === Track.Kind.Audio) audioMuted = pub.isMuted
          if (pub.kind === Track.Kind.Video) videoMuted = pub.isMuted
        }
        state[participant.identity] = { audio: audioMuted, video: videoMuted }
      }
      return state
    }

    const sync = () => setMuteState(buildMuteState())

    sync()
    room.on(RoomEvent.TrackMuted, sync)
    room.on(RoomEvent.TrackUnmuted, sync)
    room.on(RoomEvent.ParticipantConnected, sync)
    room.on(RoomEvent.ParticipantDisconnected, sync)

    return () => {
      room.off(RoomEvent.TrackMuted, sync)
      room.off(RoomEvent.TrackUnmuted, sync)
      room.off(RoomEvent.ParticipantConnected, sync)
      room.off(RoomEvent.ParticipantDisconnected, sync)
    }
  }, [room])

  const start = useCallback(async () => {
    const result = await startRecording(roomId, sceneId, participantName)
    setIsRecording(true)
    setSessionId(result.sessionId)

    localAudio.start()

    channelRef?.current?.postMessage({ type: 'recording-start', sessionId: result.sessionId })
    broadcastRecordingSignal(room, 'start', result.sessionId)
  }, [roomId, room, channelRef, sceneId, participantName, localAudio])

  const stop = useCallback(async () => {
    await stopRecording(roomId)
    setIsRecording(false)
    const activeSessionId = sessionId
    setSessionId(null)

    if (activeSessionId) {
      await localAudio.stopAndUpload(roomId, activeSessionId)
    }

    channelRef?.current?.postMessage({ type: 'recording-stop' })
    broadcastRecordingSignal(room, 'stop', activeSessionId ?? '')
  }, [roomId, room, sessionId, channelRef, localAudio])

  const toggleMute = useCallback(
    async (identity: string, trackType: 'audio' | 'video') => {
      const current = muteState[identity]?.[trackType] ?? false
      await muteParticipant(roomId, identity, trackType, !current)
      setMuteState((prev) => ({
        ...prev,
        [identity]: {
          audio: prev[identity]?.audio ?? false,
          video: prev[identity]?.video ?? false,
          [trackType]: !current,
        },
      }))
    },
    [roomId, muteState],
  )

  return { isRecording, sessionId, start, stop, muteState, toggleMute }
}
