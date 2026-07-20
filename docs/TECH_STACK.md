# Live_MR 專案技術棧整理

本文件將 **Live_MR** 專案的實際開發技術，依照「前端層」、「後端應用層」、「資料與快取層」、「基礎設施與部署層」之結構進行整理。

---

## 1. 前端層 (Frontend / Client-Side)

負責使用者介面互動，透過 API與 WebRTC / BroadcastChannel 與後端及共享大屏溝通。

* **核心框架**: [React 19](https://react.dev) (SPA 單頁應用程式架構，以 [AppState](file:///C:/Project/Live_MR/frontend/src/state.ts) 作為狀態機)
* **建置工具**: Vite 8 (提供快速開發與優化構建)
* **執行環境**: [Node.js](https://nodejs.org) (用於開發與建置環境，建議版本 v22+)
* **通訊協定**:
  * **Fetch API / Long Polling**: 處理 HTTP RESTful API 請求，並透過長輪詢（Long Polling）實現增量事件接收（如學生加入審核）。
  * **LiveKit Client SDK** ([`livekit-client`](https://github.com/livekit/client-sdk-js) / [`@livekit/components-react`](https://github.com/livekit/components-react)): 處理 WebRTC 即時音訊，並透過 Data Channel（非可靠傳輸模式）傳遞高頻率的動作捕捉資料（Pose）。
  * **BroadcastChannel**: 用於同瀏覽器不同分頁/視窗（老師控制端 [HostSession](file:///C:/Project/Live_MR/frontend/src/components/HostSession.tsx) 與共享大屏 [BigScreen](file:///C:/Project/Live_MR/frontend/src/components/BigScreen.tsx)）之間的角色 Pose 與控制訊號即時同步。
* **其他庫與關鍵技術**:
  * **Three.js & `@pixiv/three-vrm`**: 用於 3D 場景渲染與 3D 虛擬角色（VRM）載入、姿態平滑補間（60fps Lerp）與骨骼旋轉套用。
  * **`@mediapipe/tasks-vision`**: 提供本機端人體、手部及臉部的 AI 動作捕捉（WASM + GPU delegate）。
  * **Kalidokit**: 用於動作捕捉 Landmark 轉骨骼旋轉的求解器（Solver）。
  * **One-Euro Filter**: 用於 Landmark 訊號去抖與平滑濾波。
  * **Tailwind CSS 4 & 原生 CSS**: 處理 UI 介面與響應式排版。
  * **Web Speech API**: 處理瀏覽器端連續語音轉文字（STT），提供 AI 提示生成的語音輸入來源。

---

## 2. 後端應用層 (Backend / Application Layer)

負責業務邏輯、資料處理、AI 代理與即時房間訊號協調。

* **程式語言 / 執行環境**: Node.js (TypeScript, ESM 模組系統，開發環境使用 `tsx watch` 執行)
* **Web 框架**: Express 5 (提供 RESTful API，模組化路由組裝於 [routes.ts](file:///C:/Project/Live_MR/backend/src/routes.ts))
* **即時通訊與房間訊令**:
  * **HTTP Long Polling + 記憶體事件佇列**: 後端在記憶體中維護輕量級事件佇列，搭配 Long Polling 實現輕量級的房間管理、審核與即時事件通知。
  * **LiveKit Server SDK** (`livekit-server-sdk`): 負責核發 WebRTC AccessToken、管理房間連線狀態，並透過 SDK 進行踢人、靜音等控制。
* **AI 整合服務**: Google Gemini SDK (`@google/genai`)，提供教學提示與提問句抽取服務，整合於 [backend/src/ai.ts](file:///C:/Project/Live_MR/backend/src/ai.ts)（具備多模型 fallback 與自動重試機制）。
* **媒體與錄製處理**:
  * **瀏覽器端 MediaRecorder**: 每位參與者（老師 + 學生）各自錄製自己的麥克風音軌，停止後上傳至後端。
  * **FFmpeg** (`ffmpeg-static`): 用於後端將大屏錄製的 WebM 影片與各使用者的音軌進行混音（amix）合成，產出最終的 MP4 課堂錄影檔。

---

## 3. 資料與快取層 (Data & Caching Layer)

負責持久化儲存、狀態快取與檔案管理。

* **狀態管理與暫存 (In-Memory Storage)**:
  * **記憶體內單例 Store**: 包含 `RoomStore` 與 `RecordingStore`，用於在記憶體中維護活躍的房間狀態、加入請求、即時事件佇列與錄製會話。
  * **前端 SessionStorage**: 儲存 `live-mr-app-state`，用於還原與持久化前端 App 的 discriminated union 狀態機。
* **訊息佇列與快取 (Message Queue & Cache)**:
  * **Redis**: 作為 LiveKit Core 的狀態後端，處理多 Worker 的協調與狀態持久化。
* **本地檔案儲存**:
  * **檔案系統 (FileSystem)**: `./recordings` 目錄，用以儲存及讀取分塊 WebM、各參與者音訊 webm 以及最終合成的 MP4 檔案。

---

## 4. 基礎設施與部署層 (Infrastructure & DevOps)

負責伺服器運行、反向代理、憑證管理、開發隧道與安全性。

* **容器化技術**: Docker & Docker Compose (編排 Nginx、LiveKit Core、Redis、Backend 與 Frontend 服務，詳見 [docker-compose.yml](file:///C:/Project/Live_MR/docker-compose.yml))。
* **Web 伺服器 / 反向代理**: Nginx
  * 負責 **SSL/TLS 終端 (HTTPS/WSS)**，為瀏覽器端調用相機 API (`getUserMedia`) 提供必要的安全連線。
  * 負責**流量分流** (將 `/api/` 導向 Express 後端，`/livekit/` 導向 LiveKit，其他靜態資源導向前端 Vite/靜態伺服器)。
* **憑證、外部曝露與版本控制 (Certificates, Tunneling & VCS)**:
  * **mkcert**: 本地/區網開發環境下之 HTTPS 憑證自動化生成與根憑證信任管理（儲存於 `certs/`）。
  * **OpenSSL**: 用於 [setup.ps1](file:///C:/Project/Live_MR/setup.ps1) 腳本中，為本地開發環境之 IP 位址（包含 Subject Alternative Name）生成自簽 SSL/TLS 憑證。
  * **Cloudflare Tunnel (cloudflared)**: 用於 [start-tunnel.ps1](file:///C:/Project/Live_MR/start-tunnel.ps1) 腳本中，將本機開發服務透過免費臨時隧道（`trycloudflare.com`）公開至外網，並在每次連線時自動重載 `.env` 變數與重啟前端容器以套用新網域。
  * **Git**: 專案的版本控制系統，其在 Windows 環境下的安裝目錄亦作為 [setup.ps1](file:///C:/Project/Live_MR/setup.ps1) 與 [start-tunnel.ps1](file:///C:/Project/Live_MR/start-tunnel.ps1) 尋找 `openssl.exe`（位於 Git 安裝路徑之 `usr/bin/`）的備援來源。
* **安全性與授權 (Security & Auth)**:
  * **JWT / LiveKit AccessToken**: 用於 API 授權與 WebRTC 連線驗證，保護敏感的金鑰（如 `GEMINI_API_KEY`）不外流至前端。
* **行程管理 (Process Management)**: Docker Compose 自動管理服務重啟與運行狀態。
* **測試框架**: Vitest (前端與後端皆撰寫 `*.test.ts` 單元/整合測試)。

