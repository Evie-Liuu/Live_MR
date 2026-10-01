import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { firstCueOfStep, flattenCues, genderFromVrmId, pickRoleVoices } from './scriptPlayback.ts';
import { lookAngles, mouthOpenness } from './scriptedAvatar.ts';
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

  it('mouthOpenness stays within 0..1', () => {
    for (let t = 0; t < 5; t += 0.013) {
      const v = mouthOpenness(t, 1.7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
