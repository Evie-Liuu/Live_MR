import { describe, it, expect, vi } from 'vitest';
import { micErrorText, retryMic } from './micEnable.ts';

const domError = (name: string) => Object.assign(new Error(name), { name });
const noSleep = () => Promise.resolve();

describe('micEnable', () => {
  it('暫時性錯誤重試到成功', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(domError('NotReadableError'))
      .mockRejectedValueOnce(domError('NotReadableError'))
      .mockResolvedValue('ok');
    await expect(retryMic(fn, [1, 1, 1], () => true, noSleep)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('次數用完丟出最後的錯誤', async () => {
    const fn = vi.fn().mockRejectedValue(domError('NotReadableError'));
    await expect(retryMic(fn, [1, 1], () => true, noSleep)).rejects.toThrow('NotReadableError');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('權限被拒不重試；離開畫面就停', async () => {
    const denied = vi.fn().mockRejectedValue(domError('NotAllowedError'));
    await expect(retryMic(denied, [1, 1], () => true, noSleep)).rejects.toThrow();
    expect(denied).toHaveBeenCalledTimes(1);

    const busy = vi.fn().mockRejectedValue(domError('NotReadableError'));
    await expect(retryMic(busy, [1, 1], () => false, noSleep)).rejects.toThrow();
    expect(busy).toHaveBeenCalledTimes(1);
  });

  it('依錯誤種類給提示', () => {
    expect(micErrorText(domError('NotAllowedError'))).toContain('權限');
    expect(micErrorText(domError('NotReadableError'))).toContain('佔用');
    expect(micErrorText(new Error('x'))).toBe('麥克風無法啟動');
  });
});
