# 開發環境設定筆記

> 給前端工程師的全端開發入門說明。以「為什麼要這樣做」為出發點，先懂架構再記指令。

---

## 第一層：速查表

### 每次開發前（啟動環境）

```bash
# 1. 建置前端（standalone 入口只會 serve 建置後的靜態檔）
cd frontend
npm run build

# 2. 啟動整個服務（後端 API + LiveKit 子行程 + 前端靜態檔，同一個 Node 行程）
cd ../backend
npx tsx src/standalone.ts
```

終端機會印出偵測到的區網 IP，例如 `https://192.168.0.145`，並自動開啟瀏覽器（第一次連線瀏覽器會跳「不安全連線」警告，屬正常現象，按「進階」→「繼續前往」即可）。

---

### 停止

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
# 下載 LiveKit 官方 Windows binary，解壓縮出 livekit-server.exe（存到 .build-cache/）
node scripts/fetch-livekit-server.mjs
```

不需要手動安裝根憑證、不需要編輯 `SERVER_NAME` / `NGINX_PORT` 之類的環境變數——執行一次 `standalone.ts`，它會自動偵測目前的區網 IP，並在 `data/certs/` 產生綁定該 IP 的自簽憑證（下次啟動若 IP 沒變會直接複用）。

若要覆寫 LiveKit 金鑰、對外 port 或設定 `GEMINI_API_KEY`，在 repo 根目錄（或 `backend/`，視你執行 `standalone.ts` 的相對路徑而定）建立 `launcher.env`，寫法與 `.env` 相同（`KEY=value`）。

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

**Q: 改了前端程式碼沒有生效**
`standalone.ts` 只 serve 建置後的 `frontend/dist`，改完前端程式碼要重新 `cd frontend && npm run build` 再重啟 `standalone.ts` 才會看到變化。

**Q: LiveKit 連不上 / `/livekit` 一直失敗**
確認 `node scripts/fetch-livekit-server.mjs` 有成功跑過（`.build-cache/livekit-server.exe` 存在）；查看 `standalone.ts` 的終端機輸出有沒有 LiveKit 啟動失敗的訊息。

**Q: 查自己的區網 IP**
```bash
ipconfig
# 找「無線區域網路」或「乙太網路」下的 IPv4 位址
```
