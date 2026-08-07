import { describe, it, expect, vi, beforeEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { trustCaLocally } from './trustStore.js'

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
