import { describe, expect, it } from 'vitest';
import { isLicenseExpired, readBuildLicense } from './buildLicense';

describe('readBuildLicense', () => {
  it('reads the license injected at build time', () => {
    expect(readBuildLicense({ VITE_LICENSE_TESTER: '某校', VITE_LICENSE_EXPIRES: '2026-12-31', VITE_LICENSE_ID: 'x1' }))
      .toEqual({ tester: '某校', expires: '2026-12-31', id: 'x1' });
  });

  it('is empty for internal builds', () => {
    expect(readBuildLicense({})).toBeNull();
  });
});

describe('isLicenseExpired', () => {
  const lic = { tester: '某校', expires: '2026-12-31', id: '' };
  it('is valid through the end of the expiry day', () => {
    expect(isLicenseExpired(lic, new Date('2026-12-31T23:00:00').getTime())).toBe(false);
    expect(isLicenseExpired(lic, new Date('2027-01-01T00:00:01').getTime())).toBe(true);
  });

  it('treats a malformed date as expired and no license as unlimited', () => {
    expect(isLicenseExpired({ ...lic, expires: 'soon' })).toBe(true);
    expect(isLicenseExpired({ ...lic, expires: '2026-11-31' }, new Date('2026-11-01').getTime())).toBe(true);
    expect(isLicenseExpired(null)).toBe(false);
  });
});
