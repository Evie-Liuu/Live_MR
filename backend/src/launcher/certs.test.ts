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

  it('signs the leaf certificate with a local CA instead of self-signing', async () => {
    const { certPath } = await ensureCert(dir, '192.168.1.50')
    const cert = new X509Certificate(fs.readFileSync(certPath))

    expect(cert.issuer).not.toBe(cert.subject)

    const caCertPath = path.join(dir, 'ca-cert.pem')
    expect(fs.existsSync(caCertPath)).toBe(true)
    const ca = new X509Certificate(fs.readFileSync(caCertPath))
    expect(cert.checkIssued(ca)).toBe(true)
    expect(cert.verify(ca.publicKey)).toBe(true)
  })

  it('reuses the same CA across IP changes instead of regenerating it', async () => {
    const first = await ensureCert(dir, '192.168.1.50')
    const caContentBefore = fs.readFileSync(path.join(dir, 'ca-cert.pem'), 'utf8')

    const second = await ensureCert(dir, '10.0.0.5')
    const caContentAfter = fs.readFileSync(path.join(dir, 'ca-cert.pem'), 'utf8')

    expect(caContentAfter).toBe(caContentBefore)

    const firstCert = new X509Certificate(fs.readFileSync(first.certPath))
    const secondCert = new X509Certificate(fs.readFileSync(second.certPath))
    expect(firstCert.issuer).toBe(secondCert.issuer)
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

  it('regenerates a pre-existing cert that predates the format-version marker (e.g. old sha1 cert)', async () => {
    const first = await ensureCert(dir, '192.168.1.50')
    const firstContent = fs.readFileSync(first.certPath, 'utf8')

    // 模擬弱點掃描修正前產生的憑證：ip.txt 只有 IP，沒有版本號那一行。
    fs.writeFileSync(path.join(dir, 'ip.txt'), '192.168.1.50')

    const second = await ensureCert(dir, '192.168.1.50')
    const secondContent = fs.readFileSync(second.certPath, 'utf8')

    expect(secondContent).not.toBe(firstContent)
  })
})
