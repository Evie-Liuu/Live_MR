import { describe, expect, it } from 'vitest';
import type { VRMAnimation } from '@pixiv/three-vrm-animation';
import { bodyTypeOfVrmUrl, pickAnimation, variantUrl } from './animationLibrary.ts';

const anim = (name: string) => ({ name }) as unknown as VRMAnimation;

describe('variantUrl', () => {
  it('adds .adult before the extension for adults', () => {
    expect(variantUrl('/animations/wave.vrma', 'adult')).toBe('/animations/wave.adult.vrma');
  });

  it('keeps the original file for children', () => {
    expect(variantUrl('/animations/wave.vrma', 'child')).toBe('/animations/wave.vrma');
  });
});

describe('bodyTypeOfVrmUrl', () => {
  it('reads the body type tagged on the model', () => {
    expect(bodyTypeOfVrmUrl('/models/ClothingStoreStaff_Male.vrm')).toBe('adult');
  });

  it('treats untagged or unknown models as children', () => {
    expect(bodyTypeOfVrmUrl('/models/Student_Male1.vrm')).toBe('child');
    expect(bodyTypeOfVrmUrl('/models/someone-else.vrm')).toBe('child');
    expect(bodyTypeOfVrmUrl(null)).toBe('child');
  });
});

describe('pickAnimation', () => {
  it('uses the adult version when it exists', async () => {
    const files: Record<string, VRMAnimation> = { '/a/wave.vrma': anim('child'), '/a/wave.adult.vrma': anim('adult') };
    const got = await pickAnimation('/a/wave.vrma', 'adult', async url => files[url] ?? null);
    expect(got).toBe(files['/a/wave.adult.vrma']);
  });

  it('falls back to the original when there is no adult version', async () => {
    const files: Record<string, VRMAnimation> = { '/a/wave.vrma': anim('child') };
    const asked: [string, boolean][] = [];
    const got = await pickAnimation('/a/wave.vrma', 'adult', async (url, optional) => {
      asked.push([url, optional]);
      return files[url] ?? null;
    });
    expect(got).toBe(files['/a/wave.vrma']);
    // 找大人版是選擇性的（缺檔不警告），原檔才是必要的
    expect(asked).toEqual([['/a/wave.adult.vrma', true], ['/a/wave.vrma', false]]);
  });

  it('children never look for the adult version', async () => {
    const asked: string[] = [];
    await pickAnimation('/a/wave.vrma', 'child', async url => { asked.push(url); return null; });
    expect(asked).toEqual(['/a/wave.vrma']);
  });
});
