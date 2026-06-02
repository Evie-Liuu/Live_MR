import { useRef, useState, useCallback, useEffect } from 'react'

export interface UseSpeechRecordingResult {
  recording: boolean
  interim: string
  transcript: string
  supported: boolean
  error: string | null
  start: () => void
  stop: () => void
  clear: () => void
  simulate: (text: string) => void
}

const FILLER_ONLY_RE = /^(uh+|um+|ah+|er+|hmm+|\s)+$/i

function isTooShortOrFiller(text: string): boolean {
  const t = text.trim()
  return t.length < 3 || FILLER_ONLY_RE.test(t)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySpeechRecognition = any

export function useSpeechRecording(): UseSpeechRecordingResult {
  const SpeechRecognitionCtor =
    (typeof window !== 'undefined' &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition))
    || null

  const supported = SpeechRecognitionCtor !== null

  const [recording, setRecording] = useState(false)
  const [interim, setInterim] = useState('')
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)

  const recogRef = useRef<AnySpeechRecognition>(null)
  const finalBufferRef = useRef('')
  const abortedRef = useRef(false)
  // 由呼叫端主動 stop() 設旗標。引擎自動 onend（如 Chrome 沉默超時）會看不到此旗標 → 自動重啟。
  const stoppingRef = useRef(false)

  const stop = useCallback(() => {
    stoppingRef.current = true
    try { recogRef.current?.stop() } catch { /* ignore */ }
  }, [])

  const start = useCallback(() => {
    if (!SpeechRecognitionCtor) return
    if (recogRef.current) {
      try { abortedRef.current = true; recogRef.current.abort() } catch { /* ignore */ }
    }
    abortedRef.current = false
    stoppingRef.current = false
    setInterim('')
    setTranscript('')
    setError(null)
    finalBufferRef.current = ''

    const recog = new SpeechRecognitionCtor()
    recog.continuous = true
    recog.interimResults = true
    recog.lang = 'en-US'

    recog.onresult = (e: AnySpeechRecognition) => {
      if (recogRef.current !== recog) return // 已被新 session 取代
      let interimText = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]
        if (result.isFinal) {
          finalBufferRef.current += result[0].transcript
        } else {
          interimText += result[0].transcript
        }
      }
      setInterim(interimText)
    }

    recog.onerror = (e: AnySpeechRecognition) => {
      if (recogRef.current !== recog) return
      if (e.error === 'aborted' || e.error === 'no-speech') return
      setError(`STT error: ${e.error ?? 'unknown'}`)
    }

    recog.onend = () => {
      if (recogRef.current !== recog) return // 舊 instance — 新 session 已取代，忽略
      if (abortedRef.current) {
        setInterim('')
        setRecording(false)
        return
      }
      if (stoppingRef.current) {
        // 呼叫端主動 stop() — 收尾並回傳累積 transcript
        const final = finalBufferRef.current.trim()
        setTranscript(isTooShortOrFiller(final) ? '' : final)
        setInterim('')
        setRecording(false)
        finalBufferRef.current = ''
        stoppingRef.current = false
        return
      }
      // 引擎自動結束（Chrome 沉默超時等）— 保留 finalBufferRef，立即重啟同一 instance，
      // 讓老師輪到時的錄音不會在中途斷掉。延後 1 tick 避免「recognition is already started」。
      setInterim('')
      setTimeout(() => {
        if (recogRef.current !== recog) return
        if (stoppingRef.current || abortedRef.current) return
        try {
          recog.start()
        } catch (err) {
          console.warn('[useSpeechRecording] auto-restart failed:', err)
          const final = finalBufferRef.current.trim()
          setTranscript(isTooShortOrFiller(final) ? '' : final)
          setRecording(false)
          finalBufferRef.current = ''
        }
      }, 0)
    }

    recogRef.current = recog
    recog.start()
    setRecording(true)
  }, [SpeechRecognitionCtor])

  const clear = useCallback(() => {
    setTranscript('')
    setInterim('')
    finalBufferRef.current = ''
  }, [])

  const simulate = useCallback((text: string) => {
    abortedRef.current = true
    try { recogRef.current?.abort() } catch { /* ignore */ }
    finalBufferRef.current = ''
    setInterim('')
    setError(null)
    setRecording(false)
    const t = text.trim()
    setTranscript(isTooShortOrFiller(t) ? '' : t)
  }, [])

  useEffect(() => {
    return () => {
      try { recogRef.current?.abort() } catch { /* ignore */ }
    }
  }, [])

  if (!supported) {
    return {
      recording: false, interim: '', transcript, supported: false,
      error: null, start: () => {}, stop: () => {}, clear, simulate,
    }
  }

  return { recording, interim, transcript, supported, error, start, stop, clear, simulate }
}
