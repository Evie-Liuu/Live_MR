import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import CustomSelect from './CustomSelect.tsx';
import { dropdownPlacement, filterOptions, type SelectOption } from '../utils/selectDropdown.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

const OPTIONS: SelectOption[] = [
  { value: '', label: '移除指派' },
  { value: 's1', label: 'S01', searchText: 'S01' },
  { value: 's2', label: 'S02', searchText: 'S02' },
  { value: 'ming', label: '小明', searchText: '小明' },
];

describe('dropdownPlacement', () => {
  const container = { top: 100, bottom: 700 };

  it('opens down when there is room below', () => {
    expect(dropdownPlacement({ top: 200, bottom: 240 }, container, 250)).toEqual({ direction: 'down', scroll: false });
  });

  it('opens up when only the space above fits', () => {
    expect(dropdownPlacement({ top: 600, bottom: 640 }, container, 250)).toEqual({ direction: 'up', scroll: false });
  });

  it('opens down and asks to scroll when neither side fits', () => {
    expect(dropdownPlacement({ top: 300, bottom: 340 }, { top: 250, bottom: 400 }, 250)).toEqual({ direction: 'down', scroll: true });
  });

  it('counts the gap between trigger and dropdown', () => {
    expect(dropdownPlacement({ top: 200, bottom: 442 }, { top: 0, bottom: 700 }, 250).direction).toBe('down');
    expect(dropdownPlacement({ top: 300, bottom: 443 }, { top: 0, bottom: 700 }, 250).direction).toBe('up');
  });
});

describe('filterOptions', () => {
  it('matches case-insensitively and hides options without search text', () => {
    expect(filterOptions(OPTIONS, 's0').map(o => o.value)).toEqual(['s1', 's2']);
  });

  it('keeps everything when the query is blank', () => {
    expect(filterOptions(OPTIONS, '  ')).toHaveLength(4);
  });
});

describe('CustomSelect', () => {
  const mount = (props: Partial<React.ComponentProps<typeof CustomSelect>> = {}) => {
    const onChange = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(
      <CustomSelect value="none" options={OPTIONS} onChange={onChange} placeholder="選擇學生" searchable searchPlaceholder="搜尋學生" emptyText="找不到" {...props} />,
    ));
    return onChange;
  };
  const open = () => act(() => host!.querySelector<HTMLElement>('.custom-select-trigger')!.click());
  const search = () => host!.querySelector<HTMLInputElement>('.custom-select-search');
  const type = (text: string) => act(() => {
    const input = search()!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const key = (k: string, init: KeyboardEventInit = {}) => act(() => {
    search()!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }));
  });

  it('shows the placeholder when nothing is selected', () => {
    mount();
    expect(host!.textContent).toContain('選擇學生');
  });

  it('filters by typing and picks the first match with Enter', () => {
    const onChange = mount();
    open();
    type('小明');
    expect(host!.textContent).not.toContain('S01');
    key('Enter');
    expect(onChange).toHaveBeenCalledWith('ming');
    expect(search()).toBeNull();
  });

  it('moves with arrow keys', () => {
    const onChange = mount();
    open();
    type('s0');
    key('ArrowDown');
    key('Enter');
    expect(onChange).toHaveBeenCalledWith('s2');
  });

  it('does not pick an option while the IME is composing', () => {
    const onChange = mount();
    open();
    key('Enter', { isComposing: true });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the empty message and clears the search when reopened', () => {
    mount();
    open();
    type('zzz');
    expect(host!.textContent).toContain('找不到');
    key('Escape');
    open();
    expect(search()!.value).toBe('');
  });

  it('focuses the search box on open', () => {
    mount();
    open();
    expect(document.activeElement).toBe(search());
  });

  it('has no search box unless asked for', () => {
    mount({ searchable: false, value: 's1' });
    open();
    expect(search()).toBeNull();
  });
});
