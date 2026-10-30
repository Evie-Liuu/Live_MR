/**
 * 學生麥克風啟動失敗的重試與提示文字。
 *
 * 麥克風被別的 App 佔用、裝置剛喚醒時 getUserMedia 可能丟 NotReadableError，
 * 稍等再試常常就好；權限被拒（NotAllowedError）重試也沒用，直接提示。
 */

/** 第一次失敗後依序等這麼久再試（共 1 + 3 次） */
export const MIC_RETRY_DELAYS_MS = [1000, 2000, 4000];

function errorName(err: unknown): string {
  return (err as { name?: string } | null)?.name ?? '';
}

/** 重試也不會好的錯誤：權限被拒、找不到裝置 */
export function isPermanentMicError(err: unknown): boolean {
  const name = errorName(err);
  return name === 'NotAllowedError' || name === 'SecurityError' || name === 'NotFoundError';
}

export function micErrorText(err: unknown): string {
  switch (errorName(err)) {
    case 'NotAllowedError':
    case 'SecurityError':
      return '麥克風權限被拒絕，請到瀏覽器或系統設定允許使用麥克風';
    case 'NotFoundError':
      return '找不到麥克風';
    case 'NotReadableError':
    case 'AbortError':
      return '麥克風被其他 App 佔用或無法啟動，老師聽不到你的聲音';
    default:
      return '麥克風無法啟動';
  }
}

/**
 * 執行 fn，失敗就依 delays 等待後重試；永久性錯誤、或 shouldContinue() 為 false（畫面已離開）就停。
 * 全部失敗時丟出最後一次的錯誤。
 */
export async function retryMic<T>(
  fn: () => Promise<T>,
  delays: number[] = MIC_RETRY_DELAYS_MS,
  shouldContinue: () => boolean = () => true,
  sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= delays.length || isPermanentMicError(err) || !shouldContinue()) throw err;
      await sleep(delays[attempt]);
      if (!shouldContinue()) throw err;
    }
  }
}
