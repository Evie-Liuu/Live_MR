/**
 * Transcript → AI 送出前的過濾接口（規則引擎預留點）。
 *
 * 目前預設 passThroughGate 永遠通過，行為與既有一致。
 * 未來「背景持續 STT + 規則引擎過濾」可實作此介面，在 accept() 內以規則
 * （最短長度、填詞、教學語句偵測、停頓碎句等）回傳 false 來攔截，
 * 無需改動 handleHint 的送出管線。
 */
export interface TranscriptGateCtx {
  /** 目前場景 ID */
  sceneId: string;
  /** 觸發來源 */
  source: 'spacebar' | 'button' | 'auto-script';
}

export interface TranscriptGate {
  /** 回傳 true 才會把 transcript 送去 AI */
  accept(text: string, ctx: TranscriptGateCtx): boolean;
}

/** 預設閘門：永遠通過（不改變現有行為）。 */
export const passThroughGate: TranscriptGate = {
  accept: () => true,
};
