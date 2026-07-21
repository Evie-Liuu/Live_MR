// 組裝最終可攜式 LiveMR/ 資料夾：esbuild 打包 backend standalone entry、
// build 前端、複製 livekit-server.exe / node.exe / ffmpeg.exe，產生 LiveMR.bat。
// 前置：先跑過 node scripts/fetch-livekit-server.mjs 與 node scripts/fetch-portable-node.mjs。
// 用法：node scripts/build-launcher.mjs
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CACHE_DIR = path.join(ROOT, '.build-cache')
const OUT_DIR = path.join(ROOT, 'dist-launcher', 'LiveMR')

function requireCached(relPath, hint) {
  const full = path.join(CACHE_DIR, relPath)
  if (!fs.existsSync(full)) {
    throw new Error(`找不到 ${full}。請先執行：${hint}`)
  }
  return full
}

async function main() {
  const livekitExe = requireCached('livekit-server.exe', 'node scripts/fetch-livekit-server.mjs')
  const nodeDir = requireCached('node-win-x64', 'node scripts/fetch-portable-node.mjs')

  // 只清掉這次要重新產生的 bin/ 與 app/，不動 data/（裡面是使用者的錄影檔跟憑證）
  // 也不動既有的 launcher.env（使用者可能已經填好 GEMINI_API_KEY）。
  // 重新跑這支腳本是預期中的「更新 LiveMR」流程，不應該每次都把使用者資料清空。
  fs.rmSync(path.join(OUT_DIR, 'bin'), { recursive: true, force: true })
  fs.rmSync(path.join(OUT_DIR, 'app'), { recursive: true, force: true })
  fs.mkdirSync(path.join(OUT_DIR, 'bin'), { recursive: true })
  fs.mkdirSync(path.join(OUT_DIR, 'app'), { recursive: true })
  fs.mkdirSync(path.join(OUT_DIR, 'data'), { recursive: true })

  console.log('打包 backend...')
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'backend', 'src', 'standalone.ts')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    // 輸出 CJS（而非 ESM）：backend 的依賴混雜 ESM/CJS，esbuild 對「bundle 成 CJS」
    // 的 interop 處理比「bundle 成 ESM 又要手動 shim require()」更成熟可靠。
    // .cjs 副檔名讓 Node 明確以 CommonJS 執行，不受旁邊任何 package.json 的
    // "type": "module" 影響。import.meta.url 的處理見下面的 define/banner 說明。
    format: 'cjs',
    outfile: path.join(OUT_DIR, 'app', 'standalone.bundle.cjs'),
    // esbuild 對「cjs 輸出格式下的 import.meta.url」並不會做任何轉換，只會把整個
    // import.meta 換成空物件字面量 `{}`（見官方警告：import.meta is not available
    // with the "cjs" output format and will be empty）。standalone.ts 用
    // path.dirname(fileURLToPath(import.meta.url)) 算出自己的目錄，若不處理，
    // 執行期會是 fileURLToPath(undefined) 直接丟 ERR_INVALID_ARG_TYPE 而整個啟動失敗
    // （已在實際跑一次 LiveMR.bat 時炸出來，見開發紀錄）。用 define + banner 手動
    // 把 import.meta.url 換成等價的 CJS 寫法：require('url').pathToFileURL(__filename).href。
    // __filename 在 CJS 模組作用域下就是這支 bundle 檔本身的路徑，語意上與原本
    // import.meta.url（指向 standalone.ts 打包後所在檔案）完全對應。
    define: { 'import.meta.url': 'IMPORT_META_URL_SHIM' },
    banner: { js: "const IMPORT_META_URL_SHIM = require('url').pathToFileURL(__filename).href;" },
  })

  console.log('Build 前端...')
  execFileSync('npm', ['run', 'build'], { cwd: path.join(ROOT, 'frontend'), stdio: 'inherit', shell: true })
  fs.cpSync(path.join(ROOT, 'frontend', 'dist'), path.join(OUT_DIR, 'app', 'frontend-dist'), { recursive: true })

  console.log('複製 binary...')
  fs.copyFileSync(livekitExe, path.join(OUT_DIR, 'bin', 'livekit-server.exe'))
  fs.cpSync(nodeDir, path.join(OUT_DIR, 'bin', 'node-runtime'), { recursive: true })
  // ffmpeg-static 下載時已把 binary 放進 backend/node_modules/ffmpeg-static/ffmpeg.exe
  const ffmpegSrc = path.join(ROOT, 'backend', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe')
  if (!fs.existsSync(ffmpegSrc)) {
    throw new Error(`找不到 ${ffmpegSrc}，請先在 backend/ 執行過 npm install。`)
  }
  fs.copyFileSync(ffmpegSrc, path.join(OUT_DIR, 'bin', 'ffmpeg.exe'))

  const launcherBat = `@echo off
chcp 65001 > nul
title LiveMR
cd /d "%~dp0"
set "RECORDINGS_DIR=%~dp0data\\recordings"
set "FFMPEG_PATH=%~dp0bin\\ffmpeg.exe"
"%~dp0bin\\node-runtime\\node.exe" "%~dp0app\\standalone.bundle.cjs"
pause
`
  fs.writeFileSync(path.join(OUT_DIR, 'LiveMR.bat'), launcherBat)

  // GEMINI_API_KEY 沒有預設值可用（不像 LIVEKIT_API_KEY/SECRET 有 devkey 這種本地
  // 開發用預設值），AI 助理功能沒設就完全無法運作。附一份範本檔 + 說明，
  // 讓老師知道要編輯這個檔案，而不是啟動後才發現 AI 助理悄悄壞掉。
  // 只在第一次（檔案不存在時）寫入範本——重新打包不應該蓋掉使用者已經填好的金鑰。
  const launcherEnvPath = path.join(OUT_DIR, 'launcher.env')
  if (!fs.existsSync(launcherEnvPath)) {
    const launcherEnv = `# 編輯這個檔案設定 AI 助理需要的金鑰，存檔後重新啟動 LiveMR.bat 生效。
# 到 https://aistudio.google.com/apikey 免費取得金鑰。
GEMINI_API_KEY=
`
    fs.writeFileSync(launcherEnvPath, launcherEnv)
  }

  console.log(`\n完成：${OUT_DIR}\n雙擊 LiveMR.bat 即可啟動。\n若要使用 AI 助理，記得先編輯 LiveMR/launcher.env 填入 GEMINI_API_KEY。`)
}

main().catch((err) => { console.error(err); process.exit(1) })
