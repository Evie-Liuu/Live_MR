import { describe, it, expect, afterEach, vi } from 'vitest'

describe('routes.ts recordingsDir resolution', () => {
  const ORIGINAL_ENV = process.env.RECORDINGS_DIR

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.RECORDINGS_DIR
    else process.env.RECORDINGS_DIR = ORIGINAL_ENV
  })

  it('falls back to process.cwd()/../recordings when RECORDINGS_DIR is unset', async () => {
    delete process.env.RECORDINGS_DIR
    vi.resetModules()
    const path = await import('node:path')
    const { __TEST_ONLY_recordingsDir } = await import('./routes.js')
    expect(__TEST_ONLY_recordingsDir()).toBe(path.resolve(process.cwd(), '../recordings'))
  })

  it('uses RECORDINGS_DIR when set', async () => {
    process.env.RECORDINGS_DIR = '/tmp/livemr-recordings'
    vi.resetModules()
    const path = await import('node:path')
    const { __TEST_ONLY_recordingsDir } = await import('./routes.js')
    expect(__TEST_ONLY_recordingsDir()).toBe(path.resolve('/tmp/livemr-recordings'))
  })
})
