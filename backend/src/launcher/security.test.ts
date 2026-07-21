import { describe, it, expect } from 'vitest'
import request from 'supertest'
import express from 'express'
import { securityHeaders } from './security.js'

describe('securityHeaders', () => {
  it('sets all security headers matching the existing nginx config', async () => {
    const app = express()
    app.use(securityHeaders('192.168.1.50'))
    app.get('/', (_req, res) => res.send('ok'))

    const res = await request(app).get('/')

    expect(res.headers['strict-transport-security']).toBe('max-age=31536000')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN')
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' wss://192.168.1.50 blob:; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; upgrade-insecure-requests",
    )
  })

  it('interpolates the given server name into connect-src', async () => {
    const app = express()
    app.use(securityHeaders('10.0.0.5'))
    app.get('/', (_req, res) => res.send('ok'))

    const res = await request(app).get('/')
    expect(res.headers['content-security-policy']).toContain('wss://10.0.0.5')
  })
})
