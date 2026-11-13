import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkClock, expiryTime, isExpired, readBuildLicense } from './license.js'

const lic = { tester: '測試單位', expires: '2026-12-31', id: 'abc' }

describe('readBuildLicense', () => {
  it('reads the injected license', () => {
    expect(readBuildLicense(JSON.stringify(lic))).toEqual(lic)
  })

  it('treats internal builds and broken data as unlicensed', () => {
    expect(readBuildLicense(undefined)).toBeNull()
    expect(readBuildLicense('{oops')).toBeNull()
    expect(readBuildLicense(JSON.stringify({ tester: 'x' }))).toBeNull()
  })
})

describe('isExpired', () => {
  it('is valid through the end of the expiry day', () => {
    expect(isExpired(lic, new Date('2026-12-31T23:59:00').getTime())).toBe(false)
    expect(isExpired(lic, new Date('2027-01-01T00:00:01').getTime())).toBe(true)
  })

  it('never expires without a license', () => {
    expect(isExpired(null)).toBe(false)
  })

  it('treats a malformed date as expired', () => {
    expect(Number.isNaN(expiryTime('12/31/2026'))).toBe(true)
    expect(Number.isNaN(expiryTime('2026-11-31'))).toBe(true)
    expect(isExpired({ ...lic, expires: 'soon' })).toBe(true)
  })
})

describe('checkClock', () => {
  it('rejects a clock turned back more than a day', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-'))
    const day = 24 * 60 * 60 * 1000
    const t = new Date('2026-12-20T10:00:00').getTime()
    expect(checkClock(dir, t)).toBe(true)
    expect(checkClock(dir, t - day / 2)).toBe(true)
    expect(checkClock(dir, t - 3 * day)).toBe(false)
    expect(checkClock(dir, t + day)).toBe(true)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
