import { describe, it, expect } from 'vitest';
import { THEMES } from '../scenes.ts';
import { CEFR_LEVELS } from '../../types/lessonPlan.ts';
import { isGestureId } from '../gestures.ts';
import {
  MAX_CAST_OPTIONS, MAX_CHECKPOINTS_PER_STEP, MAX_CHECKPOINT_OPTIONS, MIN_CHECKPOINT_OPTIONS, castSize, speakingSlots,
} from '../../types/dialogueTask.ts';
import { TASK_TEMPLATES, applyTemplate, toTemplateSource } from './index.ts';

// 與 backend/src/dialogueTaskRoutes.ts 的上限一致；超過的模板老師套用後會存不進去
const MAX_TITLE_LEN = 100;
const MAX_TEXT_LEN = 1000;
const MAX_ID_LEN = 64;
const MAX_STEPS = 30;
const MAX_LINES_PER_STEP = 50;
const MAX_LIST_ITEMS = 20;

const SCENE_SLOTS = new Map(
  THEMES.flatMap(t => t.scenes).map(s => [s.id, new Set((s.slots ?? []).map(sl => sl.id))]),
);

describe('內建任務模板', () => {
  it('模板 id 不重複', () => {
    const ids = TASK_TEMPLATES.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe.each(TASK_TEMPLATES.map(t => [t.id, t] as const))('%s', (_id, tpl) => {
    it('上架資訊完整', () => {
      expect(tpl.id.length).toBeLessThanOrEqual(MAX_ID_LEN);
      expect(Number.isInteger(tpl.version) && tpl.version >= 1).toBe(true);
      expect(tpl.name.trim()).not.toBe('');
      expect(tpl.description.trim()).not.toBe('');
      expect(tpl.description).not.toContain('TODO');
    });

    it('場景與角色存在於 scenes.ts', () => {
      const slots = SCENE_SLOTS.get(tpl.task.sceneId);
      expect(slots, `找不到場景 ${tpl.task.sceneId}`).toBeDefined();
      for (const step of tpl.task.steps) {
        for (const line of step.lines) {
          expect(slots!.has(line.speakerSlotId), `${line.id} 的角色 ${line.speakerSlotId} 不在場景 ${tpl.task.sceneId}`).toBe(true);
        }
      }
    });

    it('程度合法、內容不為空', () => {
      expect(CEFR_LEVELS.map(l => l.value)).toContain(tpl.task.level);
      expect(tpl.task.title.trim()).not.toBe('');
      expect(tpl.task.steps.length).toBeGreaterThan(0);
      for (const step of tpl.task.steps) {
        expect(step.title.trim(), `步驟 ${step.id} 缺標題`).not.toBe('');
        expect(step.lines.length, `步驟 ${step.id} 沒有台詞`).toBeGreaterThan(0);
        for (const line of step.lines) {
          expect(line.en.trim(), `${line.id} 缺英文`).not.toBe('');
          expect(line.zh.trim(), `${line.id} 缺中文`).not.toBe('');
        }
      }
    });

    it('動作都在動作庫裡', () => {
      for (const line of tpl.task.steps.flatMap(s => s.lines)) {
        if (line.gesture !== undefined) expect(isGestureId(line.gesture), `${line.id} 的動作 ${line.gesture} 不在動作庫`).toBe(true);
      }
    });

    it('台下互動點格式正確（選項數、正確答案在選項內）', () => {
      for (const step of tpl.task.steps) {
        const cps = step.checkpoints ?? [];
        expect(cps.length).toBeLessThanOrEqual(MAX_CHECKPOINTS_PER_STEP);
        for (const cp of cps) {
          expect(cp.title.trim(), `${cp.id} 缺類型`).not.toBe('');
          expect(cp.question.trim(), `${cp.id} 缺題目`).not.toBe('');
          expect(cp.options.length).toBeGreaterThanOrEqual(MIN_CHECKPOINT_OPTIONS);
          expect(cp.options.length).toBeLessThanOrEqual(MAX_CHECKPOINT_OPTIONS);
          expect(cp.options.every(o => o.trim() !== '' && o.length <= MAX_TITLE_LEN), `${cp.id} 選項不可空白或過長`).toBe(true);
          expect(Number.isInteger(cp.answerIndex) && cp.answerIndex >= 0 && cp.answerIndex < cp.options.length, `${cp.id} 正確答案不在選項內`).toBe(true);
        }
      }
    });

    it('併角方案有效：人數少於完整人數且彼此不同', () => {
      const opts = tpl.task.castOptions ?? [];
      expect(opts.length).toBeLessThanOrEqual(MAX_CAST_OPTIONS);
      const full = speakingSlots(tpl.task).length;
      const sizes = opts.map(o => castSize(tpl.task, o.merge));
      for (const [i, size] of sizes.entries()) {
        expect(size, `第 ${i + 1} 個併角方案不成立`).not.toBeNull();
        expect(size!).toBeLessThan(full);
        expect(size!).toBeGreaterThanOrEqual(1);
      }
      expect(new Set(sizes).size).toBe(sizes.length);
    });

    it('步驟與台詞 id 在模板內不重複', () => {
      const ids = tpl.task.steps.flatMap(s => [s.id, ...s.lines.map(l => l.id), ...(s.checkpoints ?? []).map(c => c.id)]);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('不超過後端儲存上限', () => {
      const { task } = tpl;
      expect(task.title.length).toBeLessThanOrEqual(MAX_TITLE_LEN);
      expect(task.steps.length).toBeLessThanOrEqual(MAX_STEPS);
      for (const s of task.steps) {
        expect(s.title.length).toBeLessThanOrEqual(MAX_TITLE_LEN);
        expect(s.purpose.length).toBeLessThanOrEqual(MAX_TITLE_LEN);
        expect(s.lines.length).toBeLessThanOrEqual(MAX_LINES_PER_STEP);
        expect(s.grammarPoints.length).toBeLessThanOrEqual(MAX_LIST_ITEMS);
        expect(s.teachingNotes.length).toBeLessThanOrEqual(MAX_LIST_ITEMS);
        expect(s.grammarNote.length).toBeLessThanOrEqual(MAX_TEXT_LEN);
        for (const text of [...s.grammarPoints, ...s.teachingNotes, ...s.lines.flatMap(l => [l.en, l.zh])]) {
          expect(text.length).toBeLessThanOrEqual(MAX_TEXT_LEN);
        }
      }
    });
  });
});

describe('applyTemplate', () => {
  it('換上新 id、記錄來源，且不影響原模板', () => {
    const tpl = TASK_TEMPLATES[0];
    const task = applyTemplate(tpl);
    expect(task.sourceTemplate).toEqual({ id: tpl.id, version: tpl.version });
    expect(task.steps.map(s => s.id)).not.toContain(tpl.task.steps[0].id);
    expect(task.steps[0].lines[0].id).not.toBe(tpl.task.steps[0].lines[0].id);
    expect(task.steps[0].lines[0].en).toBe(tpl.task.steps[0].lines[0].en);
    task.steps[0].grammarPoints.push('x');
    task.steps[0].lines[0].en = 'changed';
    expect(tpl.task.steps[0].grammarPoints).not.toContain('x');
    expect(tpl.task.steps[0].lines[0].en).not.toBe('changed');
  });

  it('台下互動點一併複製（新 id、深拷貝）', () => {
    const tpl = TASK_TEMPLATES.find(t => t.task.steps.some(s => s.checkpoints?.length))!;
    const task = applyTemplate(tpl);
    const [orig, copy] = [tpl.task.steps[0].checkpoints![0], task.steps[0].checkpoints![0]];
    expect(copy).toMatchObject({ question: orig.question, options: orig.options, answerIndex: orig.answerIndex });
    expect(copy.id).not.toBe(orig.id);
    copy.options.push('x');
    expect(orig.options).not.toContain('x');
  });
});

describe('toTemplateSource', () => {
  it('產出可讀 id 的模板原始碼，內容可還原', () => {
    const task = applyTemplate(TASK_TEMPLATES[0]);
    const src = toTemplateSource(task, 'clothingStore_demo');
    expect(src).toContain('export const clothingStoreDemo: TaskTemplate = {');
    const json = src.slice(src.indexOf('= {') + 2, src.lastIndexOf('};') + 1);
    const parsed = JSON.parse(json);
    expect(parsed.id).toBe('clothingStore_demo');
    expect(parsed.task.steps[0].id).toBe('step1');
    expect(parsed.task.steps[0].lines[1].id).toBe('step1_2');
    expect(parsed.task.steps[0].lines[0].en).toBe(task.steps[0].lines[0].en);
    expect(parsed.task).not.toHaveProperty('sourceTemplate');
  });
});
