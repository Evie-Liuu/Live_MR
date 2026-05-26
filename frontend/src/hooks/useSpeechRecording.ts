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

  const stop = useCallback(() => {
    recogRef.current?.stop()
  }, [])

  const start = useCallback(() => {
    if (!SpeechRecognitionCtor) return
    if (recogRef.current) {
      try { recogRef.current.abort() } catch { /* ignore */ }
    }
    setInterim('')
    setTranscript('')
    setError(null)
    finalBufferRef.current = ''

    const recog = new SpeechRecognitionCtor()
    recog.continuous = true
    recog.interimResults = true
    recog.lang = 'en-US'

    recog.onresult = (e: AnySpeechRecognition) => {
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
      if (e.error === 'aborted' || e.error === 'no-speech') return
      setError(`STT error: ${e.error ?? 'unknown'}`)
    }

    recog.onend = () => {
      const final = finalBufferRef.current.trim()
      setTranscript(isTooShortOrFiller(final) ? '' : final)
      setInterim('')
      setRecording(false)
      finalBufferRef.current = ''
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
