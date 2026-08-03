# Live MR — 系統需求（最低標準）

> 文件版本：2026-07-29  
> 適用版本：Live MR v0.0.x（可攜式 Windows 封裝 / 開發模式）

本文件依據實際技術棧（React 19、MediaPipe WASM + GPU delegate、WebRTC / LiveKit、Three.js VRM、Web Speech API 等）整理出各角色裝置的最低系統需求。

---

## 一、角色說明

| 角色 | 裝置 | 說明 |
|------|------|------|
| **老師（Host）** | 執行 `LiveMR.bat` 的 Windows 電腦 | 同時是伺服器主機與課堂控制端 |
| **學生（Student）** | 任何能開啟瀏覽器的裝置（電腦 / 平板 / 手機） | 掃 QR Code 或輸入 URL 加入 |
| **大屏（BigScreen）** | 任何能開啟瀏覽器的裝置 | 通常是教室投影機 / 大型顯示器，與老師端同 WiFi |

> 大屏與老師端必須在**同一台電腦**的同一個瀏覽器內，透過 `BroadcastChannel` 通訊。  
> 學生端只需與老師端在**同一個 WiFi 網段**即可。

---

## 二、老師端（Host）主機

老師端電腦同時扮演**伺服器主機**與**瀏覽器用戶端**兩個角色，需求最高。

### 2.1 作業系統

| 項目 | 最低需求 | 說明 |
|------|---------|------|
| **作業系統** | Windows 10（64-bit）版本 1903 或更新 | LiveKit、Node.js、FFmpeg 皆使用原生 Windows x64 binary |
| Windows Server | **不支援** | 打包版本以 Windows 桌面環境為目標 |
| macOS / Linux | **不支援（打包版本）** | 開發模式下可自行編譯，但非官方支援 |

### 2.2 硬體（執行伺服器 + 瀏覽器同機）

| 項目 | 最低需求 | 建議 |
|------|---------|------|
| **CPU** | x64 四核 2.0 GHz（支援 AVX 指令集） | 六核以上；MediaPipe WASM 吃多執行緒 |
| **RAM** | 8 GB | 16 GB 以上（Three.js 場景 + MediaPipe 各需 ~1–2 GB） |
| **顯示卡 / GPU** | 支援 WebGL 2.0 的顯示卡（Intel UHD 620 以上） | 獨立 GPU（NVIDIA / AMD）；MediaPipe 優先使用 GPU delegate 加速動捕 |
| **網路** | 100 Mbps 區網（WiFi 5 / 802.11ac 或有線） | WiFi 6（802.11ax）；上行需能同時供 N 位學生的 WebRTC 串流 |
| **攝影機** | 720p 30fps USB / 內建攝影機 | 1080p 30fps；MediaPipe 動捕品質與解析度正相關 |
| **麥克風** | 任何系統可辨識之麥克風 | 降噪麥克風；Web Speech API STT 品質依賴硬體 |
| **可用磁碟** | 2 GB（軟體本體 + 動捕模型） | 5 GB 以上（含錄製暫存，每堂課約 200 MB–1 GB） |

### 2.3 網路連接埠

啟動後 `standalone.ts` 會佔用以下 port，請確認防火牆允許（僅限本機區網）：

| Port | 協定 | 用途 |
|------|------|------|
| **443** | TCP（HTTPS / WSS） | 對外唯一入口（瀏覽器連線） |
| **7880** | TCP（HTTP / WS，內部） | LiveKit 伺服器（綁定 127.0.0.1，不對外） |
| **3001** | TCP（HTTP，開發模式） | Express API（僅開發模式，打包版本無此 port） |
| **5173** | TCP（HTTP，開發模式） | Vite dev server（僅開發模式） |

---

## 三、學生端（Student）

### 3.1 支援裝置

| 裝置類型 | 最低需求 |
|---------|---------|
| **桌機 / 筆電** | Windows 10+、macOS 12+、Ubuntu 20.04+（64-bit） |
| **平板** | iPad（iPadOS 16+）、Android 平板（Android 10+） |
| **手機** | iPhone（iOS 16+）、Android 手機（Android 10+） |

> 手機 / 平板螢幕較小，建議橫向（landscape）使用；動捕計算吃重，低階機型可能出現延遲。

### 3.2 硬體

| 項目 | 最低需求 |
|------|---------|
| **RAM** | 4 GB 可用（動捕 WASM 約需 1–1.5 GB） |
| **GPU / 圖形** | 支援 WebGL 2.0（含整合顯示卡） |
| **攝影機** | 720p 前置或後置攝影機（動捕必要） |
| **麥克風** | 任何系統可辨識之麥克風（語音互動必要） |
| **網路** | 連接與老師端同一個 WiFi（2.4 GHz 可用，5 GHz 建議） |

---

## 四、大屏（BigScreen）

大屏由老師端電腦的**同一瀏覽器**開啟的另一個分頁或視窗提供，透過 `BroadcastChannel` 同步。

| 項目 | 需求 |
|------|------|
| **裝置** | 與老師端相同電腦 |
| **顯示** | 任何解析度顯示器（建議 1920×1080 以上投影至大屏） |
| **瀏覽器** | 與老師端相同的瀏覽器實例 |

> **大屏不能獨立運行於另一台電腦**，因為它依賴同瀏覽器的 `BroadcastChannel`（跨機器不通訊）。

---

## 五、瀏覽器需求

所有角色（老師 / 學生 / 大屏）皆需在**現代瀏覽器**中使用，以下為詳細需求：

### 5.1 支援瀏覽器

| 瀏覽器 | 最低版本 | 支援程度 | 說明 |
|--------|---------|---------|------|
| **Google Chrome** | 115 | ✅ 完整支援（主要開發目標） | Web Speech API、WebGL 2、WebRTC、WASM SIMD 支援最完整 |
| **Microsoft Edge** | 115（Chromium 核心） | ✅ 完整支援 | 與 Chrome 共用 Blink 引擎，相容性相同 |
| **Mozilla Firefox** | 115 | ⚠️ 部分支援 | **Web Speech API 不支援**（AI 語音提示無法使用）；其餘功能可用 |
| **Safari** | 17（macOS / iOS） | ⚠️ 部分支援 | Web Speech API 僅支援 iOS 17+ / macOS Safari 17+（需開啟設定）；自簽憑證警告處理方式不同 |
| **Samsung Internet** | 21 | ⚠️ 部分支援 | 基於 Chromium，基本功能可用，但 Web Speech API 支援不穩定 |
| **Opera** | 100 | ⚠️ 部分支援 | 基於 Chromium，基本功能可用 |

> ⚠️ **強烈建議使用 Google Chrome 或 Microsoft Edge** 以獲得完整功能（包括 AI 語音提示）。

### 5.2 必要瀏覽器 API

以下 API 為功能正常運作所必需：

| API | 用途 | 不支援時的影響 |
|-----|------|-------------|
| **WebRTC（getUserMedia、RTCPeerConnection）** | 攝影機存取、即時 P2P 媒體串流 | 系統無法運作 |
| **WebGL 2.0** | Three.js 3D 場景 / VRM 渲染 | 系統無法運作 |
| **WebAssembly（WASM）+ SIMD** | MediaPipe 動作捕捉模型執行 | 動捕無法運作，角色無法驅動 |
| **HTTPS / Secure Context** | 攝影機權限必須在安全環境下取得 | getUserMedia 被瀏覽器拒絕 |
| **Web Speech API（SpeechRecognition）** | 語音轉文字（老師語音 → AI 提示） | AI 教學提示功能失效（降級為 no-op） |
| **BroadcastChannel** | 老師端 ↔ 大屏同步 | 大屏無法收到 Pose 資料 |
| **MediaRecorder** | 課堂錄製（畫面 + 音訊） | 錄製功能失效 |
| **Canvas 2D / captureStream** | 大屏畫面捕捉 | 錄製功能失效 |
| **Fetch API / Long Polling** | 與後端 REST API 通訊 | 系統無法運作 |
| **SessionStorage** | 前端狀態機持久化 | 重新整理後狀態遺失 |

### 5.3 瀏覽器設定要求

| 設定 | 需求 |
|------|------|
| **攝影機權限** | 必須允許（老師端 / 學生端均需） |
| **麥克風權限** | 必須允許（老師端 / 學生端均需） |
| **JavaScript** | 必須啟用 |
| **Cookie / SessionStorage** | 必須啟用 |
| **彈出視窗** | 允許（大屏以新視窗開啟） |
| **自簽憑證警告** | 第一次連線需手動選「進階」→「繼續前往」 |

---

## 六、網路需求

| 項目 | 最低需求 | 建議 |
|------|---------|------|
| **拓撲** | 所有裝置必須在**同一個 WiFi / 區網**（直接路由可達） | 有線連接老師端電腦（更穩定的 SFU 路由） |
| **WiFi 標準** | 802.11n（WiFi 4）2.4 GHz | 802.11ac（WiFi 5）5 GHz 或 802.11ax（WiFi 6） |
| **頻寬（老師端上行）** | 每增加一位學生 ~500 Kbps–1 Mbps（WebRTC 媒體） | 50 Mbps 以上（視學生數量） |
| **延遲（區網）** | < 50 ms（設備間 RTT） | < 20 ms |
| **外網需求** | 僅 Gemini API 呼叫需要網際網路（AI 提示功能） | 穩定的網際網路連線（AI 呼叫有逾時 / 重試機制） |
| **防火牆 / NAT** | 老師端 Port 443 需允許區網裝置連入 | — |

> **重要**：本系統的 LiveKit SFU 為單機模式，所有 WebRTC 媒體流量皆在區網內處理，**不依賴外部 TURN/STUN 伺服器**。如有 NAT 隔離問題，需確保學生端與老師端在同一個子網。

---

## 七、外部服務相依

| 服務 | 必要性 | 說明 |
|------|-------|------|
| **Google Gemini API** | AI 提示功能必要，其餘功能可用 | 需要有效的 `GEMINI_API_KEY`；支援 `gemini-2.5-flash` → `flash-lite` → `2.0` 自動 fallback |
| **LiveKit 伺服器** | 系統核心必要 | 已隨 `LiveMR.bat` 打包（`bin/livekit-server.exe`），不需額外設定 |
| **網際網路** | 僅 AI 功能需要 | 其他功能（WebRTC、動捕、VRM）皆在本機/區網運作 |

---

## 八、開發環境需求

> 僅適用於開發者；一般使用者使用 `LiveMR.bat` 即可，不需以下工具。

| 工具 | 最低版本 | 說明 |
|------|---------|------|
| **Node.js** | v22 LTS | 前後端開發、Vite 建置、`tsx` 執行 |
| **npm** | 隨 Node.js 附帶 | 套件管理 |
| **作業系統** | Windows 10+ 64-bit（主要）/ macOS 12+（前端開發可用） | 打包腳本使用 Windows binary，後端完整功能僅 Windows |
| **Git** | 任意現代版本 | 原始碼管理 |

> **不需要**：Docker、mkcert、OpenSSL、Nginx、Redis。這些均已被原生實作取代（見 [ARCHITECTURE.md](./ARCHITECTURE.md) §3）。

---

## 九、已知限制

| 限制 | 說明 | 影響 |
|------|------|------|
| **僅支援 Windows 打包** | `livekit-server.exe`、`ffmpeg.exe`、`node.exe` 皆為 Windows x64 binary | 老師端主機必須是 Windows |
| **Firefox 缺少 Web Speech API** | Mozilla 不支援 `SpeechRecognition` API | Firefox 上 AI 語音提示功能無法使用 |
| **Safari Web Speech API** | iOS/macOS Safari 17+ 方支援，且可能需手動開啟 | 舊版 Safari 無 AI 語音提示 |
| **MediaPipe GPU delegate** | 低階 / 舊款 GPU 可能 fallback 至 CPU | 動捕效能下降，較高延遲 |
| **自簽 HTTPS 憑證** | 所有裝置第一次連線都需手動略過瀏覽器安全警告 | 無法自動信任，每個新裝置都要操作一次 |
| **單機狀態記憶體** | `RoomStore` / `RecordingStore` 為記憶體，backend 重啟後 session 遺失 | 不可水平擴展，不可跨 backend 行程共用 |
| **大屏不可跨機** | 大屏依賴 `BroadcastChannel`，只能在老師端同一瀏覽器的另一個視窗/分頁 | 大屏不能部署到另一台獨立機器 |
| **錄製期間大屏須保持開啟** | 大屏視窗關閉會中斷 canvas 錄製串流 | 錄製期間不得關閉大屏視窗 |
