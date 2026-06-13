import { useRef, useState, useCallback, useEffect } from 'react'

export interface UseSpeechRecordingResult {
  recording: boolean
  interim: string
  transcript: string
  supported: boolean
  error: string | null
  start: () => void
  /**
   * 停止錄音。可選 `onFinal` 會在引擎收尾後被呼叫一次，帶回清理過的最終
   * transcript（無有效語音時為空字串）。用此「事件」驅動後續流程，避免依賴
   * `transcript` 狀態變化 —— 空結果時 `setTranscript('')` 不會觸發任何 effect。
   */
  stop: (onFinal?: (final: string) => void) => void
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
  // 最近一次尚未被引擎標為 isFinal 的 interim 文字。stop() 收尾時併入 final，
  // 避免「畫面看得到收音、但 Chrome 未把尾段 interim 轉成 final」→ 最終 transcript 為空。
  const interimRef = useRef('')
  // 引擎是否「目前正在聆聽」。自動重啟有 setTimeout(0) 的空檔；若此時呼叫 stop()，
  // recog 已 end、不會再有 onend → callback 永遠不觸發。用此旗標在空檔時改為立即收尾。
  const recogActiveRef = useRef(false)
  const abortedRef = useRef(false)
  // 由呼叫端主動 stop() 設旗標。引擎自動 onend（如 Chrome 沉默超時）會看不到此旗標 → 自動重啟。
  const stoppingRef = useRef(false)
  // 主動 stop() 時暫存的收尾 callback，onend 收尾路徑會以最終 transcript 呼叫一次。
  const onFinalRef = useRef<((final: string) => void) | null>(null)

  // 收尾：併入尾段 interim、清理、回傳清理後的最終 transcript（空字串代表無有效語音）。
  const finalizeStop = useCallback((): string => {
    const combined = [finalBufferRef.current, interimRef.current]
      .map((s) => s.trim()).filter(Boolean).join(' ')
    const cleaned = isTooShortOrFiller(combined) ? '' : combined
    setTranscript(cleaned)
    setInterim('')
    setRecording(false)
    finalBufferRef.current = ''
    interimRef.current = ''
    stoppingRef.current = false
    const cb = onFinalRef.current
    onFinalRef.current = null
    cb?.(cleaned)
    return cleaned
  }, [])

  const stop = useCallback((onFinal?: (final: string) => void) => {
    stoppingRef.current = true
    onFinalRef.current = onFinal ?? null
    if (recogActiveRef.current) {
      // 引擎在聆聽中 → 觸發 stop()，由 onend 的 stopping 分支收尾。
      try { recogRef.current?.stop() } catch { /* ignore */ }
    } else {
      // 引擎不在聆聽（自動重啟空檔或已結束）→ 不會再有 onend；阻止待執行的自動重啟並立即收尾。
      abortedRef.current = true
      finalizeStop()
    }
  }, [finalizeStop])

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
      interimRef.current = interimText
      setInterim(interimText)
    }

    recog.onerror = (e: AnySpeechRecognition) => {
      if (recogRef.current !== recog) return
      if (e.error === 'aborted' || e.error === 'no-speech') return
      setError(`STT error: ${e.error ?? 'unknown'}`)
    }

    recog.onend = () => {
      if (recogRef.current !== recog) return // 舊 instance — 新 session 已取代，忽略
      recogActiveRef.current = false
      if (abortedRef.current) {
        setInterim('')
        setRecording(false)
        return
      }
      if (stoppingRef.current) {
        // 呼叫端主動 stop() — 併入尾段 interim、收尾並以「事件」帶回最終 transcript。
        finalizeStop()
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
          recogActiveRef.current = true
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
    recogActiveRef.current = true
    setRecording(true)
  }, [SpeechRecognitionCtor, finalizeStop])

  const clear = useCallback(() => {
    setTranscript('')
    setInterim('')
    finalBufferRef.current = ''
    interimRef.current = ''
  }, [])

  const simulate = useCallback((text: string) => {
    abortedRef.current = true
    recogActiveRef.current = false
    try { recogRef.current?.abort() } catch { /* ignore */ }
    finalBufferRef.current = ''
    interimRef.current = ''
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
