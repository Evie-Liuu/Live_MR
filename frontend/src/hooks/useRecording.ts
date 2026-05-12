import { useCallback, useEffect, useRef, useState } from 'react'
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

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])

  // Restore recording state on mount
  useEffect(() => {
    if (!roomId) return
    getRecordings(roomId)
      .then((sessions) => {
        const active = sessions.find((s) => s.status === 'recording')
        if (active) {
          setIsRecording(true)
          setSessionId(active.sessionId)
          // Start local audio recording if active session found on mount
          if (room?.localParticipant) {
            const audioTrack = room.localParticipant.getTrackPublication(Track.Source.Microphone)
            if (audioTrack?.track?.mediaStreamTrack && !mediaRecorderRef.current) {
              try {
                const stream = new MediaStream([audioTrack.track.mediaStreamTrack])
                const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                  ? 'audio/webm;codecs=opus'
                  : 'audio/webm'
                const mr = new MediaRecorder(stream, { mimeType })
                recordingChunksRef.current = []
                mr.ondataavailable = (e) => {
                  if (e.data.size > 0) recordingChunksRef.current.push(e.data)
                }
                mr.start(1000)
                mediaRecorderRef.current = mr
              } catch (err) {
                console.error('[useRecording] Failed to start local audio recording on mount:', err)
              }
            }
          }
        }
      })
      .catch(() => { /* backend may still be starting */ })
  }, [roomId, room]) // Added room dependency to allow starting when room is ready

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

    // Start local audio recording
    if (room?.localParticipant) {
      const audioTrack = room.localParticipant.getTrackPublication(Track.Source.Microphone)
      if (audioTrack?.track?.mediaStreamTrack) {
        try {
          const stream = new MediaStream([audioTrack.track.mediaStreamTrack])
          const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : 'audio/webm'
          const mr = new MediaRecorder(stream, { mimeType })
          recordingChunksRef.current = []
          mr.ondataavailable = (e) => {
            if (e.data.size > 0) recordingChunksRef.current.push(e.data)
          }
          mr.start(1000)
          mediaRecorderRef.current = mr
        } catch (err) {
          console.error('[useRecording] Failed to start local audio recording:', err)
        }
      }
    }

    channelRef?.current?.postMessage({ type: 'recording-start', sessionId: result.sessionId })
  }, [roomId, room, channelRef, sceneId, participantName])

  const stop = useCallback(async () => {
    await stopRecording(roomId)
    setIsRecording(false)
    const activeSessionId = sessionId
    setSessionId(null)

    // Stop and upload local audio recording
    const mr = mediaRecorderRef.current
    if (mr && mr.state !== 'inactive') {
      mr.onstop = async () => {
        if (!activeSessionId || !room?.localParticipant) return
        const blob = new Blob(recordingChunksRef.current, { type: 'audio/webm' })
        try {
          await fetch(`/api/rooms/${roomId}/recording/audio`, {
            method: 'POST',
            headers: {
              'Content-Type': 'audio/webm',
              'X-Session-Id': activeSessionId,
              'X-Participant-Identity': room.localParticipant.identity,
            },
            body: blob,
          })
        } catch (err) {
          console.error('[useRecording] Failed to upload audio recording:', err)
        }
        mediaRecorderRef.current = null
        recordingChunksRef.current = []
      }
      mr.stop()
    }

    channelRef?.current?.postMessage({ type: 'recording-stop' })
  }, [roomId, room, sessionId, channelRef])

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
