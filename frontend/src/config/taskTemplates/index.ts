import type { DialogueTask } from '../../types/dialogueTask.ts';
import { createId } from '../../types/dialogueTask.ts';
import type { TaskTemplate } from './types.ts';
import { clothingStoreShopping } from './clothingStore_shopping.ts';
import { clothingStoreSize } from './clothingStore_size.ts';
import { clothingStoreReturn } from './clothingStore_return.ts';

export type { TaskTemplate } from './types.ts';

/** 任務庫內建模板（顯示順序即此陣列順序）。新增模板見 ./README.md */
export const TASK_TEMPLATES: readonly TaskTemplate[] = [
  clothingStoreShopping,
  clothingStoreSize,
  clothingStoreReturn,
];

/** 套用模板：深拷貝內容、換上新 id，並記錄來源模板。回傳的任務尚未存檔。 */
export function applyTemplate(template: TaskTemplate): DialogueTask {
  const { task } = template;
  return {
    title: task.title,
    sceneId: task.sceneId,
    level: task.level,
    steps: task.steps.map(s => ({
      ...s,
      id: createId('step'),
      lines: s.lines.map(l => ({ ...l, id: createId('line') })),
      grammarPoints: [...s.grammarPoints],
      teachingNotes: [...s.teachingNotes],
    })),
    sourceTemplate: { id: template.id, version: template.version },
  };
}

function toCamel(id: string): string {
  return id.replace(/[_-](\w)/g, (_, c: string) => c.toUpperCase());
}

/**
 * 開發工具：把編輯器中的任務轉成模板檔的 TS 原始碼（任務編輯器在 DEV 模式的「匯出為模板」使用）。
 * 步驟 id 改成 step1、step2…，台詞 id 改成 step1_1…，方便閱讀與日後 diff。
 */
export function toTemplateSource(task: DialogueTask, templateId: string): string {
  const readable: DialogueTask = {
    title: task.title,
    sceneId: task.sceneId,
    level: task.level,
    steps: task.steps.map((s, i) => ({
      id: `step${i + 1}`,
      title: s.title,
      purpose: s.purpose,
      lines: s.lines.map((l, j) => ({
        id: `step${i + 1}_${j + 1}`, speakerSlotId: l.speakerSlotId, en: l.en, zh: l.zh,
        ...(l.gesture ? { gesture: l.gesture } : {}),
      })),
      grammarPoints: s.grammarPoints,
      grammarNote: s.grammarNote,
      teachingNotes: s.teachingNotes,
    })),
  };
  const template: TaskTemplate = {
    id: templateId,
    version: 1,
    name: task.title,
    description: 'TODO：一句話說明',
    tags: [],
    task: readable,
  };
  const body = JSON.stringify(template, null, 2);
  return [
    `// frontend/src/config/taskTemplates/${templateId}.ts`,
    `// 貼上後：補 description / tags，並在 index.ts 的 TASK_TEMPLATES 加入 ${toCamel(templateId)}`,
    `import type { TaskTemplate } from './types.ts';`,
    '',
    `export const ${toCamel(templateId)}: TaskTemplate = ${body};`,
    '',
  ].join('\n');
}
