// 下載 Node.js 官方 Windows 可攜式 zip（免安裝），解壓縮成 .build-cache/node-win-x64/。
// 用法：node scripts/fetch-portable-node.mjs
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CACHE_DIR = path.join(ROOT, '.build-cache')

const NODE_VERSION = '22.18.0'
const DIST_NAME = `node-v${NODE_VERSION}-win-x64`
const URL = `https://nodejs.org/dist/v${NODE_VERSION}/${DIST_NAME}.zip`

function download(url, destPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close()
        fs.unlinkSync(destPath)
        if (redirectsLeft <= 0) { reject(new Error('Too many redirects')); return }
        resolve(download(res.headers.location, destPath, redirectsLeft - 1))
        return
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${res.statusCode} for ${url}`))
        return
      }
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
    }).on('error', reject)
  })
}

async function main() {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  const zipPath = path.join(CACHE_DIR, `${DIST_NAME}.zip`)
  const extractedDir = path.join(CACHE_DIR, DIST_NAME)
  const targetDir = path.join(CACHE_DIR, 'node-win-x64')

  if (fs.existsSync(targetDir)) {
    console.log(`已存在 ${targetDir}，略過下載。刪除該資料夾可強制重新下載。`)
    return
  }

  console.log(`下載 ${URL} ...`)
  await download(URL, zipPath)

  console.log('解壓縮中...')
  execFileSync('powershell', [
    '-NoProfile', '-Command',
    `Expand-Archive -Path "${zipPath}" -DestinationPath "${CACHE_DIR}" -Force`,
  ])
  fs.unlinkSync(zipPath)

  fs.renameSync(extractedDir, targetDir)
  console.log(`完成：${targetDir}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
