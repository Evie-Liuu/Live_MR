import { useCallback, useEffect, useState } from 'react'
import { Room, RoomEvent, Track } from 'livekit-client'
import {
  startRecording,
  stopRecording,
  getRecordings,
  muteParticipant,
} from '../api.ts'

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

export function useRecording(roomId: string, room: Room | null): UseRecordingResult {
  const [isRecording, setIsRecording] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [muteState, setMuteState] = useState<Record<string, MuteState>>({})

  // Restore recording state on mount
  useEffect(() => {
    if (!roomId) return
    getRecordings(roomId)
      .then((sessions) => {
        const active = sessions.find((s) => s.status === 'recording')
        if (active) {
          setIsRecording(true)
          setSessionId(active.sessionId)
        }
      })
      .catch(() => { /* backend may still be starting */ })
  }, [roomId])

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
    const result = await startRecording(roomId)
    setIsRecording(true)
    setSessionId(result.sessionId)
  }, [roomId])

  const stop = useCallback(async () => {
    await stopRecording(roomId)
    setIsRecording(false)
  }, [roomId])

  const toggleMute = useCallback(
    async (identity: string, trackType: 'audio' | 'video') => {
      const current = muteState[identity]?.[trackType] ?? false
      await muteParticipant(roomId, identity, trackType, !current)
      // Optimistic update — LiveKit events will confirm truth
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
