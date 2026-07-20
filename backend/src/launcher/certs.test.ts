import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { X509Certificate } from 'node:crypto'
import { ensureCert } from './certs.js'

describe('ensureCert', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livemr-certs-test-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('generates cert.pem and key.pem bound to the given IP', async () => {
    const { certPath, keyPath } = await ensureCert(dir, '192.168.1.50')
    expect(fs.existsSync(certPath)).toBe(true)
    expect(fs.existsSync(keyPath)).toBe(true)

    const cert = new X509Certificate(fs.readFileSync(certPath))
    expect(cert.subjectAltName).toContain('IP Address:192.168.1.50')
  })

  it('reuses the existing cert when called again with the same IP', async () => {
    const first = await ensureCert(dir, '192.168.1.50')
    const firstContent = fs.readFileSync(first.certPath, 'utf8')

    const second = await ensureCert(dir, '192.168.1.50')
    const secondContent = fs.readFileSync(second.certPath, 'utf8')

    expect(secondContent).toBe(firstContent)
  })

  it('regenerates the cert when the IP changes', async () => {
    const first = await ensureCert(dir, '192.168.1.50')
    const firstContent = fs.readFileSync(first.certPath, 'utf8')

    const second = await ensureCert(dir, '10.0.0.5')
    const secondContent = fs.readFileSync(second.certPath, 'utf8')

    expect(secondContent).not.toBe(firstContent)
    const cert = new X509Certificate(fs.readFileSync(second.certPath))
    expect(cert.subjectAltName).toContain('IP Address:10.0.0.5')
  })
})
