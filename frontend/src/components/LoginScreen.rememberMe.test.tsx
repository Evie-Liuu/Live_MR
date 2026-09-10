import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { SavedCredentials } from '../utils/secureStorageManager.ts'

// 假的安全儲存區：同步讀取、記錄清除次數，讓「掛載時被清空」的時序能重現
const store: { creds: SavedCredentials | null; clears: number } = { creds: null, clears: 0 }
vi.mock('../utils/secureStorageManager.ts', () => ({
  secureStorageManager: {
    getCredentials: vi.fn(() => Promise.resolve(store.creds ? { ...store.creds } : null)),
    saveCredentials: vi.fn(async (email: string, password: string) => { store.creds = { email, password }; return true }),
    clearCredentials: vi.fn(async () => { store.creds = null; store.clears += 1; return true }),
  },
}))
vi.mock('../hooks/useAuth.ts', () => ({
  useAuth: () => ({ loginWithEmailAndPassword: vi.fn() }),
}))

import LoginScreen from './LoginScreen.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function flush() {
  // 讓 getCredentials 的 promise 與後續 setState 跑完
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

describe('LoginScreen 記住我', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    store.creds = null
    store.clears = 0
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    container.remove()
  })

  it('掛載後把已儲存的帳密填進輸入框，且不會清掉儲存區（StrictMode 雙掛載也一樣）', async () => {
    store.creds = { email: 'teacher@example.com', password: 'pw123' }
    await act(async () => {
      root.render(<StrictMode><LoginScreen onLoginSuccess={() => {}} /></StrictMode>)
    })
    await flush()

    const email = container.querySelector<HTMLInputElement>('input[type="email"]')!
    const password = container.querySelector<HTMLInputElement>('input[placeholder="密碼"]')!
    const remember = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(email.value).toBe('teacher@example.com')
    expect(password.value).toBe('pw123')
    expect(remember.checked).toBe(true)
    expect(store.clears).toBe(0)
    expect(store.creds).not.toBeNull()
  })

  it('沒有儲存帳密時不清除儲存區，輸入框維持空白', async () => {
    await act(async () => {
      root.render(<StrictMode><LoginScreen onLoginSuccess={() => {}} /></StrictMode>)
    })
    await flush()
    expect(container.querySelector<HTMLInputElement>('input[type="email"]')!.value).toBe('')
    expect(store.clears).toBe(0)
  })

  it('使用者主動取消勾選才清除儲存區', async () => {
    store.creds = { email: 'teacher@example.com', password: 'pw123' }
    await act(async () => {
      root.render(<LoginScreen onLoginSuccess={() => {}} />)
    })
    await flush()
    const remember = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(remember.checked).toBe(true)

    await act(async () => {
      remember.click()
    })
    await flush()
    expect(remember.checked).toBe(false)
    expect(store.clears).toBe(1)
    expect(store.creds).toBeNull()
  })
})
