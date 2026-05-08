# 開發環境設定筆記

> 給前端工程師的全端開發入門說明。以「為什麼要這樣做」為出發點，先懂架構再記指令。

---

## 第一層：速查表

### 每次開發前（啟動環境）

```bash
# 1. 啟動 Docker 服務（nginx + LiveKit）
cd C:/Project/Live_MR
docker compose up -d nginx livekit

# 2. 啟動後端（另開一個終端機）
cd backend
npx tsx watch src/index.ts

# 3. 啟動前端 dev server（另開一個終端機）
cd frontend
npm run dev
```

完成後開啟 https://192.168.0.145

---

### 停止

```bash
# 停止 Docker 服務
docker compose down

# 後端 / 前端：直接在終端機按 Ctrl+C
```

---

### 查看 logs

```bash
# nginx log（看請求有沒有進來）
docker compose logs nginx --tail=50

# livekit log
docker compose logs livekit --tail=50

# 即時追蹤
docker compose logs -f nginx
```

---

### 重啟 nginx（改了 nginx/default.conf 之後）

```bash
docker compose restart nginx
```

---

### 確認服務都在跑

```bash
docker compose ps          # 看 Docker 服務狀態
netstat -an | grep :5174   # 確認 Vite 在跑
netstat -an | grep :3001   # 確認後端在跑
```

---

### 需要先安裝的工具

| 工具 | 用途 | 下載 |
|------|------|------|
| Docker Desktop | 跑 nginx + LiveKit | https://www.docker.com/products/docker-desktop |
| Node.js 22+ | 跑前後端 | https://nodejs.org |
| mkcert | 產生本機 HTTPS 憑證 | `winget install mkcert` |

---

### 初次設定（只做一次）

```bash
# 1. 安裝根憑證到系統（讓瀏覽器信任 mkcert 憑證）
mkcert -install

# 2. 產生憑證（替換成你的區網 IP）
cd C:/Project/Live_MR
mkcert -key-file certs/key.pem -cert-file certs/cert.pem localhost 127.0.0.1 192.168.0.145

# 3. 複製並填寫環境變數（.env 在 gitignore，不會上傳）
# 把 .env 裡的 IP 換成你自己的 (ipconfig 查詢)
```

---

## 第二層：架構說明

### 這個專案同時跑幾個「程式」？

開發時一共有 **4 個服務**同時運作：

```
瀏覽器
  │
  ▼
nginx（Docker, port 443）   ← 唯一對外的入口，負責 HTTPS
  ├─── /api/*   →  後端 Express（host, port 3001）
  ├─── /livekit →  LiveKit（Docker, port 7880）
  └─── /*       →  Vite dev server（host, port 5174）
```

| 服務 | 在哪裡跑 | 負責什麼 |
|------|---------|---------|
| **nginx** | Docker 容器 | HTTPS 終止、把請求分發給對的服務 |
| **Vite dev server** | 你的電腦（host） | 提供前端 React 頁面，支援 HMR 熱更新 |
| **後端 Express** | 你的電腦（host） | REST API，管理房間、核發 LiveKit token |
| **LiveKit** | Docker 容器 | WebRTC 伺服器，處理即時視訊串流 |

---

### 為什麼要用 Docker？

只有兩個服務需要在 Docker 裡跑，原因不同：

**nginx**：
相機（`getUserMedia`）在瀏覽器裡是受限 API，**只有在 HTTPS 下才能用**。本機 HTTPS 需要 SSL 憑證，而 nginx 就是負責 SSL 的那一層。你的程式碼（Vite、Express）本身跑 HTTP 就好，nginx 幫你在外層套 HTTPS。

**LiveKit**：
LiveKit 是現成的 WebRTC 服務，直接用官方 Docker image 最省事。LiveKit 需要開一段 UDP port（50000-50020）給 WebRTC 傳輸用。

前端和後端為什麼**不**放在 Docker 裡？因為開發時需要即時修改程式碼、看到 HMR 更新，在 host 上跑最方便。Docker 裡跑 dev server 反而麻煩（volume mount、rebuild 問題）。

---

### 一個請求怎麼走？

以其他裝置開啟 `https://192.168.0.145` 為例：

```
1. 其他裝置瀏覽器
      │  HTTPS 連到 192.168.0.145:443
      ▼
2. nginx（Docker）
      │  解密 SSL，看 URL 路徑決定轉去哪
      │
      ├── 路徑是 /api/*
      │     │  HTTP 轉發到 host 的 port 3001
      │     ▼
      │   後端 Express → 回傳 JSON
      │
      ├── 路徑是 /livekit/*
      │     │  WebSocket 轉發到 livekit 容器 port 7880
      │     ▼
      │   LiveKit → WebRTC 信令
      │
      └── 其他路徑（/, /src/*, /assets/*...）
            │  HTTP 轉發到 host 的 port 5174
            ▼
          Vite dev server → 回傳 HTML / JS / CSS
```

關鍵點：**所有流量都進 nginx，nginx 再分流**。其他裝置不需要知道後端在哪、Vite 在哪，只需要知道 `192.168.0.145`。

---

### `.env` 每個變數是做什麼的？

```env
# 後端 Express 監聽的 port
PORT=3001

# LiveKit 的 API 金鑰（對應 livekit.yaml 裡的設定）
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret1234567890devsecret1234567890

# 後端用的 LiveKit 連線位址
# 後端跑在 host，但 LiveKit 跑在 Docker，
# 同一個 docker-compose 裡服務名稱就是 hostname
LIVEKIT_URL=ws://livekit:7880

# 前端（瀏覽器）用的 LiveKit 連線位址
# 瀏覽器在外面，不能用 docker 內部的 hostname，
# 所以要透過 nginx proxy 的路徑連進去
VITE_LIVEKIT_URL=wss://192.168.0.145/livekit

# 給前端顯示 QR code / 連結用的 domain
VITE_APP_DOMAIN=192.168.0.145
```

**重要細節 — VITE_ 前綴**：
Vite 在編譯時只會把 `VITE_` 開頭的變數嵌入到前端程式碼，其他變數（例如 `LIVEKIT_API_SECRET`）不會傳給瀏覽器，避免洩漏機密。

**重要細節 — envDir**：
`.env` 放在專案根目錄，但 Vite dev server 從 `frontend/` 啟動。Vite 預設只找自己目錄下的 `.env`，所以 `vite.config.ts` 裡加了 `envDir: '..'` 讓它往上一層找。

---

### 跨裝置開發（其他手機/平板測試）

要求：
- **同一個 WiFi**（其他裝置要能路由到 `192.168.0.145`）
- **信任 mkcert 根憑證**（否則瀏覽器擋 HTTPS）

**取得根憑證**：
```bash
# 查詢 mkcert CA 存放位置
mkcert -CAROOT
# 會顯示類似 C:\Users\User\AppData\Local\mkcert
# 裡面的 rootCA.pem 就是要分享的檔案
```

只需要分享 `rootCA.pem`，`rootCA-key.pem` 是私鑰，**不要分享**。

**各裝置安裝步驟**：

Android（Chrome）
```
1. 把 rootCA.pem 傳到手機（Line、AirDrop 等）
2. 設定 → 安全性 → 安裝憑證 → CA 憑證
3. 選剛才的檔案安裝
```

iOS（Safari）
```
1. 把 rootCA.pem 傳到 iPhone（AirDrop 或 email）
2. 設定 → 已下載的描述檔 → 安裝
3. 設定 → 一般 → 關於本機 → 憑證信任設定
4. 把 mkcert 的憑證切換為「啟用完全信任」
```

Windows（其他電腦）
```
1. 雙擊 rootCA.pem
2. 安裝憑證 → 本機電腦 → 受信任的根憑證授權單位
```

---

### 常見問題

**Q: 啟動後連 https://192.168.0.145 出現 502 Bad Gateway**
nginx 連不到 Vite 或後端。確認 Vite（port 5174）和後端（port 3001）都在跑。

**Q: 其他裝置看到「您的連線不是私人連線」**
mkcert 根憑證沒裝到那個裝置，照上面步驟安裝。

**Q: 改了 nginx/default.conf 沒有生效**
```bash
docker compose restart nginx
```

**Q: `VITE_LIVEKIT_URL` 沒有生效，LiveKit 連不上**
確認 `frontend/vite.config.ts` 裡有 `envDir: '..'`，而且 `.env` 在專案根目錄（不是在 `frontend/`）。改完需要重啟 Vite。

**Q: 查自己的區網 IP**
```bash
ipconfig
# 找「無線區域網路」或「乙太網路」下的 IPv4 位址
```
