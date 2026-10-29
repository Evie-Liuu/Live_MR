import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { RoomEvent, Track, type Room } from 'livekit-client';
import { SCRIPT_TURN_STALE_MS, TURN_TRANSCRIPT_THROTTLE_MS } from '../config/constants.ts';
import { turnRoleOf, type ScriptTurn, type TurnRole } from '../utils/scriptTurn.ts';
import { MAX_HINT_LEVEL, nextHintLevel, type HintLevel } from '../utils/turnHints.ts';
import { turnSttEnabled, useTurnTranscript } from './useTurnTranscript.ts';

/** 「我說完了」沒換句時的重送間隔與次數 */
const DONE_RETRY_MS = 3000;
const DONE_MAX_RETRIES = 2;
/** 分級提示的檢查間隔 */
const HINT_TICK_MS = 5000;

export interface ScriptTurnStudent {
  turn: ScriptTurn | null;
  role: TurnRole;
  /** 目前發言者的即時逐字稿（自己發言時是自己的） */
  transcript: string;
  /** 這台裝置會產生逐字稿（沒有時聆聽端改看台詞） */
  sttEnabled: boolean;
  /** 本輪已按過「我說完了」 */
  doneSent: boolean;
  sendDone: () => void;
  /** 發言時的提示等級（完整台詞模式固定 3） */
  hintLevel: HintLevel;
  /** 收到 data 訊息：是逐句演練的訊息就處理並回 true */
  handleData: (msg: { type?: string; turn?: ScriptTurn | null; seq?: number; text?: string; level?: number }, from: string) => boolean;
}

/**
 * 學生端逐句演練：收老師的這一輪、聆聽時把麥克風靜音（只錄發言者）、
 * 「我說完了」回報與重送、發言時送出自己的即時逐字稿。
 * 老師超過 SCRIPT_TURN_STALE_MS 沒重送（斷線）就回到一般畫面並恢復麥克風。
 * 分級提示：輪到自己時依沉默時間自動升級（selfTalking 來自 LiveKit ActiveSpeakers），老師也可以手動加一級；
 * 目前等級回報給老師。
 */
export function useScriptTurnStudent(
  roomRef: RefObject<Room | null>,
  identity: string | null,
  selfTalking: boolean,
): ScriptTurnStudent {
  const [turn, setTurn] = useState<ScriptTurn | null>(null);
  const turnRef = useRef(turn);
  useEffect(() => { turnRef.current = turn; }, [turn]);
  const receivedAtRef = useRef(0);
  const hostRef = useRef<string | null>(null);
  const [transcript, setTranscript] = useState<{ seq: number; text: string } | null>(null);
  const [doneSeq, setDoneSeq] = useState<number | null>(null);
  const [sttEnabled] = useState(turnSttEnabled);

  const role = turnRoleOf(turn, identity);
  const speakingSeq = role === 'speaking' && turn ? turn.seq : null;
  const tiered = turn?.hintMode !== 'full';
  const hintAuto = turn?.hintAuto === true;
  const [hint, setHint] = useState<{ seq: number; level: HintLevel; by: 'auto' | 'teacher' } | null>(null);
  const hintLevel: HintLevel = !tiered ? MAX_HINT_LEVEL : hint && hint.seq === speakingSeq ? hint.level : 0;
  const hintLevelRef = useRef(hintLevel);
  useEffect(() => { hintLevelRef.current = hintLevel; }, [hintLevel]);
  /** 本輪升到目前等級的時間、最後出聲的時間（0＝還沒開口） */
  const levelAtRef = useRef(0);
  const lastVoiceAtRef = useRef(0);
  const selfTalkingRef = useRef(selfTalking);
  useEffect(() => {
    selfTalkingRef.current = selfTalking;
    if (selfTalking && speakingSeq !== null) lastVoiceAtRef.current = Date.now();
  }, [selfTalking, speakingSeq]);
  useEffect(() => {
    levelAtRef.current = Date.now();
    lastVoiceAtRef.current = 0;
  }, [speakingSeq]);
  /** 自動只會往上升；老師指定的等級照設（可以往回收） */
  const raiseHint = useCallback((seq: number, level: HintLevel, by: 'auto' | 'teacher') => {
    if (by === 'auto' ? level <= hintLevelRef.current : level === hintLevelRef.current) return;
    hintLevelRef.current = level;
    levelAtRef.current = Date.now();
    setHint({ seq, level, by });
  }, []);

  const handleData = useCallback<ScriptTurnStudent['handleData']>((msg, from) => {
    if (msg.type === 'script-turn') {
      if (!from.startsWith('host-')) return true;
      hostRef.current = from;
      receivedAtRef.current = Date.now();
      setTurn(msg.turn ?? null);
      return true;
    }
    if (msg.type === 'turn-hint') {
      // 老師手動指定提示等級（只送給發言者）
      const t = turnRef.current;
      if (from.startsWith('host-') && t && msg.seq === t.seq && typeof msg.level === 'number') {
        raiseHint(t.seq, Math.min(MAX_HINT_LEVEL, Math.max(0, Math.round(msg.level))) as HintLevel, 'teacher');
      }
      return true;
    }
    if (msg.type === 'turn-transcript') {
      const t = turnRef.current;
      if (t && msg.seq === t.seq && from === t.speaker.identity && typeof msg.text === 'string') {
        setTranscript({ seq: t.seq, text: msg.text.slice(-300) });
      }
      return true;
    }
    return false;
  }, [raiseHint]);

  // 老師斷線保險：太久沒收到就回到一般畫面
  useEffect(() => {
    if (!turn) return;
    const timer = window.setInterval(() => {
      if (Date.now() - receivedAtRef.current > SCRIPT_TURN_STALE_MS) setTurn(null);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [turn]);

  // 只錄發言者：演練進行中（含暫停、步驟講完）不是發言者就把麥克風靜音
  // （保留發布，換回發言或演練結束時立即恢復）。
  // 麥克風晚於輪到聆聽才發布（剛連上、斷線重連）時也要補靜音，所以同時監聽本地發布事件。
  const mutedByTurnRef = useRef(false);
  const muteMic = !!turn && role !== 'speaking';
  useEffect(() => {
    const room = roomRef.current;
    const apply = () => {
      const pub = room?.localParticipant.getTrackPublication(Track.Source.Microphone);
      if (!pub) return;
      if (muteMic && !pub.isMuted) {
        mutedByTurnRef.current = true;
        void pub.mute().catch(() => { /* ignore */ });
      } else if (!muteMic && mutedByTurnRef.current) {
        mutedByTurnRef.current = false;
        void pub.unmute().catch(() => { /* ignore */ });
      }
    };
    apply();
    if (!room) return;
    room.on(RoomEvent.LocalTrackPublished, apply);
    return () => { room.off(RoomEvent.LocalTrackPublished, apply); };
  }, [muteMic, roomRef]);
  useEffect(() => () => {
    if (!mutedByTurnRef.current) return;
    const pub = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Microphone);
    void pub?.unmute().catch(() => { /* ignore */ });
  }, [roomRef]);

  const publish = useCallback((data: object, reliable: boolean, to?: string[]) => {
    const room = roomRef.current;
    if (!room || room.state !== 'connected') return;
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(data));
      void room.localParticipant.publishData(bytes, { reliable, ...(to ? { destinationIdentities: to } : {}) }).catch(() => { /* ignore */ });
    } catch { /* ignore */ }
  }, [roomRef]);

  const sendDone = useCallback(() => {
    const t = turnRef.current;
    if (!t || t.status !== 'running') return;
    const seq = t.seq;
    setDoneSeq(seq);
    const send = (attempt: number) => {
      // 已換句（或演練結束）就不用再送
      if (turnRef.current?.seq !== seq) return;
      publish({ type: 'turn-done', seq }, true, hostRef.current ? [hostRef.current] : undefined);
      if (attempt < DONE_MAX_RETRIES) window.setTimeout(() => send(attempt + 1), DONE_RETRY_MS);
    };
    send(0);
  }, [publish]);

  // 自動提示：沒開口 4 秒、開口後停住 2.5 秒就升一級；老師關掉自動或按了「我說完了」就停
  const doneSentNow = doneSeq !== null && doneSeq === speakingSeq;
  useEffect(() => {
    if (speakingSeq === null || !tiered || !hintAuto || doneSentNow) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (selfTalkingRef.current) lastVoiceAtRef.current = now;
      const level = hintLevelRef.current;
      const next = nextHintLevel({ level, levelAt: levelAtRef.current, lastVoiceAt: lastVoiceAtRef.current, now });
      if (next !== level) raiseHint(speakingSeq, next, 'auto');
    }, HINT_TICK_MS);
    return () => window.clearInterval(timer);
  }, [speakingSeq, tiered, hintAuto, doneSentNow, raiseHint]);

  // 目前提示等級回報給老師（輪到自己時、每次升級時）
  const hintBy = hint && hint.seq === speakingSeq ? hint.by : 'auto';
  useEffect(() => {
    if (speakingSeq === null) return;
    publish({ type: 'turn-hint-level', seq: speakingSeq, level: hintLevel, by: hintBy }, true, hostRef.current ? [hostRef.current] : undefined);
  }, [speakingSeq, hintLevel, hintBy, publish]);

  // 發言時送出自己的即時逐字稿（節流；說完一段時一定送）
  const sentAtRef = useRef(0);
  const pendingRef = useRef<number | null>(null);
  const onOwnText = useCallback((text: string, final: boolean) => {
    const t = turnRef.current;
    if (!t) return;
    const seq = t.seq;
    setTranscript({ seq, text });
    const send = () => {
      pendingRef.current = null;
      sentAtRef.current = Date.now();
      publish({ type: 'turn-transcript', seq, text: text.slice(-300), final }, false);
    };
    if (pendingRef.current !== null) window.clearTimeout(pendingRef.current);
    const wait = TURN_TRANSCRIPT_THROTTLE_MS - (Date.now() - sentAtRef.current);
    if (final || wait <= 0) send();
    else pendingRef.current = window.setTimeout(send, wait);
  }, [publish]);
  useTurnTranscript(sttEnabled && role === 'speaking', onOwnText);

  return {
    turn,
    role,
    transcript: transcript && transcript.seq === turn?.seq ? transcript.text : '',
    sttEnabled,
    doneSent: doneSeq !== null && doneSeq === turn?.seq,
    sendDone,
    hintLevel,
    handleData,
  };
}
