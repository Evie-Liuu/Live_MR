// 下載 LiveKit 官方 Windows binary release，解壓縮出 livekit-server.exe。
// 用法：node scripts/fetch-livekit-server.mjs
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CACHE_DIR = path.join(ROOT, '.build-cache')

const LIVEKIT_VERSION = '1.13.4'
const ASSET_NAME = `livekit_${LIVEKIT_VERSION}_windows_amd64.zip`
const URL = `https://github.com/livekit/livekit/releases/download/v${LIVEKIT_VERSION}/${ASSET_NAME}`

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
  const zipPath = path.join(CACHE_DIR, ASSET_NAME)
  const exePath = path.join(CACHE_DIR, 'livekit-server.exe')

  if (fs.existsSync(exePath)) {
    console.log(`已存在 ${exePath}，略過下載。刪除該檔案可強制重新下載。`)
    return
  }

  console.log(`下載 ${URL} ...`)
  await download(URL, zipPath)

  console.log('解壓縮中...')
  execFileSync('powershell', [
    '-NoProfile', '-Command',
    `Expand-Archive -Path "${zipPath}" -DestinationPath "${CACHE_DIR}" -Force`,
  ])

  if (!fs.existsSync(exePath)) {
    throw new Error(`解壓縮後找不到 ${exePath}，請確認官方 zip 內容結構是否變更。`)
  }
  fs.unlinkSync(zipPath)
  console.log(`完成：${exePath}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
