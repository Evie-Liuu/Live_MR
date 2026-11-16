import { useEffect, useState } from 'react';

/**
 * 新的值要連續維持 holdMs 才換上去，用來擋掉偶發幾幀的誤判（例如手部瞬間抓錯）造成畫面頻繁切換。
 * 以 key 判斷是不是同一個值：期間跳回目前顯示的值就取消等待，跳到另一個值就重新計時。
 */
export function useSettledValue<T>(value: T, key: string, holdMs: number): T {
  const [settled, setSettled] = useState({ value, key });

  useEffect(() => {
    if (key === settled.key) return;
    const id = window.setTimeout(() => setSettled({ value, key }), holdMs);
    return () => window.clearTimeout(id);
    // value 跟著 key 走；只在 key 改變時重新計時，同一個 key 的新物件不打斷等待
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, settled.key, holdMs]);

  return settled.value;
}
