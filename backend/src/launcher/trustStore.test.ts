import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { trustCaLocally, trustCaForOpenSsl } from './trustStore.js'

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}))

describe('trustCaLocally', () => {
  beforeEach(() => {
    vi.mocked(execFileSync).mockReset()
  })

  it('adds the CA cert to the current user ROOT store via certutil', () => {
    trustCaLocally('C:\\data\\certs\\ca-cert.pem')

    expect(execFileSync).toHaveBeenCalledWith(
      'certutil',
      ['-user', '-addstore', '-f', 'ROOT', 'C:\\data\\certs\\ca-cert.pem'],
      { stdio: 'ignore' },
    )
  })

  it('does not throw when certutil is unavailable or fails', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('certutil not found')
    })

    expect(() => trustCaLocally('ca-cert.pem')).not.toThrow()
  })
})

describe('trustCaForOpenSsl', () => {
  let dir: string
  let caCertPath: string
  let bundlePath: string
  let originalSslCertFile: string | undefined

  beforeEach(() => {
    vi.mocked(execFileSync).mockReset()
    // 這個 describe 會反覆改寫 process.env.SSL_CERT_FILE；save/restore 避免洩漏到
    // 同一次測試執行裡的其他測試檔。
    originalSslCertFile = process.env.SSL_CERT_FILE
    delete process.env.SSL_CERT_FILE

    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livemr-truststore-test-'))
    caCertPath = path.join(dir, 'ca-cert.pem')
    bundlePath = path.join(dir, 'system-ca-bundle.pem')
    fs.writeFileSync(
      caCertPath,
      '-----BEGIN CERTIFICATE-----\nFAKE-CA-CERT\n-----END CERTIFICATE-----\n',
    )
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
    if (originalSslCertFile === undefined) {
      delete process.env.SSL_CERT_FILE
    } else {
      process.env.SSL_CERT_FILE = originalSslCertFile
    }
  })

  it('writes a merged bundle of the built-in public CA bundle and the internal CA, and points SSL_CERT_FILE at it', () => {
    trustCaForOpenSsl(caCertPath, dir)

    const bundle = fs.readFileSync(bundlePath, 'utf8')
    // 來自 repo 內建的 backend/src/launcher/public-ca-bundle.pem（已知含這兩張）。
    expect(bundle).toContain('GTS Root R1')
    expect(bundle).toContain('Amazon Root CA 1')
    expect(bundle).toContain('FAKE-CA-CERT')

    expect(process.env.SSL_CERT_FILE).toBe(bundlePath)
    expect(execFileSync).toHaveBeenCalledWith(
      'setx',
      ['SSL_CERT_FILE', bundlePath],
      { stdio: 'ignore' },
    )
  })

  it('does not throw when setx fails', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('setx not found')
    })

    expect(() => trustCaForOpenSsl(caCertPath, dir)).not.toThrow()
  })

  it('does not call setx again once SSL_CERT_FILE already points at the bundle (idempotent across repeated launches)', () => {
    trustCaForOpenSsl(caCertPath, dir)
    expect(execFileSync).toHaveBeenCalledTimes(1)
    expect(process.env.SSL_CERT_FILE).toBe(bundlePath)

    trustCaForOpenSsl(caCertPath, dir)
    expect(execFileSync).toHaveBeenCalledTimes(1)
    expect(process.env.SSL_CERT_FILE).toBe(bundlePath)
  })

  it('bails out without writing the bundle or touching SSL_CERT_FILE when the public CA bundle looks truncated', () => {
    const truncatedBundlePath = path.join(dir, 'truncated-public-ca-bundle.pem')
    fs.writeFileSync(
      truncatedBundlePath,
      '-----BEGIN CERTIFICATE-----\nONLY-ONE-CERT\n-----END CERTIFICATE-----\n',
    )

    trustCaForOpenSsl(caCertPath, dir, truncatedBundlePath)

    expect(fs.existsSync(bundlePath)).toBe(false)
    expect(process.env.SSL_CERT_FILE).toBeUndefined()
    expect(execFileSync).not.toHaveBeenCalled()
  })

  it('does not overwrite a pre-existing SSL_CERT_FILE set by something else', () => {
    const foreignPath = 'C:\\Some\\Other\\Tool\\ca-bundle.pem'
    process.env.SSL_CERT_FILE = foreignPath

    trustCaForOpenSsl(caCertPath, dir)

    expect(process.env.SSL_CERT_FILE).toBe(foreignPath)
    expect(fs.existsSync(bundlePath)).toBe(false)
    expect(execFileSync).not.toHaveBeenCalled()
  })

  it('treats SSL_CERT_FILE already pointing at this certsDir bundle as a normal rerun and overwrites it', () => {
    process.env.SSL_CERT_FILE = bundlePath
    fs.writeFileSync(bundlePath, 'stale contents from a previous run')

    trustCaForOpenSsl(caCertPath, dir)

    const bundle = fs.readFileSync(bundlePath, 'utf8')
    expect(bundle).toContain('FAKE-CA-CERT')
    expect(bundle).not.toContain('stale contents from a previous run')
    // 目前的值已經等於這次要設的 bundlePath，是「正常重跑」，不需要再呼叫 setx。
    expect(execFileSync).not.toHaveBeenCalled()
  })
})
