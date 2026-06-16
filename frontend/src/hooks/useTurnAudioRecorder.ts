import { useCallback, useRef } from 'react'

/** 依瀏覽器支援度挑容器；ogg/opus 優先（Gemini 官方支援），退 webm/opus。 */
export function pickAudioMimeType(isSupported: (t: string) => boolean): string {
  if (isSupported('audio/ogg;codecs=opus')) return 'audio/ogg;codecs=opus'
  if (isSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus'
  return ''
}

/** stop() 回傳的音訊：base64 內容 + 送 Gemini 用的容器 mimeType（去掉 codecs 參數）。 */
export interface TurnAudio {
  data: string
  mimeType: string
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      // dataURL 形如 "data:audio/ogg;codecs=opus;base64,XXXX" → 取逗號後
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * 對「當前麥克風 track」做 per-turn 錄製。getMicTrack 每次 start 時即時取得
 * 老師的 LiveKit 本地麥克風 MediaStreamTrack；無 track 時 start 回 false、
 * stop 回 null（觸發呼叫端的文字回退）。
 */
export function useTurnAudioRecorder(getMicTrack: () => MediaStreamTrack | null) {
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mimeRef = useRef<string>('')

  const supported =
    typeof MediaRecorder !== 'undefined' &&
    pickAudioMimeType((t) => MediaRecorder.isTypeSupported(t)) !== ''

  const start = useCallback((): boolean => {
    if (typeof MediaRecorder === 'undefined') return false
    // 防護：若上一輪 recorder 仍在（未經 stop() 就再次 start），先丟棄，避免孤兒 recorder 繼續佔用麥克風。
    const existing = recorderRef.current
    if (existing) {
      recorderRef.current = null
      try { if (existing.state !== 'inactive') existing.stop() } catch { /* ignore */ }
    }
    const track = getMicTrack()
    if (!track) return false
    const mime = pickAudioMimeType((t) => MediaRecorder.isTypeSupported(t))
    if (!mime) return false
    try {
      const stream = new MediaStream([track])
      const mr = new MediaRecorder(stream, { mimeType: mime })
      chunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data) }
      mr.start()
      recorderRef.current = mr
      mimeRef.current = mime
      return true
    } catch (err) {
      console.warn('[useTurnAudioRecorder] start failed:', err)
      return false
    }
  }, [getMicTrack])

  const stop = useCallback((): Promise<TurnAudio | null> => {
    return new Promise((resolve) => {
      const mr = recorderRef.current
      recorderRef.current = null
      if (!mr || mr.state === 'inactive') { resolve(null); return }
      let settled = false
      const done = (v: TurnAudio | null) => { if (!settled) { settled = true; resolve(v) } }
      const timer = setTimeout(() => done(null), 5000)
      mr.onstop = async () => {
        clearTimeout(timer)
        const blob = new Blob(chunksRef.current, { type: mimeRef.current })
        chunksRef.current = []
        if (blob.size === 0) { done(null); return }
        try {
          const data = await blobToBase64(blob)
          // 送 Gemini 的 mimeType 用容器主型別（去掉 ;codecs=opus）
          done({ data, mimeType: mimeRef.current.split(';')[0] })
        } catch { done(null) }
      }
      try { mr.stop() } catch { clearTimeout(timer); done(null) }
    })
  }, [])

  return { start, stop, supported }
}
