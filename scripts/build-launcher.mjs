// 組裝最終可攜式 LiveMR/ 資料夾：esbuild 打包 backend standalone entry、
// build 前端、複製 livekit-server.exe / node.exe / ffmpeg.exe，產生 LiveMR.bat。
// 前置：先跑過 node scripts/fetch-livekit-server.mjs 與 node scripts/fetch-portable-node.mjs。
// 用法：
//   內部版：node scripts/build-launcher.mjs
//   交付測試版：node scripts/build-launcher.mjs --tester "測試單位名稱" --expires 2026-12-31
//     另外產生全新的 dist-launcher/delivery/<名稱>_<到期日>/LiveMR 與同名 .zip：
//     寫入測試者浮水印與到期日、拿掉用不到的 npm、檢查沒有夾帶金鑰／私鑰／資料庫等才壓縮。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import { auditDelivery } from './delivery-audit.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CACHE_DIR = path.join(ROOT, '.build-cache')

/**
 * 遞迴複製資料夾。不用 fs.cpSync：Windows 上的 Node 22 複製到含中文的路徑
 * （交付版資料夾以測試者名稱命名）會直接 segfault。
 */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDir(from, to)
    else if (entry.isFile()) fs.copyFileSync(from, to)
  }
}

function argValue(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

/** 交付測試版的授權資訊；沒給 --tester 就是內部版 */
function readLicenseArgs() {
  const tester = argValue('--tester')?.trim()
  const expires = argValue('--expires')?.trim()
  if (!tester && !expires) return null
  if (!tester || !expires) throw new Error('交付測試版要同時給 --tester 與 --expires')
  // JS 的 Date 會把不存在的日期（例如 11-31）自動進位成下個月，要另外比對年月日
  const [y, m, d] = expires.split('-').map(Number)
  const day = new Date(y, m - 1, d)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expires) || day.getFullYear() !== y || day.getMonth() !== m - 1 || day.getDate() !== d) {
    throw new Error(`--expires 要是存在的日期（YYYY-MM-DD）：${expires}`)
  }
  if (new Date(`${expires}T23:59:59`).getTime() < Date.now()) throw new Error(`到期日 ${expires} 已經過了`)
  return { tester, expires, id: crypto.randomBytes(4).toString('hex') }
}

const LICENSE = readLicenseArgs()
const DELIVERY_NAME = LICENSE ? `${LICENSE.tester.replace(/[\\/:*?"<>|\s]+/g, '_')}_${LICENSE.expires}` : null
const OUT_DIR = LICENSE
  ? path.join(ROOT, 'dist-launcher', 'delivery', DELIVERY_NAME, 'LiveMR')
  : path.join(ROOT, 'dist-launcher', 'LiveMR')

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

  // 若背景正在執行 LiveMR (livekit-server.exe 或 portable node.exe)，刪除 bin/ 會因檔案鎖定拋出 EPERM。
  // 在清理與覆寫前先終止源自 dist-launcher 的背景程序。
  const killLauncherProcesses = () => {
    if (process.platform === 'win32') {
      try {
        execFileSync('powershell', ['-NoProfile', '-Command', "Get-Process | Where-Object { $_.Path -and $_.Path.Contains('dist-launcher') } | Stop-Process -Force"], { stdio: 'ignore' })
      } catch {}
      try { execFileSync('taskkill', ['/F', '/IM', 'livekit-server.exe', '/T'], { stdio: 'ignore' }) } catch {}
    }
  }

  if (LICENSE) {
    // 交付版每次都從空資料夾開始，不會帶到之前執行產生的 data/、launcher.env 或壓縮檔；
    // 也不去關本機正在跑的 LiveMR（交付版是另一個資料夾）
    fs.rmSync(path.dirname(OUT_DIR), { recursive: true, force: true })
    fs.rmSync(`${path.dirname(OUT_DIR)}.zip`, { force: true })
  } else {
    killLauncherProcesses()
  }

  try {
    fs.rmSync(path.join(OUT_DIR, 'bin'), { recursive: true, force: true })
    fs.rmSync(path.join(OUT_DIR, 'app'), { recursive: true, force: true })
  } catch (err) {
    if (err && (err.code === 'EPERM' || err.code === 'EBUSY')) {
      killLauncherProcesses()
      fs.rmSync(path.join(OUT_DIR, 'bin'), { recursive: true, force: true })
      fs.rmSync(path.join(OUT_DIR, 'app'), { recursive: true, force: true })
    } else {
      throw err
    }
  }

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
    // 壓縮讓程式碼不易閱讀；keepNames 保留函式／類別名稱，錯誤訊息與依名稱判斷的程式才不會壞
    minify: true,
    keepNames: true,
    legalComments: 'none',
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
    define: {
      'import.meta.url': 'IMPORT_META_URL_SHIM',
      // 交付測試版的授權資訊（backend/src/launcher/license.ts 讀取）；內部版不定義＝不受限
      ...(LICENSE ? { __LIVEMR_LICENSE__: JSON.stringify(JSON.stringify(LICENSE)) } : {}),
    },
    banner: { js: "const IMPORT_META_URL_SHIM = require('url').pathToFileURL(__filename).href;" },
  })

  console.log('Build 前端...')
  // 前端的浮水印與到期畫面（frontend/src/config/buildLicense.ts）；內部版明確清空，避免沿用環境變數
  const frontendEnv = {
    ...process.env,
    VITE_LICENSE_TESTER: LICENSE?.tester ?? '',
    VITE_LICENSE_EXPIRES: LICENSE?.expires ?? '',
    VITE_LICENSE_ID: LICENSE?.id ?? '',
  }
  execFileSync('npm', ['run', 'build'], { cwd: path.join(ROOT, 'frontend'), stdio: 'inherit', shell: true, env: frontendEnv })
  copyDir(path.join(ROOT, 'frontend', 'dist'), path.join(OUT_DIR, 'app', 'frontend-dist'))

  // trustStore.ts 的 trustCaForOpenSsl() 用 import.meta.url 定位這個檔案：esbuild 把
  // standalone.ts 打包成單一 app/standalone.bundle.cjs 後，import.meta.url 的 shim
  // （見上面的 banner 說明）會指向這支 bundle 檔本身，所以 path.dirname(...) 算出來
  // 就是 app/ 目錄——這個 .pem 必須跟著複製到同一個位置，執行期才找得到。
  fs.copyFileSync(
    path.join(ROOT, 'backend', 'src', 'launcher', 'public-ca-bundle.pem'),
    path.join(OUT_DIR, 'app', 'public-ca-bundle.pem'),
  )

  console.log('複製 binary...')
  fs.copyFileSync(livekitExe, path.join(OUT_DIR, 'bin', 'livekit-server.exe'))
  copyDir(nodeDir, path.join(OUT_DIR, 'bin', 'node-runtime'))
  if (LICENSE) {
    // LiveMR.bat 只用 node.exe；交付版拿掉 npm / npx / corepack，少一點可以被拿來研究的東西
    const rt = path.join(OUT_DIR, 'bin', 'node-runtime')
    for (const name of ['npm', 'npm.cmd', 'npm.ps1', 'npx', 'npx.cmd', 'npx.ps1', 'corepack', 'corepack.cmd', 'install_tools.bat', 'nodevars.bat', 'node_modules']) {
      fs.rmSync(path.join(rt, name), { recursive: true, force: true })
    }
  }
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
    // 交付測試版保留學生免登入加入（仍需老師核准），測試時不用替每位學生準備帳號
    const guestJoin = `
# 學生免登入加入（仍需老師核准）；不需要時刪掉這行
ENABLE_GUEST_JOIN=1
`
    fs.writeFileSync(launcherEnvPath, LICENSE ? launcherEnv + guestJoin : launcherEnv)
  }

  if (LICENSE) {
    console.log('交付前檢查...')
    const problems = auditDelivery(OUT_DIR)
    if (problems.length) {
      throw new Error('交付版檢查沒過，未產生壓縮檔：\n' + problems.map(p => `  - ${p}`).join('\n'))
    }
    const zipPath = `${path.dirname(OUT_DIR)}.zip`
    // Windows 10 以上內建的 tar（bsdtar）可以直接產生 zip
    execFileSync(process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar', ['-a', '-c', '-f', zipPath, '-C', path.dirname(OUT_DIR), 'LiveMR'], { stdio: 'inherit' })
    console.log(`\n交付測試版完成：${zipPath}\n測試者：${LICENSE.tester}　有效至：${LICENSE.expires}　識別碼：${LICENSE.id}\n（請記下識別碼，外流時可以對照）\n若要讓對方使用 AI 助理，請另外提供可撤銷、有額度上限的金鑰，由對方自行填入 launcher.env。`)
    return
  }

  console.log(`\n完成：${OUT_DIR}\n雙擊 LiveMR.bat 即可啟動。\n若要使用 AI 助理，記得先編輯 LiveMR/launcher.env 填入 GEMINI_API_KEY。`)
}

main().catch((err) => { console.error(err); process.exit(1) })
