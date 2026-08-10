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

  beforeEach(() => {
    vi.mocked(execFileSync).mockReset()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livemr-truststore-test-'))
    caCertPath = path.join(dir, 'ca-cert.pem')
    fs.writeFileSync(
      caCertPath,
      '-----BEGIN CERTIFICATE-----\nFAKE-CA-CERT\n-----END CERTIFICATE-----\n',
    )
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
    delete process.env.SSL_CERT_FILE
  })

  it('writes a merged bundle of exported public roots and the internal CA, and points SSL_CERT_FILE at it', () => {
    vi.mocked(execFileSync).mockImplementation(((cmd: unknown) => {
      if (cmd === 'powershell.exe') {
        return '-----BEGIN CERTIFICATE-----\nFAKE-PUBLIC-ROOT\n-----END CERTIFICATE-----\n'
      }
      return Buffer.from('')
    }) as never)

    trustCaForOpenSsl(caCertPath, dir)

    const bundlePath = path.join(dir, 'system-ca-bundle.pem')
    const bundle = fs.readFileSync(bundlePath, 'utf8')
    expect(bundle).toContain('FAKE-PUBLIC-ROOT')
    expect(bundle).toContain('FAKE-CA-CERT')

    expect(process.env.SSL_CERT_FILE).toBe(bundlePath)
    expect(execFileSync).toHaveBeenCalledWith(
      'setx',
      ['SSL_CERT_FILE', bundlePath],
      { stdio: 'ignore' },
    )
  })

  it('does not throw when powershell or setx fails', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('powershell not found')
    })

    expect(() => trustCaForOpenSsl(caCertPath, dir)).not.toThrow()
  })
})
