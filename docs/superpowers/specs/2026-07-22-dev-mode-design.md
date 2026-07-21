# 恢復開發模式（去 Docker 版）設計

> 日期：2026-07-22
> 狀態：設計已核可，待寫實作計畫

## 背景與動機

`2026-07-20-native-launcher-packaging` 分支移除了 Docker 與舊的 `backend/src/index.ts`（Docker 時代的 dev entrypoint）後，日常開發（改前端/後端功能，不是改 launcher 本身）失去了熱重載能力：

- `backend` 已無 `dev` script。
- `frontend` 的 `npm run dev`（Vite）proxy 設定指向 `localhost:3001`／`ws://localhost:7880`，但這兩個 port 現在都沒有東西在監聽（原本分別是 `index.ts` 與 Docker 的 LiveKit 容器）。
- 唯一能測試的方式變成「改代碼 → `node scripts/build-launcher.mjs` → 重啟 `LiveMR.bat`」，沒有熱重載，每次都要整個重來。

目標：在完全不依賴 Docker 的前提下，恢復前後端各自的熱重載開發流程。

## 目標與範圍

**目標**：
- `frontend`：`npm run dev`（Vite HMR）能正常運作，proxy 到一個真的有在跑的後端與 LiveKit。
- `backend`：有一個輕量 dev entrypoint，`tsx watch` 熱重載。
- LiveKit：原生 `livekit-server.exe`（單機模式），不需要 Docker。

**明確不做（YAGNI）**：
- Dev 模式的 LiveKit 只綁 `127.0.0.1`（localhost），不支援手機等其他裝置連線測試——那個用途已經有 `build-launcher.mjs` + `LiveMR.bat` 的完整流程可以測，不需要在 dev 模式裡重做一次。
- 不改 `frontend/vite.config.ts`——它現有的 proxy 設定已經正好對到這次要新增的兩個 port（`:3001`、`:7880`），不需要更動。
- 不做 TLS——`getUserMedia`（攝影機）在 `localhost` 視為 secure context，dev 模式本來就不需要自簽憑證。
- 不在 dev entrypoint 裡管理 LiveKit 子行程生命週期——LiveKit 用獨立的 `scripts/dev-livekit.ts` 手動起停，跟 backend dev server 分開，各自能單獨重啟不互相影響。

## 架構

```
Vite dev server（frontend，:5173，HMR）
   ├─ /api     → backend/src/dev.ts（tsx watch，:3001，熱重載）
   └─ /livekit → livekit-server.exe（scripts/dev-livekit.ts 起的，:7880，只綁 localhost）
```

三個獨立終端機視窗，各自獨立重啟：
```bash
npx tsx scripts/dev-livekit.ts     # 一次性起，改後端/前端不用重開這個
cd backend && npm run dev         # tsx watch
cd frontend && npm run dev        # vite
```

## 觸及的元件

| # | 檔案 | 改動 |
|---|------|------|
| 1 | `backend/src/dev.ts`（新增） | 輕量 dev entrypoint：純 HTTP `:3001`、掛 `createRouter`、不做 TLS、不 serve 前端靜態檔、不管 LiveKit 生命週期。`LIVEKIT_URL`/`API_KEY`/`SECRET` 設成與 `dev-livekit.ts` 一致的 `ws://127.0.0.1:7880` + `devkey`/`devsecret1234567890devsecret1234567890` |
| 2 | `scripts/dev-livekit.ts`（新增，`.ts` 而非 `.mjs`） | 重用 `backend/src/launcher/livekitConfig.ts` 的 `buildLivekitConfig()` 與 `livekitProcess.ts` 的 `LiveKitProcess`（不重複造輪子），`nodeIp: '127.0.0.1'`，前景執行、Ctrl+C 結束並確保子行程一併結束。用 `npx tsx scripts/dev-livekit.ts` 執行（見下方說明） |
| 3 | 根目錄 `package.json` | 新增 `devDependencies.tsx`（`scripts/dev-livekit.ts` 需要直接 import `backend/src/launcher/*.ts`，純 `node` 無法執行 `.ts`，用 `tsx` 這個既有專案已經在用的工具，不用 Node 的實驗性 `--experimental-strip-types`） |
| 4 | `backend/package.json` | 加回 `"dev": "tsx watch --env-file=../.env src/dev.ts"` |
| 5 | `frontend/vite.config.ts` | 不需要改動（現有 proxy 設定已經對得上） |

日常開發流程第一行改成：`npx tsx scripts/dev-livekit.ts`（不是 `node scripts/dev-livekit.mjs`——腳本副檔名也從 `.mjs` 改成 `.ts`）。
