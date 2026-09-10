import { describe, it, expect, vi } from 'vitest'

// useAuth 會 import ../firebase（initializeApp 需要環境變數），測試只需要純函式，整個 mock 掉
vi.mock('../firebase', () => ({ auth: {} }))
vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn(() => () => {}),
}))

import { performLogout } from './useAuth'

function makeDeps(signOutImpl: () => Promise<void> = async () => {}) {
  const order: string[] = []
  const deps = {
    signOut: vi.fn(async () => { order.push('signOut:start'); await signOutImpl(); order.push('signOut:done') }),
    clearLocal: vi.fn(() => { order.push('clearLocal') }),
    clearSession: vi.fn(() => { order.push('clearSession') }),
    navigate: vi.fn(() => { order.push('navigate') }),
  }
  return { deps, order }
}

describe('performLogout', () => {
  it('waits for Firebase signOut to finish before navigating away', async () => {
    let resolveSignOut!: () => void
    const { deps, order } = makeDeps(() => new Promise<void>(r => { resolveSignOut = r }))
    const p = performLogout(deps)
    // signOut 尚未完成時不可導航，否則頁面卸載會中斷 Firebase 清除持久化 session
    await Promise.resolve()
    expect(deps.navigate).not.toHaveBeenCalled()
    resolveSignOut()
    await p
    expect(order).toEqual(['signOut:start', 'signOut:done', 'clearLocal', 'clearSession', 'navigate'])
  })

  it('still clears storage and navigates when signOut throws', async () => {
    const { deps, order } = makeDeps(async () => { throw new Error('network') })
    await performLogout(deps)
    expect(deps.clearLocal).toHaveBeenCalledTimes(1)
    expect(deps.clearSession).toHaveBeenCalledTimes(1)
    expect(order[order.length - 1]).toBe('navigate')
  })
})
