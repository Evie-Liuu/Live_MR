import fs from 'node:fs'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/**
 * 本地測試帳號（壓測、課堂演練用）：不經 Firebase／SDGs 後端，由本機伺服器直接驗證。
 *
 * 只有設定 ENABLE_TEST_ACCOUNTS=1 才啟用；帳號清單在 TEST_ACCOUNTS_FILE（JSON），
 * 密碼只存 scrypt 雜湊。用 backend/scripts/create-test-accounts.mjs 產生。
 */

export type TestAccountRole = 'student' | 'teacher'

export interface TestAccount {
  username: string
  displayName: string
  role: TestAccountRole
  /** scrypt$<salt hex>$<hash hex> */
  passwordHash: string
}

export interface TestAccountUser {
  uid: string
  full_name: string
  role: TestAccountRole
  test_account: true
}

const KEY_LEN = 32

export function hashPassword(password: string, salt = randomBytes(16)): string {
  return `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, KEY_LEN).toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$')
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length)
  return expected.length === KEY_LEN && timingSafeEqual(expected, actual)
}

export function testAccountsEnabled(): boolean {
  return process.env.ENABLE_TEST_ACCOUNTS === '1' && !!process.env.TEST_ACCOUNTS_FILE
}

/** 每次登入都重讀檔案，改帳號不用重啟伺服器（29 筆，成本可忽略） */
export function loadTestAccounts(file: string): TestAccount[] {
  const list = JSON.parse(fs.readFileSync(file, 'utf-8')) as TestAccount[]
  return Array.isArray(list) ? list : []
}

/** 這個顯示名稱（也是 LiveKit identity）是否屬於測試學生帳號；檔案讀不到時視為不是 */
export function isTestStudentName(name: string): boolean {
  if (!testAccountsEnabled()) return false
  try {
    return loadTestAccounts(process.env.TEST_ACCOUNTS_FILE!).some(a => a.role !== 'teacher' && a.displayName === name)
  } catch {
    return false
  }
}

export function authenticateTestAccount(
  accounts: TestAccount[], username: string, password: string,
): TestAccountUser | null {
  const account = accounts.find(a => a.username.toLowerCase() === username.trim().toLowerCase())
  if (!account || !verifyPassword(password, account.passwordHash)) return null
  const role: TestAccountRole = account.role === 'teacher' ? 'teacher' : 'student'
  return { uid: account.username, full_name: account.displayName, role, test_account: true }
}
