// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettledValue } from './useSettledValue.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ text }: { text: string }) {
  return useSettledValue({ text }, text, 800).text;
}

describe('useSettledValue', () => {
  let root: Root;
  let container: HTMLDivElement;
  const shown = () => container.textContent;
  const render = (text: string) => act(() => root.render(createElement(Probe, { text })));

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it('新值維持夠久才換上去', () => {
    render('追蹤良好');
    render('看不到左手');
    act(() => { vi.advanceTimersByTime(700); });
    expect(shown()).toBe('追蹤良好');
    act(() => { vi.advanceTimersByTime(100); });
    expect(shown()).toBe('看不到左手');
  });

  it('偶發幾幀誤判、很快跳回來：不切換', () => {
    render('追蹤良好');
    render('看不到左手');
    act(() => { vi.advanceTimersByTime(100); });
    render('追蹤良好');
    act(() => { vi.advanceTimersByTime(2000); });
    expect(shown()).toBe('追蹤良好');
  });

  it('同一個值持續收到新的一幀不會打斷計時；換成別的值重新計時', () => {
    render('追蹤良好');
    render('看不到左手');
    act(() => { vi.advanceTimersByTime(400); });
    render('看不到左手');
    act(() => { vi.advanceTimersByTime(400); });
    expect(shown()).toBe('看不到左手');
    render('看不到右手');
    act(() => { vi.advanceTimersByTime(400); });
    render('看不到雙手，手勢不會同步');
    act(() => { vi.advanceTimersByTime(400); });
    expect(shown()).toBe('看不到左手');
    act(() => { vi.advanceTimersByTime(400); });
    expect(shown()).toBe('看不到雙手，手勢不會同步');
  });
});
