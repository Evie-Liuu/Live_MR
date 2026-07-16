# Google Cloud Platform 上線部署流程（初學者版）

> 這份文件帶你**從零**把 Live_MR 部署到 Google Cloud Platform（以下簡稱 GCP），讓網路上任何人都能用網域名稱連上。
> 假設你**沒有雲端經驗**，每一步都會說明「為什麼」和「怎麼做」。照著做就會成功。
>
> 本次採用的方案（你已選定）：
> - **一台 Compute Engine 虛擬機（VM）+ docker compose**
> - **靜態外部 IP + 自己的網域 + Let's Encrypt 免費 HTTPS 憑證**
> - **機型 e2-standard-4（4 vCPU / 16GB）**：因為要錄影或多人同時上線

---

## 0. 先看懂整體架構（很重要）

這個專案不是單一程式，而是 **6 個服務一起跑**（用 `docker-compose.yml` 一次啟動）：

```
                         網際網路上的使用者（手機 / 電腦瀏覽器）
                                      │
              HTTPS(443/TCP)          │          WebRTC 影音(UDP 40000-40020)
                                      ▼
   ┌──────────────────────  一台 GCP VM（Ubuntu + Docker）  ──────────────────────┐
   │                                                                              │
   │   ┌─────────┐   /        ┌──────────┐    /api      ┌──────────┐             │
   │   │  nginx  │ ─────────► │ frontend │              │ backend  │ ◄── Gemini  │
   │   │ (443)   │ │          │  (React) │   ┌─────────►│ (Express)│     AI API   │
   │   │ 反向代理 │ │/livekit  └──────────┘   │          └────┬─────┘             │
   │   └────┬────┘ │                          │               │ 發行 token        │
   │        │      └──────────►┌──────────┐◄──┘               │                  │
   │        └────────────────► │ livekit  │ ◄────────────────┘                  │
   │                           │ (WebRTC) │                                      │
   │                           └────┬─────┘                                      │
   │                                 │                                          │
   │              ┌──────────┐        │                                         │
   │              │  redis   │ ◄──────┘                                         │
   │              └──────────┘                                                  │
   └──────────────────────────────────────────────────────────────────────────┘
```

| 服務 | 角色 | 對外連接埠 |
|------|------|-----------|
| **nginx** | 反向代理 + HTTPS 入口，把流量分流給 frontend / backend / livekit | 443/TCP |
| **frontend** | React 網頁畫面 | （由 nginx 代理，不直接對外） |
| **backend** | Express API，發行 LiveKit 連線 token、串接 Gemini AI | （由 nginx 代理） |
| **livekit** | WebRTC 影音伺服器（即時視訊核心） | 40000-40020/UDP |
| **redis** | livekit 的內部資料庫 | （不對外） |

### 為什麼用「一台 VM」而不是 Cloud Run？

很多教學會推薦 GCP 的 **Cloud Run**（無伺服器、自動擴展、便宜）。但**這個專案不能用 Cloud Run**，原因：

1. **WebRTC 需要 UDP 連接埠**（40000-40020）。Cloud Run 只支援 HTTP，**不支援 UDP**。
2. **即時影音需要長時間連線**，Cloud Run 的請求有時間限制、會自動關閉閒置容器。
3. **錄影服務需要 `SYS_ADMIN` 權限和本機磁碟**，Cloud Run 沙箱不允許。

所以正確做法是：開一台**虛擬機（VM）**，把現有的 `docker compose` 原封不動搬上去。這也最貼近你現在的開發方式，最好理解。

---

## 1. 開始前的前置清單

你需要先準備好這些：

- [ ] 一個 **Google 帳號**
- [ ] 一張**信用卡**（GCP 計費需要，新用戶通常有免費額度）
- [ ] 一個**自己的網域名稱**（例如 `example.com`，可在 GoDaddy / Cloudflare / Google Domains 等購買）
- [ ] 你電腦上能用**終端機**（Windows 可用 PowerShell 或 Git Bash）
- [ ] 本專案的程式碼（Git 倉庫網址）

---

## 2. 初學者名詞小辭典

| 名詞 | 白話解釋 |
|------|---------|
| **Compute Engine / VM** | GCP 上租來的一台「雲端電腦」，你可以遠端登入、安裝軟體。 |
| **靜態外部 IP** | 固定不變的公開 IP 位址。網域要指向它，所以不能變動。 |
| **防火牆規則（Firewall）** | 決定「哪些連接埠可以從外面連進來」。預設全部擋住，要手動開放。 |
| **DNS / A record** | 把網域名稱（`example.com`）對應到 IP 位址的設定。 |
| **Docker / docker compose** | 把多個服務打包成容器、一鍵啟動的工具。本專案已寫好設定。 |
| **HTTPS / 憑證 / Let's Encrypt** | 讓網址變成 `https://` 加密連線。Let's Encrypt 提供免費憑證。 |
| **WebRTC / UDP** | 瀏覽器之間傳即時影音的技術，走 UDP 連接埠。 |
| **SSH** | 從你的電腦安全地遠端登入那台 VM 的方式。 |

---

## 3. 費用預估（請先有心理準備）

實際以 GCP 帳單為準，以下為**粗估（asia-east1 台灣機房，2026 年參考價）**：

| 項目 | 規格 | 約略月費 |
|------|------|---------|
| VM 機器 | e2-standard-4（4 vCPU / 16GB），全月開機 | 約 US$100–130 |
| 開機磁碟 | 50GB SSD | 約 US$8 |
| 靜態 IP | 1 個（使用中時通常免費，閒置才收費） | 約 US$0–3 |
| 對外流量 | 影音上傳流量（egress） | 依使用量，US$0.12/GB 起 |

> **省錢提示：** 只在活動期間開機、平常關機（停用 VM 不收 CPU 費，但磁碟和 IP 仍計費）。或選 e2-standard-2 降規（人少時夠用）。

---

## 4. 步驟一：建立 GCP 專案並啟用計費

1. 開啟 [https://console.cloud.google.com](https://console.cloud.google.com) 並登入 Google 帳號。
2. 頂端專案選單 → **新增專案** → 命名（例如 `live-mr-prod`）→ 建立。
3. 左側選單 → **計費（Billing）** → 連結一個計費帳戶（綁信用卡）。
4. 啟用會用到的 API：搜尋並啟用 **Compute Engine API**（第一次會等一兩分鐘）。

---

## 5. 步驟二：保留一個靜態外部 IP

網域要永久指向同一個 IP，所以先保留一個固定 IP。

1. 左側選單 → **VPC 網路 → IP 位址 → 外部 IP 位址**。
2. 點 **保留靜態外部 IP 位址**。
3. 設定：
   - 名稱：`live-mr-ip`
   - 類型：**區域性（Regional）**
   - 區域：選離使用者近的，例如 **asia-east1（台灣）**
4. 建立後會看到一個 IP（例如 `34.80.x.x`）。**把它記下來**，後面到處會用到。

---

## 6. 步驟三：建立防火牆規則

預設外面什麼都連不進來，要手動開放這台機器需要的連接埠。

到 **VPC 網路 → 防火牆 → 建立防火牆規則**，建立以下幾條（每條都設定：方向=輸入 Ingress、目標=指定標記、來源 IPv4 範圍 `0.0.0.0/0`）：

| 名稱 | 目標標記(Target tag) | 通訊協定/連接埠 | 用途 |
|------|---------------------|----------------|------|
| `allow-https` | `live-mr` | TCP: **443** | HTTPS 網頁 |
| `allow-http` | `live-mr` | TCP: **80** | Let's Encrypt 憑證申請與續期 |
| `allow-webrtc-udp` | `live-mr` | UDP: **40000-40020** | WebRTC 影音（**最關鍵，少了它影像連不上**） |
| `allow-ssh` | `live-mr` | TCP: **22** | 遠端登入 |

> 「目標標記」`live-mr` 等一下建立 VM 時會貼到 VM 上，這樣規則才會套用到那台機器。

---

## 7. 步驟四：建立 Compute Engine VM

1. 左側選單 → **Compute Engine → VM 執行個體 → 建立執行個體**。
2. 基本設定：
   - 名稱：`live-mr-vm`
   - 區域 / 可用區：與靜態 IP **同區域**（例如 `asia-east1` / `asia-east1-a`）
   - 機型（Machine type）：**e2-standard-4**（4 vCPU / 16GB）
3. 開機磁碟（Boot disk）：
   - 作業系統：**Ubuntu**，版本 **Ubuntu 22.04 LTS**
   - 磁碟大小：**50GB**（錄影檔很佔空間，建議大一點；之後可加大）
4. 網路設定（展開「進階選項 → 網路」）：
   - **網路標記（Network tags）**：填 `live-mr`（對應上一步的防火牆）
   - **外部 IPv4 位址**：選你剛剛保留的 `live-mr-ip`（不要用臨時 IP）
5. 點 **建立**。等一兩分鐘 VM 就會啟動。

---

## 8. 步驟五：把網域指向這台機器（DNS）

到你買網域的服務商（GoDaddy / Cloudflare 等）的 DNS 設定頁，新增一筆 **A 紀錄**：

| 類型 | 名稱 (Host) | 值 (Value) | TTL |
|------|------------|-----------|-----|
| A | `@`（或 `mr`，看你要用 `example.com` 還是 `mr.example.com`） | 你的靜態 IP，例如 `34.80.x.x` | 自動 / 600 |

> DNS 生效需要幾分鐘到幾小時。可在自己電腦終端機用 `nslookup 你的網域` 確認它已經回傳正確 IP，再往下做。

本文以 `mr.example.com` 為例，**請把後面所有 `mr.example.com` 換成你自己的網域**。

---

## 9. 步驟六：登入 VM 並安裝 Docker

1. 在 VM 列表那一列點 **SSH**（瀏覽器會開一個終端機視窗，最簡單，不用設金鑰）。
2. 在這個終端機裡，逐段貼上指令安裝 Docker 與 Git：

```bash
# 更新套件清單
sudo apt-get update

# 安裝 Docker（官方一鍵腳本）
curl -fsSL https://get.docker.com | sudo sh

# 讓目前使用者不用 sudo 也能跑 docker（執行後請登出再用 SSH 重新登入一次）
sudo usermod -aG docker $USER

# 安裝 Git
sudo apt-get install -y git

# 驗證
docker --version
docker compose version
```

> 跑完 `usermod` 那行後，**關掉 SSH 視窗再重新開一次**，群組權限才會生效。

---

## 10. 步驟七：取得程式碼並設定環境變數 `.env`

```bash
# 把程式碼抓下來（換成你的 Git 倉庫網址）
git clone <你的-Git-倉庫網址> live-mr
cd live-mr

# 先產生兩段隨機字串，待會當作 LiveKit 的金鑰（請各自複製保存）
openssl rand -hex 16   # 這是 API KEY（範例輸出：a1b2c3...）
openssl rand -hex 32   # 這是 API SECRET（至少 32 字元）

# 用範例檔建立正式設定檔
cp .env.example .env
nano .env              # 編輯（nano 編輯器：改完按 Ctrl+O 存檔、Ctrl+X 離開）
```

`.env` 請填成**正式環境的值**（重點欄位）：

```ini
PORT=3001

# nginx 對外用的網域（不是 IP！Let's Encrypt 憑證會綁這個名字）
SERVER_NAME=mr.example.com

NGINX_PORT=443

# 填入你上一步用 openssl 產生的值（不要再用範例的 devkey/devsecret）
LIVEKIT_API_KEY=剛剛產生的-API-KEY
LIVEKIT_API_SECRET=剛剛產生的-API-SECRET

# 後端在 Docker 內部連 livekit 用，維持不變
LIVEKIT_URL=ws://livekit:7880

# 前端（瀏覽器）連 livekit 用，走網域 + /livekit 路徑
VITE_LIVEKIT_URL=wss://mr.example.com/livekit

# 前端用的對外網域
VITE_APP_DOMAIN=mr.example.com

# Gemini AI 金鑰：到 https://aistudio.google.com/apikey 申請
GEMINI_API_KEY=你的-gemini-key
GEMINI_MODEL=gemini-2.5-flash,gemini-2.5-flash-lite,gemini-2.0-flash-lite
```

---

## 11. 步驟八：上線前**必改**的設定（非常重要）

這個專案原本是為「區域網路 / 開發」設計的，直接上線會有幾個地方連不上。**請務必先改以下三處**，否則影音或網頁會失敗。

### 11-1. 讓 LiveKit 正確回報「公開 IP」（影音能連上的關鍵）

GCP 的 VM 內部看到的是內部 IP，外面的人要用的是外部靜態 IP。LiveKit 必須知道自己的「公開 IP」，否則手機端拿到錯的位址就連不上影音。

編輯 `livekit.yaml.template`：

```bash
nano livekit.yaml.template
```

把 `use_external_ip` 改成 `true`（讓 LiveKit 自動偵測公開 IP），`node_ip` 那行刪掉或註解掉：

```yaml
port: 7880
rtc:
  # node_ip: __SERVER_NAME__      # ← 註解掉這行（雲端用自動偵測）
  port_range_start: 40000
  port_range_end: 40020
  use_external_ip: true           # ← 改成 true
room:
  enable_remote_unmute: true
keys:
  # ↓ 換成與 .env 相同的金鑰（KEY: SECRET）
  剛剛產生的-API-KEY: 剛剛產生的-API-SECRET
redis:
  address: redis:6379
logging:
  level: info
```

> **為什麼？** 原本 `node_ip` 會被換成 `SERVER_NAME`，但我們現在 `SERVER_NAME` 是「網域名稱」而不是 IP，LiveKit 的 `node_ip` 需要 IP。改用 `use_external_ip: true` 由 LiveKit 自動透過 STUN 找出公開 IP，最省事也最可靠。

### 11-2. 前端要「正式打包」，不要用開發伺服器

原本 `docker-compose.yml` 的 frontend 是跑 `npm run dev`（開發模式，慢又不穩）。正式上線要用打包好的靜態檔。**最乾淨的做法是建立一個正式用的覆寫檔** `docker-compose.prod.yml`：

```bash
nano docker-compose.prod.yml
```

貼上：

```yaml
# 正式環境覆寫：用打包好的前端、移除 dev 用的原始碼掛載
services:
  backend:
    build:
      context: ./backend
      target: ""          # 用 Dockerfile 最終階段（正式版）
    command: ["node", "dist/index.js"]
    volumes:
      - ./recordings:/recordings   # 只保留錄影目錄，移除原始碼熱更新掛載

  frontend:
    build:
      context: ./frontend
      args:
        # Vite 的 VITE_ 變數是「打包當下」就寫死進去的，所以要在 build 階段傳入
        VITE_LIVEKIT_URL: wss://mr.example.com/livekit
        VITE_APP_DOMAIN: mr.example.com
    image: live-mr-frontend
    command: ["nginx", "-g", "daemon off;"]   # 用 nginx 提供靜態檔，不要 npm run dev
    volumes: []                                # 移除 dev 用的原始碼掛載
```

> 同時要確認 `frontend/Dockerfile` 的打包指令有開啟（目前第 10-11 行 `npm run build` 被註解掉了）。請編輯 `frontend/Dockerfile`，讓 build 階段實際執行 `RUN npm run build`，並接收上面的 `ARG VITE_LIVEKIT_URL`、`ARG VITE_APP_DOMAIN`。若不熟，可請工程師協助這一段，或先用開發模式上線測試、之後再優化。

### 11-3. 確認 nginx 的網域與憑證路徑

`nginx/default.conf.template` 已經會用 `SERVER_NAME` 當 `server_name`，並讀取 `/etc/nginx/certs/cert.pem`、`key.pem`。我們下一步就是把 Let's Encrypt 憑證放進 `./certs/`。**不需要改 nginx 設定**，只要憑證檔放對位置即可。

---

## 12. 步驟九：申請 HTTPS 憑證（Let's Encrypt）

我們用 `certbot` 在 VM 主機上申請免費憑證，再把它複製到專案的 `certs/` 資料夾給 nginx 用。

> 申請時 certbot 需要用到 **80 連接埠**，而且網域 DNS 必須已經指到這台機器（步驟五）。先確定此時 nginx 還沒啟動佔用 80（我們的 nginx 用 443，host 的 80 是空的，沒問題）。

```bash
# 安裝 certbot
sudo apt-get install -y certbot

# 申請憑證（換成你的網域與 email）
sudo certbot certonly --standalone -d mr.example.com --email you@example.com --agree-tos --no-eff-email

# 成功後憑證會在 /etc/letsencrypt/live/mr.example.com/
# 複製成 nginx 要的檔名，放進專案 certs/ 目錄
mkdir -p ~/live-mr/certs
sudo cp /etc/letsencrypt/live/mr.example.com/fullchain.pem ~/live-mr/certs/cert.pem
sudo cp /etc/letsencrypt/live/mr.example.com/privkey.pem  ~/live-mr/certs/key.pem
sudo chown $USER:$USER ~/live-mr/certs/*.pem
```

> 憑證有效期 90 天，第 16 章會教**自動續期**。

---

## 13. 步驟十：啟動所有服務

```bash
cd ~/live-mr

# 用「基本設定 + 正式覆寫」一起啟動（-d 代表背景執行）
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# 看每個服務的狀態（應該都是 running / healthy）
docker compose ps

# 看即時日誌（Ctrl+C 離開，不會關掉服務）
docker compose logs -f
```

第一次 `--build` 會花幾分鐘（要下載映像、打包前端）。

---

## 14. 步驟十一：驗證是否成功

1. **後端健康檢查**（在 VM 上）：
   ```bash
   curl -k https://localhost/api/health
   ```
   有回應（非錯誤）就代表 backend + nginx 正常。
2. **用瀏覽器打開** `https://mr.example.com`：
   - 網址列要顯示**鎖頭**（HTTPS 正常、憑證有效）。
   - 畫面正常載入。
3. **影音測試（最重要）**：用**手機切換到行動網路（4G/5G，不要連同一個 Wi-Fi）**打開網站，加入房間，確認看得到即時影像。
   - 如果網頁開得起來但**影像連不上**，幾乎都是 **UDP 40000-40020 防火牆沒開**，或 LiveKit 的 `use_external_ip` 沒設成 `true`（回到步驟六、11-1 檢查）。

---

## 15. 常見問題排除

| 症狀 | 可能原因 | 解法 |
|------|---------|------|
| 網頁打不開、瀏覽器轉圈 | 443 防火牆沒開 / 服務沒啟動 | 檢查防火牆 `allow-https`；`docker compose ps` 看服務狀態 |
| 出現「不安全」憑證警告 | 憑證沒放對 / 網域不符 | 確認 `certs/cert.pem`、`key.pem` 存在，且 `.env` 的 `SERVER_NAME` 等於網域 |
| 網頁正常但**看不到影像** | UDP 沒開 / LiveKit 外部 IP 設定錯 | 開 `allow-webrtc-udp`(40000-40020)；`livekit.yaml.template` 設 `use_external_ip: true` |
| 連 token 失敗 / 一進房就斷 | 三個檔案金鑰不一致 | 確認 `.env`、`livekit.yaml.template` 用**同一組** KEY/SECRET |
| AI 助理沒反應 | Gemini 金鑰錯/額度滿 | 看 `docker compose logs backend`；確認 `GEMINI_API_KEY` |

查看單一服務日誌：`docker compose logs -f livekit`（把 livekit 換成服務名）。

---

## 16. 日常維運

### 更新程式碼（部署新版本）
```bash
cd ~/live-mr
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

### 讓服務「開機自動啟動」
docker compose 設定裡已有 `restart: unless-stopped`，VM 重開機後 Docker 會自動把容器拉回來。確認 Docker 本身開機啟動：
```bash
sudo systemctl enable docker
```

### HTTPS 憑證自動續期（很重要，否則 90 天後會過期）
建立一個自動續期 + 複製 + 重載 nginx 的排程：
```bash
# 編輯 root 的排程
sudo crontab -e
```
加入這一行（每天凌晨 3 點檢查，到期前會自動續，再把新憑證複製給 nginx 並重載）：
```cron
0 3 * * * certbot renew --quiet && cp /etc/letsencrypt/live/mr.example.com/fullchain.pem /home/你的使用者/live-mr/certs/cert.pem && cp /etc/letsencrypt/live/mr.example.com/privkey.pem /home/你的使用者/live-mr/certs/key.pem && cd /home/你的使用者/live-mr && docker compose exec nginx nginx -s reload
```

### 備份錄影檔
錄影存在 VM 的 `~/live-mr/recordings/`。建議定期下載或上傳到 GCS（Cloud Storage）保存，並清理舊檔避免磁碟爆滿：
```bash
df -h                    # 看磁碟使用量
du -sh ~/live-mr/recordings   # 看錄影佔多少
```

### 關機省錢 / 重新開機
在 GCP Console 的 VM 列表可**停止（Stop）**機器（停止後不收 CPU 費，但磁碟與 IP 仍計費），活動前再**啟動（Start）**。靜態 IP 不會變，網域不用重設。

---

## 17. 上線前安全檢查清單

- [ ] `.env`、`livekit.yaml.template` 都已**換掉** `devkey` / `devsecret` 範例值，兩者一致
- [ ] `.env`、`certs/`、`recordings/` 都**沒有**被 commit 進 Git（檢查 `.gitignore`）
- [ ] 防火牆只開必要連接埠（443、80、22、UDP 40000-40020），沒有亂開 7880 等內部埠對外
- [ ] SSH 盡量用金鑰登入，不要開放密碼登入
- [ ] HTTPS 憑證自動續期排程已設定並測試（`sudo certbot renew --dry-run`）
- [ ] GCP 計費設定了**預算警示（Budget alert）**，避免帳單暴衝

---

## 附錄：快速指令備忘

```bash
# 啟動 / 重建
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
# 停止全部
docker compose down
# 看狀態
docker compose ps
# 看某服務日誌
docker compose logs -f <服務名>
# 測試憑證續期（不會真的續，只演練）
sudo certbot renew --dry-run
```
