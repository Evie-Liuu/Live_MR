# 錄製 & 麥克風/鏡頭控制 設計文件

> 日期：2026-04-01
> 專案：Live_MR
> 狀態：設計完成

---

## 一、需求摘要

| 功能 | 說明 |
|------|------|
| **大屏影像+聲音錄製** | Host 控制開始/停止整堂課錄製 |
| **音訊軌道分離** | 每位參與者的音頻獨立儲存，供後續口語評分使用 |
| **Host 強制控制** | Host 可強制 mute/unmute 每個學生的麥克風與鏡頭 |
| **跨裝置音視頻對齊** | Egress 統一管理時間軸，確保合成影片與分軌音訊對齊 |
| **影片複習（未來）** | 錄製完後可回放課堂影片 |

---

## 二、技術選型

| 決策點 | 選擇 | 理由 |
|--------|------|------|
| 錄製方式 | **LiveKit Egress（伺服器端）** | 時間戳由伺服器保證、天然支援分軌、不依賴瀏覽器 |
| 儲存位置 | **本地 Docker Volume** (`./recordings`) | 開發/內網環境，簡單直接；未來改成 S3 只需改 Egress 設定 |
| Mic/Cam 控制 | **LiveKit Admin API 強制控制** | 使用 `RoomServiceClient.mutePublishedTrack()`，Host 權限強制執行 |
| 後端 SDK | `livekit-server-sdk v2.13.1`（已安裝） | 已包含 EgressClient 與 RoomServiceClient |
| 前端狀態管理 | **`useRecording` custom hook** | 避免 HostSession 繼續膨脹，邏輯集中可測 |

---

## 三、整體架構

```
┌─────────────────────────────────────────────────────────────┐
│                   Docker Compose 服務群                      │
│                                                             │
│  ┌──────────┐    ┌────────────────┐    ┌─────────────────┐  │
│  │ livekit  │◄───│ livekit-egress │───►│  ./recordings/  │  │
│  │  :7880   │    │   (新增服務)   │    │  (本地 volume)  │  │
│  └────┬─────┘    └────────────────┘    └─────────────────┘  │
│       │ RTC WebSocket                                       │
│  ┌────▼─────┐    ┌────────────────────────────────────────┐ │
│  │ backend  │    │         新增 REST API                   │ │
│  │  :3001   │◄───│  POST   /api/rooms/:id/recording/start  │ │
│  │          │    │  POST   /api/rooms/:id/recording/stop   │ │
│  │          │    │  GET    /api/rooms/:id/recordings       │ │
│  │          │    │  POST   /api/participants/:id/mute      │ │
│  └──────────┘    └────────────────────────────────────────┘ │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           前端 HostSession 控制台                     │   │
│  │  [● 錄製中] [⏹ 停止錄製]  ← RecordingPanel (header) │   │
│  │  StudentTile: [🎤 ON/OFF] [📷 ON/OFF] 疊加左下角     │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 四、錄製策略（雙軌並行）

```
開始錄製
   │
   ├─► 合成錄製 (Room Composite Egress)
   │       └── /recordings/{roomId}/{sessionId}/composite.mp4
   │           用途：影片複習、完整課堂回放
   │
   └─► 分軌錄製 (Track Composite Egress × N participants)
           └── /recordings/{roomId}/{sessionId}/audio_{identity}.ogg
               用途：口語評分、個人語音分析
```

- 兩種 Egress **同時啟動**，由 LiveKit server 統一時間軸
- 分軌錄製只抓 **Audio Track**（節省空間，用於評分）
- 合成錄製抓 Audio + Video（用於課堂複習）

---

## 五、目錄結構變更

```
Live_MR/
├── docker-compose.yml          ← 新增 egress 服務、recordings volume
├── livekit.yaml                ← 新增 egress 相關設定
├── recordings/                 ← 新增 (gitignored)，錄製輸出
│   └── {roomId}/
│       └── {sessionId}/
│           ├── composite.mp4
│           └── audio_{identity}.ogg
├── backend/src/
│   ├── egress.ts               ← 新增：EgressClient 封裝
│   ├── recording.ts            ← 新增：錄製 session 管理（記憶體）
│   └── routes.ts               ← 擴充：錄製 & mute API endpoints
└── frontend/src/
    ├── hooks/
    │   └── useRecording.ts     ← 新增：錄製 & mute 狀態管理 hook
    ├── components/
    │   ├── HostSession.tsx     ← 最小修改：呼叫 hook，傳 props
    │   ├── RecordingPanel.tsx  ← 新增：錄製控制面板元件
    │   └── StudentTile.tsx     ← 擴充：疊加 🎤/📷 控制按鈕
    └── api.ts                  ← 擴充：錄製 API 呼叫函式
```

---

## 六、資料流 & API 設計

### 6.1 錄製生命週期

```
Host 點擊「開始錄製」
    │
    ▼
POST /api/rooms/:roomId/recording/start
    │
    ├─ backend 呼叫 EgressClient.startRoomCompositeEgress()
    │       → 輸出 composite.mp4 到 /recordings/{roomId}/{sessionId}/
    │
    ├─ backend 呼叫 RoomServiceClient.listParticipants(roomId)
    │       → 取得所有人的 audioTrackSid
    │
    ├─ 對每個 participant，呼叫：
    │   EgressClient.startTrackEgress(audioTrackSid)
    │       → 輸出 audio_{identity}.ogg 到同一 sessionId 目錄
    │
    └─ 回傳 { sessionId, status: 'recording' }

Host 點擊「停止錄製」
    │
    ▼
POST /api/rooms/:roomId/recording/stop
    │
    ├─ backend 呼叫 EgressClient.stopEgress(compositeEgressId)
    ├─ 對每個分軌 egressId，呼叫 EgressClient.stopEgress(trackEgressId)
    └─ 回傳 { sessionId, status: 'stopped', files: [...] }
```

### 6.2 REST API 規格

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| `POST` | `/api/rooms/:roomId/recording/start` | — | `{ sessionId, egressIds[], status }` |
| `POST` | `/api/rooms/:roomId/recording/stop` | — | `{ sessionId, status, files[] }` |
| `GET` | `/api/rooms/:roomId/recordings` | — | `{ recordings: [{ sessionId, files[], createdAt, status }] }` |
| `POST` | `/api/rooms/:roomId/participants/:identity/mute` | `{ trackType: 'audio'\|'video', muted: boolean }` | `{ success }` |

### 6.3 麥克風/鏡頭控制流程

```
Host 點擊學生 [🎤 OFF]
    │
    ▼
POST /api/rooms/:roomId/participants/:identity/mute
    { trackType: 'audio', muted: true }
    │
    ▼
backend 呼叫 RoomServiceClient.mutePublishedTrack(
    roomId, identity, trackSid, muted
)
    │
    ├─ LiveKit server 強制靜音（不需學生配合）
    ├─ 前端透過 RoomEvent.TrackMuted 感知狀態變化
    └─ useRecording.muteState 更新，StudentTile 圖示同步
```

### 6.4 後端記憶體狀態結構

```ts
type RecordingSession = {
  sessionId: string                           // uuid
  compositeEgressId: string
  trackEgressIds: Record<string, string>      // identity → egressId
  status: 'recording' | 'stopped'
  startedAt: number
  files: string[]                             // 停止後填入
}
// Map<roomId, RecordingSession>
```

---

## 七、前端 UI 設計

### 7.1 RecordingPanel — 嵌入 session-header

錄製中狀態：
```
● 錄製中  [⏹ 停止錄製]
```

未錄製狀態：
```
[▶ 開始錄製]
```

- `●` 為紅色閃爍動畫，明確提示錄製中
- 按鈕在 API 呼叫期間顯示 loading 狀態，防止重複點擊

### 7.2 StudentTile — 疊加 🎤/📷 控制按鈕

位置：左下角疊加層

```
┌──────────────────────┐
│  [學生影像 / Avatar]  │
│                      │
│  [🎤] [📷]           │  ← 左下角，半透明背景
└──────────────────────┘
```

- 按鈕圖示：已開啟為亮色，靜音/關閉為暗色帶斜線
- 只有傳入 `onToggleMute` prop 時才顯示（Host 才有此 prop）
- 點擊立即觸發 `useRecording.toggleMute(identity, trackType)`

### 7.3 useRecording hook 介面

```ts
function useRecording(roomId: string, room: Room | null): {
  isRecording: boolean
  sessionId: string | null
  start: () => Promise<void>
  stop: () => Promise<void>
  muteState: Record<string, { audio: boolean; video: boolean }>
  toggleMute: (identity: string, trackType: 'audio' | 'video') => Promise<void>
}
```

初始化時呼叫 `GET /recordings` 恢復 `isRecording` 狀態（處理 Host 重連情境）。  
LiveKit `RoomEvent.TrackMuted / TrackUnmuted` 更新 `muteState`，保持 UI 與 LiveKit 狀態同步。

---

## 八、實作階段規劃

| 階段 | 工作項目 |
|------|----------|
| **Phase 1** | docker-compose 加入 egress 服務 + livekit.yaml 設定 |
| **Phase 2** | 後端 `egress.ts` + `recording.ts` + routes 擴充 |
| **Phase 3** | 後端 mute API（`RoomServiceClient`） |
| **Phase 4** | 前端 `useRecording.ts` hook |
| **Phase 5** | 前端 `RecordingPanel.tsx` + `StudentTile.tsx` 擴充 |
| **Phase 6** | `HostSession.tsx` 整合（最小修改） |
| **Phase 7** | 測試：錄製啟動/停止、分軌確認、強制 mute 驗證、重連恢復 |

---

## 九、風險與注意事項

| 風險 | 緩解方式 |
|------|----------|
| Egress 容器需要額外記憶體 (1-2 GB) | 監控 Docker stats，必要時調整 Egress 並行數 |
| 分軌錄製需知道每個 participant 的 trackSid | 透過 `RoomServiceClient.listParticipants()` 取得 |
| 本地 recordings/ 磁碟空間管理 | 未來加入自動清理機制 (TTL) |
| 學生未開麥克風時分軌為空 | 錄製前確認軌道狀態，UI 提示 |
| Host 重連後記憶體狀態遺失 | `GET /recordings` 回傳含 `status: 'recording'` 的 session 供前端恢復 |
