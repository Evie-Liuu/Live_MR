# 開發環境設定筆記

> 給前端工程師的全端開發入門說明。以「為什麼要這樣做」為出發點，先懂架構再記指令。

---

## 第一層：速查表

### 每次開發前（啟動環境）

```bash
# 一次打包整個 launcher：build 前端、esbuild bundle backend、
# 複製 livekit-server.exe / node.exe / ffmpeg.exe，組裝到 dist-launcher/LiveMR/
node scripts/build-launcher.mjs

# 執行組裝好的 launcher
cd dist-launcher/LiveMR
./LiveMR.bat
```

終端機會印出偵測到的區網 IP，例如 `https://192.168.0.145`，並自動開啟瀏覽器（第一次連線瀏覽器會跳「不安全連線」警告，屬正常現象，按「進階」→「繼續前往」即可）。

> **不能用 `npx tsx src/standalone.ts` 直接跑。** `backend/src/standalone.ts` 用 `__dirname` 相對路徑去找 `bin/livekit-server.exe`、`bin/ffmpeg.exe`、`app/frontend-dist`，這個目錄結構只有 `scripts/build-launcher.mjs` 組裝出的 `dist-launcher/LiveMR/` 裡才成立。改了 backend 程式碼想測試，就重新跑一次 `node scripts/build-launcher.mjs`（esbuild bundle 很快，通常一兩秒）再重啟 `LiveMR.bat`。

---

### 快速迭代開發模式（改代碼即時生效，不用重新打包）

上面「每次開發前」那條路徑（`build-launcher.mjs` + `LiveMR.bat`）跑的是**打包後**的版本，改一行程式碼就要重新 build，對日常前端/後端開發來說太慢。想要改了就立刻在瀏覽器看到結果（HMR 熱重載、`tsx watch` 自動重啟），改用這套**三個終端機視窗**的 dev 模式：

```bash
# 視窗 1：dev 用 LiveKit（僅綁 127.0.0.1，固定用 devkey/devsecret，不會跟正式環境衝突）
npx tsx scripts/dev-livekit.ts

# 視窗 2：後端 API（Express + tsx watch，改檔案自動重啟，port 3001）
cd backend && npm run dev

# 視窗 3：前端（Vite dev server，HMR 熱重載，port 5173）
cd frontend && npm run dev
```

三個都要跑起來、且順序不重要（`dev-livekit.ts` 與 `backend/src/dev.ts` 互相不依賴啟動順序，只要兩邊都連到 `127.0.0.1:7880` 即可）。啟動後開 `http://localhost:5173`：Vite 會把 `/api/*` proxy 到 `http://localhost:3001`（視窗 2 的 Express），把 `/livekit/*` proxy 到 `ws://localhost:7880`（視窗 1 的 LiveKit，proxy 規則會先把 `/livekit` 前綴去掉），設定在 `frontend/vite.config.ts` 的 `server.proxy`。

**跟打包測試的差別（不要搞混）：**

| | 快速迭代開發模式（本節） | 打包測試（`LiveMR.bat`，見「每次開發前」） |
|---|---|---|
| 啟動方式 | 三個終端機分別跑 `dev-livekit.ts` / `backend npm run dev` / `frontend npm run dev` | 一個 `LiveMR.bat`（`build-launcher.mjs` 組裝出來） |
| 改程式碼 | 存檔立即生效（HMR / `tsx watch`），不用重新打包 | 要重新跑 `node scripts/build-launcher.mjs` 才會反映 |
| 網址 | `http://localhost:5173`（純 HTTP，只給自己這台電腦用） | `https://<你的區網IP>`（HTTPS，其他裝置也能連） |
| LiveKit / 金鑰 | 固定 `devkey`/`devsecret`，只綁 `127.0.0.1` | 每次啟動隨機/沿用 `launcher.env`，綁區網 IP |
| 用途 | 本機快速開發迭代 | 驗證「其他裝置真的能用」的最終打包結果 |

這套 dev 模式**只是給你自己在這台電腦上快速迭代用**，不會、也不該拿來當作「這個功能真的可以動」的驗收依據——例如要確認跨裝置、HTTPS 憑證警告、正式打包產物有沒有問題，還是得照「每次開發前」那條路徑跑 `build-launcher.mjs` + `LiveMR.bat`。兩條路徑不要混著用，也不需要同時跑。

**停止：** 三個視窗個別按 `Ctrl+C`。`scripts/dev-livekit.ts` 有註冊 `SIGINT`/`SIGTERM`，收到訊號會自己關掉 `livekit-server.exe` 子行程再結束；`backend`/`frontend` 的 `Ctrl+C` 由 `tsx`/`vite` 自己處理。關閉後可以用工作管理員或 `tasklist` 確認沒有殘留的 `livekit-server.exe` / 相關 `node.exe` 行程。

---

### 停止（打包測試模式）

在跑 `standalone.ts` 的終端機按 `Ctrl+C`，會自動一併關閉 LiveKit 子行程與 HTTPS 伺服器。

---

### 查看 logs

沒有額外容器，後端與 LiveKit 的 log 都直接印在同一個終端機視窗裡。

---

### 需要先安裝的工具

| 工具 | 用途 | 下載 |
|------|------|------|
| Node.js 22+ | 跑前後端、LiveKit 下載腳本 | https://nodejs.org |

不再需要 Docker Desktop 或 mkcert：LiveKit 改用原生 Windows binary（`livekit-server.exe`），HTTPS 憑證改由 `selfsigned` 套件在啟動時自動產生。

---

### 初次設定（只做一次）

```bash
# 下載 LiveKit 官方 Windows binary（存到 .build-cache/livekit-server.exe）
node scripts/fetch-livekit-server.mjs

# 下載可攜式 Node.js runtime（存到 .build-cache/node-win-x64/）
node scripts/fetch-portable-node.mjs
```

這兩個只需要跑一次（產物快取在 `.build-cache/`，之後每次 `node scripts/build-launcher.mjs` 都會直接複用，不會重新下載）。

不需要手動安裝根憑證、不需要編輯 `SERVER_NAME` / `NGINX_PORT` 之類的環境變數——`LiveMR.bat` 執行時會自動偵測目前的區網 IP，並在 `dist-launcher/LiveMR/data/certs/` 產生綁定該 IP 的自簽憑證（下次啟動若 IP 沒變會直接複用）。

若要設定 `GEMINI_API_KEY`（AI 助理功能需要）或覆寫 LiveKit 金鑰，編輯 `dist-launcher/LiveMR/launcher.env`（`node scripts/build-launcher.mjs` 每次都會產生這個範本檔），寫法與 `.env` 相同（`KEY=value`）。

---

## 第二層：架構說明

### 這個專案同時跑幾個「程式」？

開發時實際上只有 **一個 Node 行程**（`standalone.ts`），它會自己把 LiveKit 拉起來當子行程：

```
瀏覽器
  │
  ▼
standalone.ts（Node，port 443）   ← 唯一對外的入口，內建 https 模組終止 TLS
  ├─── /api/*     →  內建 Express route（同一個行程直接處理）
  ├─── /livekit/* →  livekit-server.exe（子行程，127.0.0.1:7880）
  └─── /*         →  frontend/dist 靜態檔（先 npm run build 產生）
```

| 服務 | 在哪裡跑 | 負責什麼 |
|------|---------|---------|
| **standalone.ts** | 你的電腦（Node 行程） | HTTPS 終止、serve 前端靜態檔、把 `/api`、`/livekit` 請求分流出去 |
| **內建 Express route** | 與 standalone.ts 同行程 | REST API，管理房間、核發 LiveKit token |
| **livekit-server.exe** | 子行程（127.0.0.1，由 standalone.ts 拉起/關閉） | WebRTC 伺服器，處理即時視訊串流 |

---

### 為什麼不再需要 Docker？

以前 nginx 負責 SSL 終止，LiveKit 用官方 Docker image 最省事，Redis 給 LiveKit 做多 worker 狀態協調。現在：

- **SSL 終止**：改由 Node 內建 `https` 模組直接做，憑證用 `selfsigned` 套件在程式啟動時自動產生（`backend/src/launcher/certs.ts`），不需要另外安裝憑證工具或維護根憑證。
- **LiveKit**：改抓官方 Windows release 的 `livekit-server.exe`，`standalone.ts` 啟動時把它當子行程拉起（`backend/src/launcher/livekitProcess.ts`），關閉時一併終止；單機教室場景不需要多 worker，也就不需要 Redis。

---

### 一個請求怎麼走？

以其他裝置開啟 `https://192.168.0.145` 為例：

```
1. 其他裝置瀏覽器
      │  HTTPS 連到 192.168.0.145:443
      ▼
2. standalone.ts（Node）
      │  解密 SSL，看 URL 路徑決定轉去哪
      │
      ├── 路徑是 /api/*
      │     │  同行程內直接呼叫 Express route
      │     ▼
      │   回傳 JSON
      │
      ├── 路徑是 /livekit/*
      │     │  http-proxy-middleware 轉發到 127.0.0.1:7880
      │     ▼
      │   livekit-server.exe → WebRTC 信令
      │
      └── 其他路徑（/, /assets/*...）
            │  讀取 frontend/dist 靜態檔
            ▼
          回傳 HTML / JS / CSS
```

關鍵點：**所有流量都進 `standalone.ts`，它再分流**。其他裝置不需要知道 LiveKit 在哪，只需要知道你電腦的區網 IP。

---

### 跨裝置開發（其他手機/平板測試）

要求：
- **同一個 WiFi**（其他裝置要能路由到你電腦偵測到的區網 IP）

**信任憑證**：
`standalone.ts` 用 `selfsigned` 自動產生的憑證沒有加入任何系統信任清單，所以每個裝置第一次連線都會看到「您的連線不是私人連線」之類的警告——這是預期行為，選「進階」→「繼續前往」即可，不需要額外安裝根憑證或跑 `mkcert -install`。

---

### 常見問題

**Q: 啟動後連 `https://192.168.0.145` 打不開 / 逾時**
確認 `standalone.ts` 有印出啟動成功的訊息、終端機沒有噴錯；確認其他裝置與這台電腦在同一個 WiFi。

**Q: 其他裝置看到「您的連線不是私人連線」**
這是預期行為（自簽憑證未加入系統信任清單），選「進階」→「繼續前往」即可，不需要安裝任何根憑證。

**Q: 改了前端或後端程式碼沒有生效**
執行的是 `dist-launcher/LiveMR/app/` 裡打包好的版本，不是原始碼。改完程式碼要重新跑 `node scripts/build-launcher.mjs`（它會重新 build 前端、重新 bundle 後端，並複製到 `dist-launcher/LiveMR/`）再重啟 `LiveMR.bat` 才會看到變化。

**Q: LiveKit 連不上 / `/livekit` 一直失敗**
確認 `node scripts/fetch-livekit-server.mjs` 有成功跑過（`.build-cache/livekit-server.exe` 存在），且 `node scripts/build-launcher.mjs` 有把它複製到 `dist-launcher/LiveMR/bin/livekit-server.exe`；查看 `LiveMR.bat` 的終端機輸出有沒有 LiveKit 啟動失敗的訊息。

**Q: 查自己的區網 IP**
```bash
ipconfig
# 找「無線區域網路」或「乙太網路」下的 IPv4 位址
```
