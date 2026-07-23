import { useCallback, useMemo, useRef } from 'react'
import { uploadParticipantAudio } from '../api.ts'

export interface UseLocalAudioRecorderResult {
  start: () => void
  stopAndUpload: (roomId: string, sessionId: string) => Promise<void>
}

/**
 * 依瀏覽器支援度挑容器；webm/opus 優先，iPad/iPhone Safari 不支援 webm 容器，
 * 退到其唯一支援的 mp4/aac。都不支援時回傳 ''（呼叫端應放棄錄音，而非硬送不支援的
 * mimeType 給 MediaRecorder constructor —— 那樣會直接 throw，錄音永遠不會開始）。
 */
function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus'
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm'
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4'
  return ''
}

/**
 * 對「目前麥克風 track」做整段錄音（涵蓋一次課堂錄製的起訖，非 per-turn）。
 * getMicTrack / getIdentity 是即時取值的 getter，而非固定的 Room 物件——
 * 讓 Host（room 存在 React state）與 Student（room 只存在 ref）能共用同一支 hook。
 */
export function useLocalAudioRecorder(
  getMicTrack: () => MediaStreamTrack | null,
  getIdentity: () => string | null,
): UseLocalAudioRecorderResult {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mimeRef = useRef<string>('')

  const start = useCallback(() => {
    const track = getMicTrack()
    if (!track) return
    // 前一輪 recorder 若還在（例如重整後恢復），先丟棄，避免孤兒 recorder 佔用麥克風。
    const existing = mediaRecorderRef.current
    if (existing) {
      mediaRecorderRef.current = null
      try { if (existing.state !== 'inactive') existing.stop() } catch { /* ignore */ }
    }
    const mimeType = pickMimeType()
    if (!mimeType) {
      console.warn('[useLocalAudioRecorder] No supported audio mimeType on this browser; skipping local recording.')
      return
    }
    try {
      const stream = new MediaStream([track])
      const mr = new MediaRecorder(stream, { mimeType })
      chunksRef.current = []
      mimeRef.current = mimeType.split(';')[0]
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.start(1000)
      mediaRecorderRef.current = mr
    } catch (err) {
      console.error('[useLocalAudioRecorder] Failed to start recording:', err)
    }
  }, [getMicTrack])

  const stopAndUpload = useCallback((roomId: string, sessionId: string): Promise<void> => {
    return new Promise((resolve) => {
      const mr = mediaRecorderRef.current
      mediaRecorderRef.current = null
      if (!mr || mr.state === 'inactive') { resolve(); return }
      mr.onstop = async () => {
        const identity = getIdentity()
        const blob = new Blob(chunksRef.current, { type: mimeRef.current || 'audio/webm' })
        chunksRef.current = []
        if (identity && blob.size > 0) {
          try {
            await uploadParticipantAudio(roomId, sessionId, identity, blob)
          } catch (err) {
            console.error('[useLocalAudioRecorder] Failed to upload audio recording:', err)
          }
        }
        resolve()
      }
      try { mr.stop() } catch { resolve() }
    })
  }, [getIdentity])

  return useMemo(() => ({ start, stopAndUpload }), [start, stopAndUpload])
}
