import { describe, expect, it } from 'vitest';
import type { SceneConfig } from '../types/vrm';
import { hiddenMembers, readSavedSceneLayout, resolveGroupPlacements } from './savedSceneLayout';

const preset = {
  slots: [{ id: 'a', label: 'A', position: [1, 0, 0] }, { id: 'b', label: 'B', position: [3, 0, 0] }],
  propSystem: {
    staticProps: [{ id: 'rack', label: 'rack', url: '', position: [2, 0, 0] }],
    taskProps: { shirt: { label: 'shirt', url: '', displayPos: [2, 1, 0] } },
  },
  groups: [{ id: 'g', label: 'G', members: [
    { kind: 'slot', id: 'a' }, { kind: 'slot', id: 'b' },
    { kind: 'staticProp', id: 'rack' }, { kind: 'taskProp', id: 'shirt' },
  ] }],
} as unknown as SceneConfig;

const storage = (data: Record<string, unknown>) => ({ getItem: (k: string) => (k in data ? JSON.stringify(data[k]) : null) });

describe('readSavedSceneLayout', () => {
  it('reads only the given scene', () => {
    const layout = readSavedSceneLayout('s1', storage({
      'bigscreen-group-transforms': { s1: { g: { pos: [1, 0, 0], rot: [0, 0, 0] } }, s2: {} },
      'bigscreen-group-hidden': { s1: { g: true } },
    }));
    expect(layout.groupTransforms.g.pos).toEqual([1, 0, 0]);
    expect(layout.groupHidden).toEqual({ g: true });
    expect(layout.occluders).toEqual([]);
  });

  it('falls back to defaults on broken data', () => {
    const layout = readSavedSceneLayout('s1', { getItem: () => '{oops' });
    expect(layout).toEqual({ groupTransforms: {}, groupHidden: {}, occluders: [] });
  });
});

describe('resolveGroupPlacements', () => {
  it('moves every member with its group and keeps avatars on the floor', () => {
    const p = resolveGroupPlacements(preset, { g: { pos: [0, 0, -1], rot: [0, 0, 0] } }, -0.5);
    expect(p.get('taskProp:shirt')?.pos).toEqual([2, 1, -1]);
    expect(p.get('staticProp:rack')?.pos).toEqual([2, 0, -1]);
    expect(p.get('slot:a')?.pos).toEqual([1, -0.5, -1]);
  });

  it('rotates around the group centre', () => {
    const p = resolveGroupPlacements(preset, { g: { pos: [0, 0, 0], rot: [0, Math.PI, 0] } }, 0);
    const [x, , z] = p.get('slot:a')!.pos;
    // 支點 x = (1 + 3 + 2 + 2) / 4 = 2，a 從 1 轉到 3
    expect(x).toBeCloseTo(3);
    expect(z).toBeCloseTo(0);
    expect(p.get('slot:a')!.rot[1]).toBeCloseTo(Math.PI);
  });
});

describe('hiddenMembers', () => {
  it('lists members of hidden groups', () => {
    expect(hiddenMembers(preset, { g: true }).has('taskProp:shirt')).toBe(true);
    expect(hiddenMembers(preset, {}).size).toBe(0);
  });
});
