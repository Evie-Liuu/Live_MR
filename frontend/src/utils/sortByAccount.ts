const collator = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'base' });

/**
 * 學生依帳號排序。identity 就是學生的顯示名稱（測試帳號的 S01、正式帳號的姓名或訪客自填的名稱），
 * 數字依數值比較（S2 排在 S10 前面）。回傳新陣列。
 */
export function sortByAccount<T extends { identity: string }>(people: readonly T[]): T[] {
  return [...people].sort((a, b) => collator.compare(a.identity, b.identity));
}
