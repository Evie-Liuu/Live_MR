import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { firstCueOfStep, flattenCues, genderFromVrmId, pickRoleVoices, wornAt } from './scriptPlayback.ts';
import { gestureWeight, horizontalYaw, idleLoopSample, lookAngles, MAX_TORSO_YAW, mouthOpenness, splitTurn, wrapAngle } from './scriptedAvatar.ts';
import type { DialogueTask } from '../types/dialogueTask.ts';

const task: DialogueTask = {
  title: 't', sceneId: 's', level: 'A1',
  steps: [
    { id: 's1', title: '招呼', purpose: '', grammarPoints: [], grammarNote: '', teachingNotes: [], lines: [
      { id: 'a', speakerSlotId: 'cashier', en: 'Hi.', zh: '嗨' },
      { id: 'b', speakerSlotId: 'customer', en: 'Hello.', zh: '哈囉' },
    ] },
    { id: 's2', title: '空步驟', purpose: '', grammarPoints: [], grammarNote: '', teachingNotes: [], lines: [] },
    { id: 's3', title: '結帳', purpose: '', grammarPoints: [], grammarNote: '', teachingNotes: [], lines: [
      { id: 'c', speakerSlotId: 'cashier', en: 'Bye.', zh: '再見' },
    ] },
  ],
};

const voice = (name: string, lang = 'en-US') => ({ name, lang, voiceURI: name, localService: true, default: false }) as SpeechSynthesisVoice;

describe('flattenCues / firstCueOfStep', () => {
  it('flattens lines in step order with indices', () => {
    const cues = flattenCues(task);
    expect(cues.map(c => [c.index, c.stepIndex, c.line.id])).toEqual([[0, 0, 'a'], [1, 0, 'b'], [2, 2, 'c']]);
    expect(cues[2].stepTitle).toBe('結帳');
  });

  it('finds the first cue of a step, skipping empty steps', () => {
    const cues = flattenCues(task);
    expect(firstCueOfStep(cues, 0)).toBe(0);
    expect(firstCueOfStep(cues, 1)).toBe(2);
    expect(firstCueOfStep(cues, 3)).toBe(-1);
  });
});

describe('wornAt', () => {
  const line = (speakerSlotId: string, prop?: string, wear?: boolean) =>
    ({ id: `${speakerSlotId}-${prop}`, speakerSlotId, en: 'x', zh: 'x', ...(prop ? { prop } : {}), ...(wear ? { wear } : {}) });
  const step = (lines: ReturnType<typeof line>[]) =>
    ({ id: 's', title: 't', purpose: '', lines, grammarPoints: [], grammarNote: '', teachingNotes: [] });
  const isHead = (id: string) => (id === 'hat' ? 'head' : 'body');
  const tryOn: DialogueTask = {
    title: 't', sceneId: 'clothingStore_fitting', level: 'A1',
    steps: [
      step([line('a', 'jeans'), line('a', 'jeans', true), line('b'), line('a', 'dress', true), line('a', 'hat', true)]),
      step([line('b', 'hat'), line('a')]),
    ],
  };
  const cues = flattenCues(tryOn);

  it('拿在手上不算穿；試穿後別人說話時仍穿著', () => {
    expect(wornAt(cues, 0, isHead)).toEqual([]);
    expect(wornAt(cues, 2, isHead)).toEqual([{ slotId: 'a', propId: 'jeans' }]);
  });

  it('同一人換穿衣服換掉舊的，帽子可以同時戴', () => {
    expect(wornAt(cues, 3, isHead)).toEqual([{ slotId: 'a', propId: 'dress' }]);
    expect(wornAt(cues, 4, isHead)).toEqual([{ slotId: 'a', propId: 'dress' }, { slotId: 'a', propId: 'hat' }]);
  });

  it('換步驟就脫下；被別人拿起也脫下', () => {
    expect(wornAt(cues, 5, isHead)).toEqual([]);
    const sameStep = flattenCues({ ...tryOn, steps: [step([line('a', 'hat', true), line('b', 'hat')])] });
    expect(wornAt(sameStep, 1, isHead)).toEqual([]);
  });
});

describe('pickRoleVoices', () => {
  it('gives each role a different English voice, respecting gender hints', () => {
    const voices = [voice('Microsoft David - English (United States)'), voice('Microsoft Zira - English (United States)'), voice('Chinese', 'zh-TW')];
    const r = pickRoleVoices(voices, ['cashier', 'customer'], { cashier: 'female', customer: 'male' });
    expect(r.cashier.voice?.name).toContain('Zira');
    expect(r.customer.voice?.name).toContain('David');
    expect(r.cashier.pitch).toBe(1);
  });

  it('shares a voice with a different pitch when only one is available', () => {
    const r = pickRoleVoices([voice('Google US English')], ['cashier', 'customer']);
    expect(r.cashier.voice?.name).toBe('Google US English');
    expect(r.customer.voice?.name).toBe('Google US English');
    expect(r.customer.pitch).not.toBe(r.cashier.pitch);
  });

  it('returns null voices when no English voice exists', () => {
    expect(pickRoleVoices([voice('Chinese', 'zh-TW')], ['a']).a.voice).toBeNull();
  });

  it('guesses gender from vrm ids', () => {
    expect(genderFromVrmId('clothingStoreStaff_female')).toBe('female');
    expect(genderFromVrmId('student_male')).toBe('male');
    expect(genderFromVrmId('default')).toBeUndefined();
  });
});

describe('scriptedAvatar math', () => {
  const forward = new THREE.Vector3(0, 0, 1);
  const left = new THREE.Vector3(1, 0, 0);

  it('lookAngles: target on the left is positive yaw, above is positive up, both clamped', () => {
    expect(lookAngles(forward, left, new THREE.Vector3(1, 0, 1)).yaw).toBeCloseTo(Math.PI / 4);
    expect(lookAngles(forward, left, new THREE.Vector3(-1, 0, 1)).yaw).toBeCloseTo(-Math.PI / 4);
    expect(lookAngles(forward, left, new THREE.Vector3(0, 0.2, 1)).up).toBeGreaterThan(0);
    expect(lookAngles(forward, left, new THREE.Vector3(5, 0, -1)).yaw).toBeCloseTo((55 * Math.PI) / 180);
  });

  it('lookAngles: 上半身已轉過去時，頭只轉剩下的角度', () => {
    // 物件在左前方 80°，上半身轉了 60° → 頭再轉 20°
    const dir = new THREE.Vector3(Math.sin(80 * Math.PI / 180), 0, Math.cos(80 * Math.PI / 180));
    expect(lookAngles(forward, left, dir, (60 * Math.PI) / 180).yaw).toBeCloseTo((20 * Math.PI) / 180);
    // 轉過頭了就往回看
    expect(lookAngles(forward, left, new THREE.Vector3(0, 0, 1), (30 * Math.PI) / 180).yaw).toBeCloseTo((-30 * Math.PI) / 180);
  });

  it('horizontalYaw / wrapAngle: 水平角不看高度，角度換到 ±π 內', () => {
    expect(horizontalYaw(forward, left, new THREE.Vector3(1, 5, 1))).toBeCloseTo(Math.PI / 4);
    expect(horizontalYaw(forward, left, new THREE.Vector3(-1, 0, 0))).toBeCloseTo(-Math.PI / 2);
    expect(wrapAngle(Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2);
    expect(wrapAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2);
  });

  it('splitTurn: 小角度只扭上半身，物件在背後時整個人轉過去', () => {
    expect(splitTurn(0.3)).toEqual({ torso: 0.3, root: 0 });
    const behind = splitTurn(-170 * Math.PI / 180);
    expect(behind.torso).toBeCloseTo(-MAX_TORSO_YAW);
    expect(behind.torso + behind.root).toBeCloseTo(-170 * Math.PI / 180);
  });

  it('gestureWeight fades in, holds at 1 and fades out', () => {
    expect(gestureWeight(0, 2)).toBe(0);
    expect(gestureWeight(0.1, 2)).toBeGreaterThan(0);
    expect(gestureWeight(0.1, 2)).toBeLessThan(1);
    expect(gestureWeight(1, 2)).toBe(1);
    expect(gestureWeight(1.9, 2)).toBeLessThan(1);
    expect(gestureWeight(2, 2)).toBe(0);
  });

  it('idleLoopSample ends each cycle exactly where the next one starts', () => {
    const duration = 8.3;
    const fade = 0.8;
    const span = duration - fade;
    const start = idleLoopSample(0, duration);
    expect(start).toEqual({ time: fade, wrapTime: 0, wrapWeight: 0 });
    // 混到底時的姿勢（wrapTime）等於下一輪起點（time）
    const end = idleLoopSample(span - 1e-6, duration);
    expect(end.time).toBeCloseTo(duration, 4);
    expect(end.wrapTime).toBeCloseTo(fade, 4);
    expect(end.wrapWeight).toBeCloseTo(1, 4);
    expect(idleLoopSample(span, duration).time).toBeCloseTo(fade);
    // 循環前段不混合，取樣永遠不超出動作範圍
    expect(idleLoopSample(1, duration).wrapWeight).toBe(0);
    for (let t = 0; t < 40; t += 0.037) {
      const s = idleLoopSample(t, duration);
      expect(s.time).toBeGreaterThanOrEqual(fade);
      expect(s.time).toBeLessThanOrEqual(duration);
    }
  });

  it('idleLoopSample handles short and empty clips', () => {
    expect(idleLoopSample(5, 0)).toEqual({ time: 0, wrapTime: 0, wrapWeight: 0 });
    const s = idleLoopSample(0.1, 1);
    expect(s.time).toBeCloseTo(0.6);
    expect(s.wrapWeight).toBeGreaterThan(0);
  });

  it('mouthOpenness stays within 0..1', () => {
    for (let t = 0; t < 5; t += 0.013) {
      const v = mouthOpenness(t, 1.7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
