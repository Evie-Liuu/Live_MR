/**
 * 產生本地測試帳號清單（密碼只存 scrypt 雜湊）。
 *
 *   cd backend
 *   npx tsx scripts/create-test-accounts.mts --password <密碼> [--count 29] [--out ../data/test-accounts.json]
 *
 * 帳號 stu01～stuNN、顯示名稱 S01～SNN、角色 student。
 * 再於 .env（開發）或 LiveMR/launcher.env（打包版）加上 ENABLE_TEST_ACCOUNTS=1；
 * 打包版要把產生的檔案放到 LiveMR/data/test-accounts.json。
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { hashPassword, type TestAccount } from '../src/testAccounts.js'

const { values } = parseArgs({
  options: {
    password: { type: 'string' },
    count: { type: 'string', default: '29' },
    out: { type: 'string', default: '../data/test-accounts.json' },
  },
})

if (!values.password) {
  console.error('請用 --password 指定密碼')
  process.exit(1)
}
const count = parseInt(values.count!, 10)
const width = Math.max(2, String(count).length)
const accounts: TestAccount[] = Array.from({ length: count }, (_, i) => {
  const n = String(i + 1).padStart(width, '0')
  return { username: `stu${n}`, displayName: `S${n}`, role: 'student', passwordHash: hashPassword(values.password!) }
})

const out = path.resolve(values.out!)
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify(accounts, null, 2) + '\n')
console.log(`已產生 ${count} 組測試帳號（${accounts[0].username}～${accounts[count - 1].username}）：${out}`)
