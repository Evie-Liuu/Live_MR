import type { ReactNode } from 'react';

export interface SelectOption {
  value: string;
  label: ReactNode;
  /** 搜尋比對的文字；沒有的選項（例如「移除指派」）只在沒輸入搜尋時顯示 */
  searchText?: string;
}

/** 選單與觸發鈕的間距，同 CSS 的 calc(100% + 8px) */
const DROPDOWN_GAP = 8;

/**
 * 選單往哪邊展開：下方放得下就往下，否則上方放得下就往上；
 * 兩邊都放不下時往下，並由呼叫端把選單捲到看得見。
 */
export function dropdownPlacement(
  trigger: { top: number; bottom: number },
  container: { top: number; bottom: number },
  height: number,
): { direction: 'down' | 'up'; scroll: boolean } {
  const needed = height + DROPDOWN_GAP;
  if (trigger.bottom + needed <= container.bottom) return { direction: 'down', scroll: false };
  if (trigger.top - needed >= container.top) return { direction: 'up', scroll: false };
  return { direction: 'down', scroll: true };
}

export function filterOptions(options: SelectOption[], query: string): SelectOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter(o => o.searchText?.toLowerCase().includes(q));
}
