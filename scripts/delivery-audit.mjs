// 交付前檢查：確認要交給外部測試的 LiveMR 資料夾沒有夾帶金鑰、私鑰、資料庫、
// 測試帳號或舊的壓縮檔。build-launcher.mjs --tester 會自動執行；也可以單獨檢查任何資料夾：
//   node scripts/delivery-audit.mjs <LiveMR 資料夾>
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 讀 KEY=VALUE 格式的設定檔 */
function readEnvFile(file) {
  if (!fs.existsSync(file)) return {}
  const out = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

/**
 * 開發機上真實的機密值（只看名稱像金鑰的欄位），用來比對交付檔裡有沒有出現。
 * VITE_ 開頭的是前端設定（例如 Firebase 網頁設定），本來就會公開在前端程式裡，不列入。
 */
export function knownSecrets() {
  const sources = [
    path.join(ROOT, 'backend', '.env'),
    path.join(ROOT, '.env'),
    path.join(ROOT, 'dist-launcher', 'LiveMR', 'launcher.env'),
  ]
  const publicValues = new Set(Object.values(readEnvFile(path.join(ROOT, 'frontend', '.env'))))
  const secrets = new Set()
  for (const file of sources) {
    for (const [k, v] of Object.entries(readEnvFile(file))) {
      if (!k.startsWith('VITE_') && /KEY|SECRET|TOKEN|PASSWORD/i.test(k) && v.length >= 12 && !publicValues.has(v) && !v.startsWith('devsecret')) secrets.add(v)
    }
  }
  return [...secrets]
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else yield full
  }
}

const TEXT_EXT = new Set(['.js', '.cjs', '.mjs', '.html', '.css', '.json', '.env', '.txt', '.pem', '.bat', '.yaml', '.yml', '.map'])

/** 回傳問題清單；空陣列＝可以交付 */
export function auditDelivery(dir, secrets = knownSecrets()) {
  const problems = []
  const rel = f => path.relative(dir, f)

  const env = readEnvFile(path.join(dir, 'launcher.env'))
  for (const [k, v] of Object.entries(env)) {
    if (/KEY|SECRET|TOKEN|PASSWORD/i.test(k) && v) problems.push(`launcher.env 的 ${k} 有填值，交付版不能帶金鑰`)
  }
  if (env.ENABLE_TEST_ACCOUNTS === '1') problems.push('launcher.env 開著測試帳號（ENABLE_TEST_ACCOUNTS=1）')
  // 免登入加入（ENABLE_GUEST_JOIN=1）是交付測試版刻意保留的功能，學生加入仍需老師核准，不列為問題

  const dataDir = path.join(dir, 'data')
  if (fs.existsSync(dataDir) && [...walk(dataDir)].length > 0) {
    problems.push('data/ 不是空的（可能有憑證私鑰、資料庫、錄影或測試帳號），請用全新打包的資料夾')
  }

  for (const file of walk(dir)) {
    const r = rel(file)
    // 可攜式 Node 自帶的 npm 不在檢查範圍（交付版會整個拿掉）
    if (r.split(path.sep).includes('node_modules')) continue
    const ext = path.extname(file).toLowerCase()
    if (['.zip', '.7z', '.rar'].includes(ext)) problems.push(`夾帶壓縮檔：${r}`)
    if (ext === '.map') problems.push(`夾帶 source map：${r}`)
    if (['.sqlite', '.db', '.sqlite-wal', '.sqlite-shm'].includes(ext)) problems.push(`夾帶資料庫：${r}`)
    if (path.basename(file) === 'test-accounts.json') problems.push(`夾帶測試帳號：${r}`)
    if (!TEXT_EXT.has(ext) && path.basename(file) !== 'launcher.env') continue
    const text = fs.readFileSync(file, 'utf8')
    // 要有實際的 base64 內容才算（程式碼裡組 PEM 字串的那種不算）
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----\s*[A-Za-z0-9+/=]{40,}/.test(text)) problems.push(`夾帶私鑰：${r}`)
    for (const s of secrets) {
      if (text.includes(s)) problems.push(`夾帶開發機上的金鑰（${s.slice(0, 4)}…）：${r}`)
    }
  }
  return problems
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] ?? path.join(ROOT, 'dist-launcher', 'LiveMR'))
  const problems = auditDelivery(dir)
  if (problems.length) {
    console.error(`✗ ${dir} 不適合交付：\n` + problems.map(p => `  - ${p}`).join('\n'))
    process.exit(1)
  }
  console.log(`✓ ${dir} 檢查通過`)
}
