import { useEffect, useRef } from 'react';

/**
 * 逐句演練：發言者 iPad 本機的即時語音辨識（Web Speech，en-US，含 interim）。
 *
 * iPadOS Safari 同時開 LiveKit 麥克風與語音辨識可能互相搶音訊，尚未實機驗證，
 * 所以預設關閉：網址帶 `?turnStt=1` 開啟（記在 localStorage，之後不用再帶），`?turnStt=0` 關閉。
 * 關閉時聆聽畫面改顯示對方這一句的台詞。
 */
const STORAGE_KEY = 'livemr-turn-stt';

export function turnSttEnabled(): boolean {
  try {
    const param = new URLSearchParams(window.location.search).get('turnStt');
    if (param === '1' || param === '0') localStorage.setItem(STORAGE_KEY, param);
    return localStorage.getItem(STORAGE_KEY) === '1' && speechRecognitionCtor() !== null;
  } catch {
    return false;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySpeechRecognition = any;

function speechRecognitionCtor(): AnySpeechRecognition | null {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/**
 * enabled 為 true 時持續辨識，每次有新結果就以「到目前為止的整句」呼叫 onText；
 * 引擎自己停下（沉默逾時）會自動重開，enabled 變 false 時停止。
 */
export function useTurnTranscript(enabled: boolean, onText: (text: string, final: boolean) => void): void {
  const onTextRef = useRef(onText);
  useEffect(() => { onTextRef.current = onText; }, [onText]);

  useEffect(() => {
    const Ctor = enabled ? speechRecognitionCtor() : null;
    if (!Ctor) return;
    let active = true;
    let finals = '';
    let recog: AnySpeechRecognition = null;

    const start = () => {
      recog = new Ctor();
      recog.continuous = true;
      recog.interimResults = true;
      recog.lang = 'en-US';
      recog.onresult = (e: AnySpeechRecognition) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finals = `${finals} ${r[0].transcript}`.trim();
          else interim += r[0].transcript;
        }
        onTextRef.current(`${finals} ${interim}`.trim(), interim === '');
      };
      recog.onerror = () => { /* 交給 onend 重開；權限被拒時 onend 後 start 會再丟錯而停止 */ };
      recog.onend = () => {
        if (!active) return;
        try { start(); } catch { /* 無法重開：放棄，聆聽端改看台詞 */ }
      };
      recog.start();
    };

    try { start(); } catch { /* 不支援或權限被拒 */ }
    return () => {
      active = false;
      try { recog?.stop(); } catch { /* ignore */ }
    };
  }, [enabled]);
}
