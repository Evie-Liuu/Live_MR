import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyOutfit, hasOutfitStyle, parseOutfitName, wearPartOf } from './vrmOutfit.ts';

const model = () => {
  const root = new THREE.Group();
  const add = (name: string) => { const o = new THREE.Object3D(); o.name = name; root.add(o); return o; };
  return {
    root,
    pants: add('Base_Bottom_Pants_show'),
    skirt: add('Outfit_Bottom_Skirt_hide'),
    skirtBelt: add('Outfit_Bottom_Skirt_hide001'),
    jeans: add('outfit_bottom_jeans_HIDE'),
    hat: add('Outfit_Head_Hat_hide'),
    body: add('mixamorigS2_Body'),
  };
};

describe('vrmOutfit', () => {
  it('解析 [層級]_[部位]_[款式]_[初始狀態]，忽略重複名稱尾碼', () => {
    expect(parseOutfitName('Outfit_Bottom_Skirt_hide')).toEqual({ layer: 'outfit', part: 'bottom', style: 'skirt', initialVisible: false });
    expect(parseOutfitName('Base_Top_Tshirt_show_1')?.initialVisible).toBe(true);
    expect(parseOutfitName('mixamorigS2_Body')).toBeNull();
    expect(parseOutfitName('Skirt_purple')).toBeNull();
  });

  it('載入時依初始狀態；換穿同部位只顯示那個款式；脫下回到初始', () => {
    const m = model();
    applyOutfit(m.root, []);
    expect([m.pants.visible, m.skirt.visible, m.jeans.visible, m.hat.visible]).toEqual([true, false, false, false]);

    applyOutfit(m.root, [{ part: 'Bottom', style: 'Skirt' }, { part: 'Head', style: 'Hat' }]);
    expect([m.pants.visible, m.skirt.visible, m.skirtBelt.visible, m.jeans.visible, m.hat.visible]).toEqual([false, true, true, false, true]);
    expect(m.body.visible).toBe(true);

    applyOutfit(m.root, []);
    expect([m.pants.visible, m.skirt.visible, m.hat.visible]).toEqual([true, false, false]);
  });

  it('模型沒有的款式略過，不影響該部位', () => {
    const m = model();
    expect(hasOutfitStyle(m.root, { part: 'Bottom', style: 'Shorts' })).toBe(false);
    applyOutfit(m.root, [{ part: 'Bottom', style: 'Shorts' }]);
    expect(m.pants.visible).toBe(true);
  });

  it('試穿部位：有 outfit 用部位，否則帽子 head、其餘 body', () => {
    expect(wearPartOf({ outfit: { part: 'Bottom', style: 'Skirt' }, bodyHold: { anchor: 'chest' } })).toBe('bottom');
    expect(wearPartOf({ bodyHold: { anchor: 'head' } })).toBe('head');
    expect(wearPartOf({ bodyHold: { anchor: 'hips' } })).toBe('body');
    expect(wearPartOf(undefined)).toBe('body');
  });
});
