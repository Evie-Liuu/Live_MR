# 純本地端封裝（去 Docker / 免額外安裝）設計

> 日期：2026-07-17
> 狀態：設計已核可，待寫實作計畫

## 背景與動機

目前老師端要跑起整套服務（`docker-compose.yml`）需要：Docker Desktop、Git for Windows（提供 `openssl.exe` 備援）、OpenSSL、以及選用的 Cloudflare Tunnel（`cloudflared`，`start-tunnel.ps1`）。這些都是「使用者需要另外下載安裝」的額外軟體。

目標是把老師端打包成**一個可攜式資料夾**，雙擊執行檔即可啟動全部服務（nginx / redis / livekit / livekit-egress / backend / frontend 的功能對應），過程中不要求使用者安裝任何額外軟體，且維持現有「純區網（LAN）分享」的使用方式不變。

範圍限定：**只處理老師端主機**。學生端本來就是瀏覽器掃碼加入、免安裝，不受影響。目標平台**只支援 Windows**（現況啟動腳本皆為 `.bat`/`.ps1`，假設現場即為 Windows 筆電/教師電腦）。

## 目標與範圍

**目標**：
- 老師端不需安裝 Docker Desktop、Git、OpenSSL、cloudflared。
- 維持現有 LAN 直連 + HTTPS + 攝影機權限的行為（自簽憑證綁區網 IP）。
- 維持課堂錄製（大屏畫面 + 每人音訊 + FFmpeg 合成 MP4）功能，音訊來源改為純瀏覽器端。
- 提供可攜式（免安裝、免系統管理員權限）的執行檔形式。

**明確不做（YAGNI）**：
- 不支援 macOS / Linux 老師端（只做 Windows）。
- 不提供「曝露到公網」的功能（移除 `cloudflared` 外網隧道整條路徑），純 LAN 分享。
- 不嘗試把 Docker Desktop 靜默安裝進來（評估後放棄：需要 WSL2/重開機風險、背景常駐資源、授權灰色地帶，詳見下方「評估過的替代方案」）。
- 不重寫 AI 助理呼叫 Gemini 的機制——這是既有的、必要的外部 API 呼叫（不在「額外安裝軟體」的範圍內，跟本次封裝目標無關）。
- 不做安裝精靈 / 系統管理員安裝版本（只做可攜式資料夾）。

## 評估過的替代方案：直接把 Docker Desktop 靜默安裝進安裝包

Docker Desktop 支援 `install --quiet --accept-license --backend=wsl-2` 靜默安裝，理論上可以塞進自己的安裝流程。放棄原因：
1. 若目標機器 WSL2/虛擬化尚未啟用，啟用 Windows 功能可能仍需重開機，無法保證無感。
2. 裝完後是常駐服務（背景 VM 常駐吃 2–4GB RAM、系統匣圖示、自動更新提示），不符合「輕量本地小工具」的定位。
3. 授權條款「教育用途」明確排除「透過統一安排達到機構規模部署」，若之後要給整個學校/學區安裝，可能落入需要付費 Business 訂閱的灰色地帶，需另外洽詢 Docker 官方或法務確認。
4. 就算裝好 Docker，LiveKit Egress 的映像檔本身還要另外拉（含 Chrome + GStreamer，約 1–2GB），並未真正解決「免額外下載」的目標。

因此改為下方的「移除 Docker，逐一用原生方案替換」設計。

## 元件對應（Docker → 原生方案）

| 現有（Docker） | 替換為 | 理由 |
|---|---|---|
| Nginx（TLS 終止 + 反向代理） | Node/Express 內建 `https` + 輕量 proxy middleware | 同一個 Node process 直接做 TLS 終止、轉發 `/livekit/*`、serve 前端靜態檔，不再需要獨立 frontend container |
| OpenSSL（經 Git for Windows 尋找） | JS 憑證產生（`selfsigned` 或 `node-forge`） | 純 JS 產生自簽憑證（SAN 綁區網 IP），行為對使用者無感，一樣是「第一次連線瀏覽器跳警告」 |
| Docker Desktop / Docker Compose | 移除，改直接 spawn 原生 Windows binary（子行程） | LiveKit server 為純 Go、有 Windows binary、單機模式免 Redis；Node backend 本來就可原生執行 |
| Redis | 移除 | 目前只有 LiveKit Egress 需要 Redis 做訊息匯流排；Egress 拿掉後，LiveKit 核心單機模式不需要 Redis |
| LiveKit Egress（server-side `.ogg` 逐人音軌） | 移除，改「每位參與者（含學生）瀏覽器端 `MediaRecorder` 錄自己麥克風」 | Egress 官方主要靠 Docker/Linux（GStreamer + Chrome），沒有實用的原生 Windows binary，是唯一無法直接原生替換的部件，改用既有的「Host 端瀏覽器錄音」模式擴大到所有參與者 |
| Cloudflare Tunnel（`cloudflared`） | 移除 | 產品定位改為純 LAN 分享，這是選用功能整條移除 |
| Git（僅作為 openssl.exe 備援來源） | 移除 | 連帶被移除，已無用途 |

保留不變：LiveKit 的媒體/WebRTC 行為（`node_ip` 綁區網 IP、UDP port range 40000–40020、`use_external_ip: false`）、前端動作捕捉全部在瀏覽器端（本來就與 Docker 無關）、FFmpeg 合成（`ffmpeg-static` 本來就是 npm 依賴、跨平台自帶 binary，不需改動）。

## LAN 直連行為不受影響

移除的只是「外網隧道」這條**選用**路徑（`start-tunnel.ps1`）。現有「LAN 直連」路徑（`setup.ps1` / `start.bat`）的機制照舊保留：憑證 `subjectAltName` 綁老師電腦的區網 IP，其他裝置只要同一區網、開 `https://<LAN_IP>` 就能用（`getUserMedia` 只要求 secure context，不要求公開機構簽發憑證）。新架構下這條路徑一樣由主程式產生綁 LAN IP 的自簽憑證、一樣終止 TLS、LiveKit 一樣用 `node_ip=<LAN_IP>`，行為與現況一致。

## 錄製流程變更

**維持不變**：BigScreen 畫面錄製（canvas → webm）、FFmpeg 合成邏輯（`amix` 多軌音訊 + 影片 → `output.mp4`）。

**改變的部分**：
1. 移除 `EgressService`（`backend/src/egress.ts`）與 `.ogg` 這條音軌來源。
2. 「錄製開始/停止」訊號現在也要送到**學生端**（現況這訊號只在老師瀏覽器內部用 `BroadcastChannel` 轉給大屏，學生端收不到）。做法：老師端多發一則 LiveKit `publishData(reliable)` 廣播給所有學生（與現有「互動相位」廣播用同一條 data channel），`StudentSession` 收到後本機啟動 `MediaRecorder` 錄自己麥克風，停止時透過既有的 `POST /recording/audio`（`X-Session-Id` + `X-Participant-Identity` header）上傳——此端點目前已存在，只是目前只有 Host 端在呼叫，現在讓每位學生端也呼叫。
3. `merge.ts` 簡化：不用再判斷「`.ogg` 優先、`.webm` 備援」，每人固定就是一支 `audio_{identity}.webm`。
4. 已知取捨：若學生中途關分頁或上傳失敗，該學生這段音訊會缺失——風險等級與現況 Host 自己那軌一致，只是範圍擴大到所有參與者，不是新的失敗模式。

## 打包後的啟動/關閉體驗

可攜式資料夾，雙擊 `LiveMR.exe` 即可啟動：

```
LiveMR/
  LiveMR.exe              ← 啟動器（Node Single Executable，內含 backend + 前端靜態檔）
  bin/
    livekit-server.exe    ← 原生 Windows binary，只綁 127.0.0.1:7880（不直接對外曝露）
    ffmpeg.exe            ← 沿用現有 ffmpeg-static 的 binary
  data/
    certs/                ← 首次執行自動產生（JS 產生，取代 openssl）
    recordings/
```

啟動流程：
1. 偵測區網 IP（沿用 `setup.ps1` 現有邏輯的 Node 版本，用 `os.networkInterfaces()`）。
2. 若 IP 已變更或無憑證 → 用 JS 產生自簽憑證（SAN 綁該 IP）。
3. 產生 LiveKit 執行期設定（帶入 `node_ip`、`keys`、port range），spawn `livekit-server.exe` 子行程（只監聽 `127.0.0.1:7880`）。
4. 主程式用 Node `https` 監聽 `0.0.0.0:443`（Windows 綁 443 不需要系統管理員權限，這點跟 Linux/macOS 不同）：serve 前端靜態檔、`/api/*` 走內建 Express route、`/livekit/*` reverse-proxy 轉給 `127.0.0.1:7880`。
5. 自動開啟預設瀏覽器導向 `https://<LAN_IP>`。
6. 主控制台視窗顯示 LAN 網址 / QR code，關閉視窗（或 Ctrl+C）時連帶結束 `livekit-server.exe` 子行程，不留殘留行程占用 port。

使用者全程只看到「解壓縮 → 雙擊 `LiveMR.exe` → 瀏覽器跳出來」，不會被要求安裝 Docker / Git / OpenSSL / cloudflared 任何一項。

## 觸及的元件（現有程式碼）

| # | 檔案/目錄 | 改動 |
|---|------|------|
| 1 | `docker-compose.yml`、`nginx/`、`livekit.yaml.template`、`egress.yaml` | 移除（功能改由下方新元件承接） |
| 2 | `setup.ps1`、`start.bat`、`start-tunnel.bat`、`start-tunnel.ps1` | 移除，改由新的 `LiveMR.exe` 啟動器取代 |
| 3 | `backend/src/egress.ts` | 移除 |
| 4 | `backend/src/merge.ts` | 簡化：拿掉 `.ogg`/`.webm` 雙軌判斷邏輯 |
| 5 | `backend/src/routes.ts` | 錄製 stop 邏輯不再呼叫 `EgressService`；`/recording/audio` 端點沿用（呼叫方擴大到學生端） |
| 6 | `frontend/src/hooks/useRecording.ts` | Host 端錄製開始/停止時，額外對學生廣播一則 `publishData(reliable)` 訊號 |
| 7 | `frontend/src/components/StudentSession.tsx` | 新增：接收錄製開始/停止訊號 → 本機 `MediaRecorder` 錄麥克風 → 停止後上傳 |
| 8 | 新增：`launcher/`（暫定目錄名） | Node Single Executable 啟動器原始碼：IP 偵測、憑證產生、spawn LiveKit、TLS + reverse proxy + 靜態檔 serve |
| 9 | `backend/` build 流程 | 新增 production build（不再用 `tsx watch`，改編譯成純 JS 供啟動器內嵌） |

## 待確認的實作細節（留給實作計畫階段）

- Node Single Executable Application（Node 20+ SEA）打包 backend 的可行性驗證（含原生依賴如 `ffmpeg-static` 路徑解析）。
- `livekit-server.exe` 的取得方式（官方 release 下載 or 自行 cross-compile）與版本鎖定策略。
- reverse proxy 套件選型（`http-proxy-middleware` 或手寫）。
