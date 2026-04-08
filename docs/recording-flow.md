# 錄製流程說明

## 概覽

本系統採用雙軌錄製架構：
- **大屏畫面**（bigscreen.webm）：BigScreen 視窗的 Canvas 由瀏覽器端 MediaRecorder 錄製，停止後上傳至 backend
- **參與者音訊**（audio_*.ogg）：LiveKit Egress server-side 逐人錄製
- **Host 音訊**（audio_*.webm）：Host 瀏覽器端 MediaRecorder 輔助錄製，停止後上傳

---

## 檔案儲存路徑

所有錄製檔案統一存放於：

```
./recordings/{sceneId}/{participantName}_{YYYYMMdd-HHmmss}/
  bigscreen.webm          ← 大屏 canvas 畫面（BigScreen 視窗上傳）
  audio_{identity}.ogg    ← 每位參與者音訊（LiveKit Egress，server-side）
  audio_{identity}.webm   ← 每位參與者音訊（Host 端 MediaRecorder，client-side）
```

- `sceneId`：場景 ID（特殊字元替換為 `_`）
- `participantName`：發起錄製的 Host 名稱（特殊字元替換為 `_`）
- 時間戳格式：`YYYYMMdd-HHmmss`（以 backend 本地時間為準）

---

## 完整流程

### 開始錄製

```
Host 點擊「開始錄製」
│
▼
POST /api/rooms/:roomId/recording/start
  body: { sceneId, participantName }
│
├─ 產生 sessionId (UUID)
├─ 計算 basePath = /recordings/{sceneId}/{participantName}_{timestamp}
├─ EgressService.startRecording(roomId, basePath)
│     └─ 對每位有麥克風 track 的參與者：
│           startTrackCompositeEgress → LiveKit Egress
│           存檔：{basePath}/audio_{identity}.ogg
└─ RecordingStore.startSession(...)
      回傳 { sessionId, status: 'recording' }
│
▼ useRecording.start()
├─ 啟動 Host 本地 MediaRecorder（audio/webm;codecs=opus）
└─ BroadcastChannel 發送 { type: 'recording-start', sessionId }
      │
      ▼ BigScreen.tsx 接收
      ├─ canvas.captureStream(30fps)
      └─ 啟動 MediaRecorder（video/webm;codecs=vp9）
             每 1 秒 ondataavailable → 累積 chunks
```

### 停止錄製

```
Host 點擊「停止錄製」
│
▼
POST /api/rooms/:roomId/recording/stop
├─ EgressService.stopRecording()   → 停止所有 Egress job
└─ RecordingStore.stopSession()    → 標記 'stopped'，產生預期 files 清單
│
▼ useRecording.stop()
├─ BroadcastChannel 發送 { type: 'recording-stop' }
│     │
│     ▼ BigScreen.tsx 接收
│     ├─ mr.stop()
│     └─ onstop → Blob 合併 → POST /api/rooms/:roomId/recording/bigscreen
│                              Header: X-Session-Id, Content-Type: video/webm
│                              存檔：{basePath}/bigscreen.webm
│
└─ Host MediaRecorder.stop()
      └─ onstop → Blob 合併 → POST /api/rooms/:roomId/recording/audio
                               Header: X-Session-Id, X-Participant-Identity
                               存檔：{basePath}/audio_{identity}.webm
```

---

## API 端點

| 方法 | 路徑 | 說明 |
|------|------|------|
| POST | `/api/rooms/:roomId/recording/start` | 開始錄製，回傳 sessionId |
| POST | `/api/rooms/:roomId/recording/stop` | 停止錄製 |
| GET  | `/api/rooms/:roomId/recordings` | 列出所有 session |
| POST | `/api/rooms/:roomId/recording/bigscreen` | 上傳大屏 webm（Header: X-Session-Id） |
| POST | `/api/rooms/:roomId/recording/audio` | 上傳參與者音訊（Header: X-Session-Id, X-Participant-Identity） |
| GET  | `/api/recordings/:roomId/:sessionId/:filename` | 下載錄製檔案 |
| POST | `/api/rooms/:roomId/participants/:identity/mute` | 靜音參與者 |

---

## Docker Volume 配置

```yaml
livekit-egress:
  volumes:
    - ./recordings:/recordings   # Egress 存放 .ogg 至此

backend:
  volumes:
    - ./recordings:/recordings   # Backend 存放 bigscreen.webm / audio.webm 至此
```

兩個容器共用 host 上同一個 `./recordings` 目錄，所有檔案統一可見。

---

## 關鍵程式碼位置

| 功能 | 檔案 | 說明 |
|------|------|------|
| Egress 管理 | `backend/src/egress.ts` | LiveKit EgressClient，startRecording 接受 basePath |
| Session 管理 | `backend/src/recording.ts` | RecordingStore，含 getSessionById() |
| API 路由 | `backend/src/routes.ts:174-` | 所有錄製相關端點 |
| 大屏錄製 | `frontend/src/components/BigScreen.tsx:326-379` | Canvas MediaRecorder + 上傳 |
| Host 錄製 hook | `frontend/src/hooks/useRecording.ts` | 音訊錄製 + BroadcastChannel 協調 |
| 前端 API | `frontend/src/api.ts:114-` | startRecording / stopRecording / getRecordings |

---

## 注意事項

### 大屏視窗必須保持開啟
bigscreen.webm 由 BigScreen 視窗（獨立 tab）自行錄製並上傳。若視窗在停止錄製前被關閉，錄製中斷。重新開啟視窗會嘗試從 API 恢復 active session（`BigScreen.tsx:137-165`），但已累積的 chunks 會遺失。

### 音訊雙軌
- `.ogg`：LiveKit Egress server-side，品質穩定，但需要 Egress 服務正常運作
- `.webm`：瀏覽器端 MediaRecorder，作為備援。兩個檔案 `stopSession()` 的 files 清單均會列出，但不保證都存在

### 大小限制
- bigscreen.webm 上傳：nginx `client_max_body_size 300m`，routes.ts 亦設 300mb
- audio.webm 上傳：100mb
- 建議單次錄製不超過 10 分鐘

### Session 存活
RecordingStore 為 in-memory，backend 重啟後 session 遺失，下載端點將回傳 404（檔案仍在磁碟，但 session 查不到 basePath）。
