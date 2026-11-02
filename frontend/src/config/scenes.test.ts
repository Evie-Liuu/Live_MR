import { describe, expect, it } from 'vitest';
import { SCENE_PRESETS, propForTask } from './scenes';

describe('propForTask', () => {
  const sceneId = 'clothingStore_cashier';

  it('任務對應到可識別的道具 id', () => {
    expect(propForTask(sceneId, 'ask_price_1')).toBe('tshirt_blue');
    expect(propForTask(sceneId, 'ask_price_5')).toBe('pants_jeans');
  });

  it('沒有對應道具的任務回傳 undefined', () => {
    expect(propForTask(sceneId, 'ask_price_6')).toBeUndefined();
    expect(propForTask(sceneId, undefined)).toBeUndefined();
  });
});

describe('場景的 taskProps', () => {
  it('群組成員引用的道具都存在', () => {
    for (const preset of Object.values(SCENE_PRESETS)) {
      const taskProps = preset.propSystem?.taskProps ?? {};
      for (const group of preset.groups ?? []) {
        for (const member of group.members) {
          if (member.kind === 'taskProp') expect(taskProps).toHaveProperty(member.id);
        }
      }
    }
  });
});
