/**
 * 劇本模擬器的播放資料：把 DialogueTask 攤平成逐句 cue，並替每個角色挑選瀏覽器 TTS 聲音。
 */
import type { DialogueLine, DialogueTask } from '../types/dialogueTask.ts';

export interface ScriptCue {
  /** 在整份劇本中的序號（0 起算） */
  index: number;
  stepIndex: number;
  stepTitle: string;
  line: DialogueLine;
}

/** 依步驟順序攤平所有台詞 */
export function flattenCues(task: DialogueTask): ScriptCue[] {
  const cues: ScriptCue[] = [];
  task.steps.forEach((step, stepIndex) => {
    for (const line of step.lines) {
      cues.push({ index: cues.length, stepIndex, stepTitle: step.title, line });
    }
  });
  return cues;
}

/** 某步驟第一句的 cue 序號；該步驟沒有台詞則往後找，都沒有回 -1 */
export function firstCueOfStep(cues: ScriptCue[], stepIndex: number): number {
  const found = cues.find(c => c.stepIndex >= stepIndex);
  return found ? found.index : -1;
}

export interface RoleVoice {
  voice: SpeechSynthesisVoice | null;
  /** 同一個聲音被多個角色共用時，用音高區分 */
  pitch: number;
}

const FEMALE_HINT = /female|woman|zira|aria|jenny|samantha|victoria|karen|moira|tessa|susan|hazel|libby|sonia|google us english|google uk english female/i;
const MALE_HINT = /\bmale\b|\bman\b|david|mark|guy|daniel|alex|fred|george|ryan|google uk english male/i;

/**
 * 替每個角色挑英文聲音：盡量讓不同角色用不同聲音；聲音不夠時改用不同音高區分。
 * genderHints 可指定角色偏好（依場景的預設模型推斷，例如 staff_female → 'female'）。
 */
export function pickRoleVoices(
  voices: SpeechSynthesisVoice[],
  slotIds: string[],
  genderHints: Record<string, 'female' | 'male' | undefined> = {},
): Record<string, RoleVoice> {
  const english = voices.filter(v => /^en[-_]/i.test(v.lang));
  const pool = english.filter(v => /^en[-_]US/i.test(v.lang)).concat(english.filter(v => !/^en[-_]US/i.test(v.lang)));
  const used = new Set<SpeechSynthesisVoice>();
  const result: Record<string, RoleVoice> = {};
  const PITCHES = [1.05, 0.9, 1.2, 0.8];

  slotIds.forEach((slotId, i) => {
    const hint = genderHints[slotId];
    const matchesHint = (v: SpeechSynthesisVoice) =>
      hint === 'female' ? FEMALE_HINT.test(v.name)
        : hint === 'male' ? MALE_HINT.test(v.name) && !FEMALE_HINT.test(v.name)
          : true;
    const voice =
      pool.find(v => !used.has(v) && matchesHint(v)) ??
      pool.find(v => !used.has(v)) ??
      pool[0] ??
      null;
    const shared = voice !== null && used.has(voice);
    if (voice) used.add(voice);
    result[slotId] = { voice, pitch: shared ? PITCHES[i % PITCHES.length] : 1 };
  });
  return result;
}

/** 由模型 id 推測性別（只用來挑聲音，猜不到回 undefined） */
export function genderFromVrmId(vrmId: string | undefined): 'female' | 'male' | undefined {
  if (!vrmId) return undefined;
  if (/female/i.test(vrmId)) return 'female';
  if (/male/i.test(vrmId)) return 'male';
  return undefined;
}
