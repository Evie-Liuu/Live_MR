# Live MR 系統架構文件

> 對象：技術人員（前後端工程師、架構討論、新進開發者 onboarding）
> 最後更新：2026-07-21

本文件描述 **Live MR** 的整體系統架構、模組職責與核心資料流，作為技術討論與後續開發的依據。
環境啟動、指令速查、跨裝置憑證設定請見 [`dev-setup.md`](./dev-setup.md)；錄製管線細節見 [`recording-flow.md`](./recording-flow.md)。

---

## 1. 產品概觀

Live MR 是一套**即時混合實境（MR）英語會話教學平台**。核心體驗：

- 老師（Host）與學生（Student）各自用裝置的攝影機入鏡，瀏覽器端即時做**人體 / 臉部 / 手部動作捕捉**，驅動各自的 **VRM 虛擬角色**。
- 所有角色被合成到同一個共享 3D 場景，投影在教室「**大屏（BigScreen）**」上，形成「大家一起站在虛擬服飾店裡對話」的效果。
- 老師說話時，系統用 **STT（語音轉文字）** 擷取老師的問句，呼叫 **Gemini AI** 即時生成「學生該怎麼回答」的範例句（完整句 / 重組句 / 延伸句），作為教學提示。
- 整堂課可被**錄製**（大屏畫面 + 各參與者音訊），停止後於後端用 FFmpeg 合成單一 MP4。

一句話定位：**WebRTC 多人連線 + 瀏覽器端 AI 動捕 + VRM 虛擬人 + LLM 教學輔助 + 課堂錄製**。

---

## 2. 技術棧

| 層 | 技術 |
|----|------|
| 前端框架 | React 19 + TypeScript + Vite 8 |
| 樣式 | Tailwind CSS 4、原生 CSS |
| 3D 渲染 | Three.js 0.183 + `@pixiv/three-vrm`（VRM 角色） |
| 動作捕捉 | `@mediapipe/tasks-vision`（Pose / Face / Hand Landmarker，WASM + GPU delegate） |
| 動捕求解 | Kalidokit（landmark → 骨骼旋轉）+ One-Euro filter（平滑） |
| 即時通訊 | LiveKit（`livekit-client` / `@livekit/components-react`），WebRTC |
| 後端 | Node.js + Express 5（TypeScript，ESM，`tsx` 執行） |
| 即時房間訊令 | 後端記憶體事件佇列 + HTTP long polling |
| AI | Google Gemini（`@google/genai`，多模型 fallback） |
| 錄製 | 瀏覽器 MediaRecorder（參與者音訊 + 大屏畫面）+ FFmpeg（`ffmpeg-static`，合成） |
| 反向代理 / TLS | Node 內建 `https` 模組 + `http-proxy-middleware`（`standalone.js`） |
| 基礎設施 | 可攜式原生 Windows 封裝（`bin/node-runtime`、`bin/livekit-server.exe`、`bin/ffmpeg.exe` + 打包後 backend），雙擊 `LiveMR.bat` 啟動 |
| 測試 | Vitest（前後端皆有 `*.test.ts`） |

---

## 3. 部署與執行拓撲

生產環境是**單一可攜式資料夾**，老師端解壓縮後雙擊 `LiveMR.bat` 即可啟動，不需安裝 Docker / Nginx / Redis。所有外部流量皆經 `standalone.js`（Node/Express）入口分流（相機 `getUserMedia` 需 HTTPS，由 `standalone.js` 用內建 `https` 模組終止 TLS）：

```
                       瀏覽器（老師 / 學生 / 大屏）
                              │  HTTPS / WSS  :443
                              ▼
                    ┌──────────────────────────┐
                    │  standalone.js（Node）     │  TLS 終止 + 路徑分流
                    │  serve 前端靜態檔           │
                    └──────────────────────────┘
            ┌─────────────┬──────────────────────┐
            │ /api/*      │ /livekit/*            │
            ▼             ▼                       │
   ┌────────────────┐ ┌──────────────────────┐   │
   │ 內建 Express    │ │ livekit-server.exe   │   │
   │ route（同行程）  │ │ （子行程，127.0.0.1）  │◀──┘
   └────────────────┘ └──────────────────────┘
```

| 服務 | 執行位置 | 職責 |
|------|---------|------|
| **standalone.js** | Node（`LiveMR.bat` 啟動的主行程） | HTTPS 終止（`selfsigned` 憑證）、serve 前端靜態檔、依路徑把請求轉給內建 Express route 或反代給 LiveKit |
| **內建 Express route** | 與 `standalone.js` 同行程 | REST API：房間管理、LiveKit token 核發、錄製協調、AI proxy |
| **livekit-server.exe** | 本機子行程（`backend/src/launcher` 啟動、綁定 127.0.0.1） | WebRTC SFU，處理音訊串流與 data channel；單機模式，無 Redis |

> 開發模式（`npx tsx src/standalone.ts`）與環境變數細節見 [`dev-setup.md`](./dev-setup.md)。

---

## 4. 角色與畫面流程

前端是一個**單頁、以 `AppState` 為狀態機**的應用（無 router），由 URL query 與 `sessionStorage` 決定入口。

### 4.1 進入點（`App.tsx` → `Root`）

| URL | 進入元件 | 用途 |
|-----|---------|------|
| `?screen=bigscreen` | `BigScreen` | 教室投影大屏（獨立視窗 / iframe） |
| `?screen=share` | `ShareScreen` | 螢幕分享輸出畫面 |
| `?roomId=...` | `student-join` | 學生掃 QR / 深連結加入 |
| （預設） | `select-role` | 選擇老師 / 學生 |

### 4.2 狀態機（`state.ts` 的 `AppState`）

```
select-role
   ├── (Host) ──▶ host-lobby ──▶ host-session
   └── (Student) ─▶ student-join ─▶ student-waiting ──▶ student-session
                                          ├──▶ student-rejected
                                          └──▶ error
```

- `AppState` 是 **discriminated union**（以 `screen` 欄位區分），各狀態攜帶該畫面所需欄位（`roomId` / `hostToken` / `livekitToken` / `token` / `name`…）。
- 狀態持久化於 `sessionStorage`（`live-mr-app-state`），重新整理可還原；`select-role` / `error` / `student-rejected` 會清除。
- 學生端 `?roomId=` 永遠優先，支援掃碼直接進房。

### 4.3 三種前端角色

| 角色 | 元件 | LiveKit 權限（token grant） | 看到什麼 |
|------|------|----------------------------|----------|
| **老師 Host** | `HostSession` | `canSubscribe: true`（可訂閱全部） | 收所有學生 pose、控制互動相位、AI 提示、錄製、踢人/靜音 |
| **學生 Student** | `StudentSession` | `canSubscribe: false` | 只發佈自己的 pose 與麥克風；自視角自己的 VRM |
| **大屏 BigScreen** | `BigScreen` | 不直接連 LiveKit | 透過 BroadcastChannel 收老師窗轉送的 pose，合成所有角色到共享 3D 場景 |

> 設計重點：學生彼此**不互相訂閱**（節省頻寬），共享的「大家在同一場景」畫面只在**大屏**上合成；學生裝置只渲染自己。大屏由老師端的瀏覽器透過 `BroadcastChannel` 餵資料。

---

## 5. 後端架構（`backend/src`）

Express App 組裝於 `index.ts`，所有路由掛在 `/api` 之下（`routes.ts` 的 `createRouter`）。兩個記憶體 store 為單例：`RoomStore`、`RecordingStore`。

| 模組 | 職責 |
|------|------|
| `index.ts` | 載入 `.env`、組裝 App、掛載路由、每 5 分鐘清理 TTL（2 小時）過期房間 |
| `rooms.ts` | `RoomStore`：房間 / 加入請求的記憶體狀態機（`pending`→`approved`/`rejected`），`hostToken` 驗證 |
| `routes.ts` | 所有 REST 端點 + **per-room 事件佇列 + long polling**（`/events`） |
| `livekit.ts` | `createToken()`：核發 LiveKit AccessToken（host 可訂閱、學生僅發佈） |
| `roomAdmin.ts` | `RoomAdminService`：靜音、踢人（透過 LiveKit RoomServiceClient） |
| `recording.ts` | `RecordingStore`：錄製 session 與檔案清單、merge 狀態 |
| `merge.ts` | `mergeRecording()`：等待 chunk 上傳穩定後，FFmpeg 合成 `bigscreen.webm + audio_*` → `output.mp4` |
| `ai.ts` | Gemini 封裝：`generateHint`（單句）/ `generateHints`（結構化 JSON：question/complete/extend），多模型 fallback + 逾時 + 重試判斷 |

### 5.1 主要 REST 端點

| 群組 | 端點 | 說明 |
|------|------|------|
| 房間 | `POST /rooms` | 建房，回傳 `roomId` / `hostToken` / host 的 `livekitToken` |
| 房間 | `POST /rooms/:id/join` | 學生送出加入請求 → 推 `join-request` 事件 |
| 房間 | `GET /rooms/:id/requests/:rid` | 學生輪詢自己的審核狀態 |
| 房間 | `POST .../approve` `.../reject` | 老師核准 / 拒絕；核准時核發學生 token |
| 訊令 | `GET /rooms/:id/events?since=N` | **long polling**（最長 25s），回傳增量事件 |
| 錄製 | `POST .../recording/start` `.../stop` | 起停錄製，stop 後背景觸發 merge |
| 錄製 | `POST/PATCH .../recording/bigscreen` | 大屏 webm 上傳（PATCH 為分塊串流） |
| 錄製 | `POST .../recording/audio` | host 端音訊備援上傳 |
| 錄製 | `GET .../recordings`、`.../merge`、`GET /recordings/.../:file` | 列表 / 合成進度 / 下載 |
| AI | `POST /ai/hint`、`POST /ai/hints` | Gemini proxy（金鑰只在後端） |
| 管理 | `POST .../participants/:id/remove`、`.../mute` | 老師踢人 / 靜音 |

### 5.2 即時訊令：事件佇列 + Long Polling

後端**不使用 WebSocket 做應用層訊令**，改用輕量的「記憶體佇列 + HTTP long polling」（`routes.ts`）：

- 每個房間一個 `RoomEventQueue { events, nextId, waiters }`，事件上限 100 筆。
- `notifyRoom()` 推事件並喚醒所有等待中的 long-poll request。
- `GET /events?since=N`：有新事件立即回；否則掛起最長 25 秒，逾時或連線關閉即回。
- 前端 `subscribeToRoomEvents()`（`api.ts`）以遞迴 `fetch` + 指數退避（1s→15s）持續輪詢。

> 用途：學生加入請求通知、核准 / 拒絕通知。即時媒體與 pose 資料走 LiveKit / BroadcastChannel，不走此通道。

---

## 6. 前端架構（`frontend/src`）

### 6.1 目錄職責

| 目錄 | 內容 |
|------|------|
| `components/` | 畫面元件。核心三大件：`HostSession`（~3100 行）、`BigScreen`（~2700 行）、`StudentSession`（~740 行），以及大屏編輯器、場景編輯器、學生 / 房間相關面板 |
| `hooks/` | `usePoseDetection`（動捕迴圈）、`useVrmAvatar`（單一角色渲染）、`useBigScreenScene`（共享場景）、`useSpeechRecording`（STT）、`useRecording`（錄製協調）、`useBigScreenEditor`（reducer） |
| `utils/` | `poseCodec`（二進位編解碼）、`kalidokitSolver` / `vrmPoseApplier`（landmark→骨骼）、`oneEuroFilter`（平滑）、`vrmLoader` / `propLoader` / `occluderLoader`、`threeScene`（燈光/格線共用） |
| `config/` | `scenes`（主題→場景→模組→任務階層）、`aiAssistant`（prompt / systemInstruction 組裝）、`taskHints`、`constants`（LiveKit URL、BroadcastChannel 名稱、麥克風選項）、`vrmSources` |
| `types/` | `vrm`（`PoseFrame` / `PoseLandmark` / `SceneConfig`）、`sceneOccluder` |

### 6.2 三大元件職責

- **`HostSession`** — 課堂控制中樞：建立 LiveKit `Room`、接收所有學生 pose（`DataReceived`）並透過 `BroadcastChannel` 轉送大屏、廣播「互動相位」給學生與大屏、整合 STT + AI 提示、控制錄製、踢人 / 靜音、管理場景與角色指派。
- **`BigScreen`** — 共享 3D 場景的合成與投影：從 `BroadcastChannel` 收 pose，用 `useBigScreenScene` 在單一 Three.js 場景渲染所有 VRM，疊加道具 / 遮擋物 / UI，`canvas.captureStream(30)` → `MediaRecorder` 錄製並分塊上傳。亦含大屏編輯模式（擺位 / 場景物件）。
- **`StudentSession`** — 學生端：開攝影機 → `usePoseDetection` 偵測 → `poseCodec` 編碼 → LiveKit `publishData` 發佈 pose（unreliable）+ 發佈麥克風；自視角渲染自己的 VRM；接收老師廣播的互動相位。

---

## 7. 核心資料流

### 7.1 MR 動作捕捉管線（每位入鏡者）

這是整個產品的技術核心，端到端為：

```
攝影機 video
   │  requestAnimationFrame 迴圈（節流至 ~30fps）
   ▼
MediaPipe PoseLandmarker（GPU，失敗 fallback CPU）
   ├─ FaceLandmarker（blendshapes，降頻 15/7.5fps）
   └─ HandLandmarker（雙手，與臉交錯幀）
   │
   ▼  One-Euro filter（landmark 層級去抖，minCutoff/beta 可調）
   ▼
encodePoseFrame() → 緊湊二進位（pose 400B / +world 796B / +face 6.5KB）
   │
   ├──[本機]──▶ useVrmAvatar.applyPose（自視角）
   │
   └──[網路]──▶ LiveKit publishData（unreliable）
                       │
                       ▼  老師端 DataReceived
                createPoseDecodePool().decode()（3 槽預配置，零 GC）
                       │
                       ▼  BroadcastChannel（同瀏覽器轉送大屏）
                       ▼
                useBigScreenScene：每幀
                   Kalidokit solve（landmark → 骨骼旋轉）
                   → vrmPoseApplier（套用至 VRM bones + 60fps lerp 補幀）
                   → Three.js render
```

關鍵設計：
- **二進位編碼**（`poseCodec.ts`）：自訂 wire format（首位元組為 flags），相較 JSON 省 5.7–6.6×；首位元組 `0x7B`（`{`）保留 legacy JSON 相容。
- **零配置熱路徑**：偵測端與解碼端皆用**預配置 buffer**（pose 33 / face 478 / hand 21 點），避免每幀產生物件造成 GC 卡頓。
- **平滑分兩層**：來源端 One-Euro（screen-space 與 world-space 各一組）+ 套用端 60fps lerp 補間（資料 30fps、渲染 60fps）。
- **效能模式**：`lowPowerMode` 把臉 / 手偵測降到 7.5fps。

### 7.2 大屏合成與相位同步（BroadcastChannel）

老師端與大屏在**同一瀏覽器的不同視窗 / iframe**，用 `BroadcastChannel`（名稱 `live-mr-bigscreen`，見 `constants.ts`）通訊：

- 老師端 → 大屏：即時 pose 幀、互動相位（edit-mode / 開始互動）、錄製起停訊號、完整狀態補送（iframe 有獨立 sessionStorage）。
- 大屏 → 老師端：場景沉澱完成（settlement-done）等回報。
- 互動相位同時透過 LiveKit `publishData(reliable)` 廣播給學生端（可指定 `destinationIdentities` 限定接收者）。

### 7.3 AI 教學提示流

```
老師說話 → useSpeechRecording（Web Speech API STT，en-US，連續辨識 + 自動重啟）
   │  stop(onFinal) 以「事件」帶回最終 transcript（修復空語音卡死）
   ▼
HostSession 組 prompt + systemInstruction（aiAssistant.ts）
   │  注入場景限制（SCENE_CONSTRAINTS）+ 當前任務脈絡（HintTaskContext）
   ▼
POST /api/ai/hints（多輪 history）
   ▼  backend ai.ts → Gemini（gemini-2.5-flash → flash-lite → 2.0 fallback）
   │  responseSchema 強制 JSON：{ question, complete, extend }
   ▼
HostSession 取得三欄位
   ├─ question：從老師長獨白抽取出「真正問學生的那一句」
   ├─ complete：學生可直接朗讀的完整回答
   ├─ rearrange：complete 經 shuffleWords() 在前端打散（重組練習，非 AI 產生）
   └─ extend：可接在 complete 後的延伸句
```

設計重點：
- **問句抽取**：老師常是一長串獨白（問候 + 指令 + 提問混雜），systemInstruction 要求模型「先默想、抽出唯一一句對學生的提問」，涵蓋多種題型（Yes/No、Wh-、選擇、經驗、未來、偏好、意見、祈使邀請）。
- **抽取低溫**：`generateHints` 用 `temperature: 0.3` + thinking budget（2.5 系列）以提升抽句命中率；單句 `generateHint` 用 `temperature: 0.6`。
- **AI 金鑰只在後端**：前端永不持有 `GEMINI_API_KEY`，一律經 `/api/ai/*` proxy。
- **任務導向**：`HintTaskContext` 讓 AI 把回答導向當前練習任務與學生扮演的角色，但允許自然帶到下一任務；離題的日常問題則自然回答、不硬拉回任務。

### 7.4 錄製管線（雙軌 + 合成）

詳見 [`recording-flow.md`](./recording-flow.md)，摘要：

```
start ─┬─ 每位參與者（老師+學生）瀏覽器端 MediaRecorder → audio_{id}.webm
       └─ BigScreen canvas.captureStream → bigscreen.webm（分塊 PATCH 上傳）
stop ──┴─ 背景 mergeRecording()：等檔案大小穩定 → FFmpeg amix → output.mp4
```

- **已知限制**：`RecordingStore` 為記憶體，backend 重啟後 session 遺失（檔案仍在磁碟，但查不到 basePath → 下載 404）；大屏視窗需保持開啟直到停止錄製。

---

## 8. 教學內容階層（`config/scenes.ts`）

教學內容以四層階層組織，**編輯只需改 `THEMES`**，`SCENE_PRESETS`（給 Three.js 用的扁平 map）由其自動衍生：

```
Theme（主題，如「服飾店」）
  └── Scene（場景，如「收銀台」）
        ├── slots（角色站位 + 預設 VRM + 旋轉）
        ├── allowedVrmIds（此場景可選的角色模型）
        └── Module（教學功能層，如 Price）
              └── TaskItem（實際任務，如「Ask for the price of a blue T-shirt」）
```

場景同時帶相機 / 燈光 preset（`SceneConfig`），供 `useVrmAvatar` 與大屏渲染共用。

---

## 9. 外部相依與設定

| 相依 | 用途 | 設定來源 |
|------|------|---------|
| LiveKit（core） | WebRTC 媒體 / data channel | `LIVEKIT_API_KEY` / `_SECRET` / `_URL`（內外網不同，見 dev-setup） |
| Google Gemini | AI 教學提示 | `GEMINI_API_KEY`、`GEMINI_MODEL`（逗號分隔的 fallback 清單） |
| Web Speech API | 瀏覽器端 STT | 僅 Chrome 等支援；不支援時 `useSpeechRecording` 降級為 no-op |
| MediaPipe 模型 | 本機動捕（heavy pose / face / hand `.task`） | 前端 `public/mediapipe-models`、WASM `public/mediapipe-wasm` |
| VRM 模型 | 角色外觀 | `assets/models/role_static/*.vrm` + `config/vrmSources.ts` |
| Node `selfsigned` 套件 | 本機/區網開發環境下之 HTTPS 憑證自動化產生（`backend/src/launcher/certs.ts`），取代 mkcert/openssl | `data/certs/`（相機 API 必需） |

---

## 10. 已知技術債與重構規劃

- **巨型元件**：`HostSession`（~3100 行）與 `BigScreen`（~2700 行）職責過重，是後續維護重點。
- **架構重構規劃書**：`docs/superpowers/plans/2026-03-25-architecture-refactor.md`（共 5 個 Task）已規劃：抽取共享常數、抽 Three.js 共用工具、解耦 `usePoseDetection` 與 LiveKit（改 `onPublish` callback，已完成）、拆解 `HostSession`（抽 `LocalVideo`）、修 `any` 型別 / 死碼 / 大屏 canvas 尺寸。
- **記憶體狀態**：`RoomStore` / `RecordingStore` 皆為單機記憶體，無持久化、不可水平擴展（目前為單機教室場景）。
- **封裝細節**：`docs/superpowers/specs/2026-07-17-local-only-packaging-design.md` 與 `docs/superpowers/plans/2026-07-20-native-launcher-packaging.md`。

---

## 附錄：關鍵檔案速查

| 主題 | 檔案 |
|------|------|
| 前端進入 / 狀態機 | `frontend/src/App.tsx`、`state.ts` |
| 課堂控制中樞 | `frontend/src/components/HostSession.tsx` |
| 共享大屏 | `frontend/src/components/BigScreen.tsx`、`hooks/useBigScreenScene.ts` |
| 學生端 | `frontend/src/components/StudentSession.tsx` |
| 動捕迴圈 | `frontend/src/hooks/usePoseDetection.ts` |
| Pose 編解碼 | `frontend/src/utils/poseCodec.ts` |
| VRM 骨骼套用 | `frontend/src/utils/kalidokitSolver.ts`、`vrmPoseApplier.ts` |
| AI prompt 組裝 | `frontend/src/config/aiAssistant.ts` |
| 後端入口 / 路由 | `backend/src/index.ts`、`routes.ts` |
| LiveKit token / 房間管理 | `backend/src/livekit.ts`、`roomAdmin.ts` |
| AI proxy | `backend/src/ai.ts` |
| 錄製 / 合成 | `backend/src/recording.ts`、`merge.ts` |
| 教學內容 | `frontend/src/config/scenes.ts` |
| 部署 | `backend/src/launcher/`、`backend/src/standalone.ts`、`scripts/build-launcher.mjs` |
