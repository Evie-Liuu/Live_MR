/**
 * buildLicense.ts
 *
 * 交付給外部測試的版本會在打包時寫入（scripts/build-launcher.mjs --tester --expires），
 * 用來顯示測試者浮水印、過期後擋住使用。一般開發與內部打包沒有這些值，不受影響。
 * 真正的把關在伺服器（backend/src/launcher/license.ts），這裡只是畫面提示。
 */
export interface BuildLicense {
  tester: string;
  /** YYYY-MM-DD，當天結束前可用 */
  expires: string;
  id: string;
}

export function readBuildLicense(env: Record<string, string | undefined>): BuildLicense | null {
  const tester = env.VITE_LICENSE_TESTER;
  const expires = env.VITE_LICENSE_EXPIRES;
  return tester && expires ? { tester, expires, id: env.VITE_LICENSE_ID ?? '' } : null;
}

export const BUILD_LICENSE = readBuildLicense(import.meta.env as Record<string, string | undefined>);

export function isLicenseExpired(license: BuildLicense | null, now = Date.now()): boolean {
  if (!license) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(license.expires)) return true;
  const [y, m, d] = license.expires.split('-').map(Number);
  const end = new Date(y, m - 1, d, 23, 59, 59, 999);
  // 不存在的日期（例如 11-31）Date 會進位成下個月，視為無效
  if (end.getMonth() !== m - 1 || end.getDate() !== d) return true;
  return now > end.getTime();
}
