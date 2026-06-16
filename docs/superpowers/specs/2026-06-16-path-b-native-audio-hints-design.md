# Path B 原生多模態 AI 提示 — 最小原型設計

> 日期：2026-06-16
> 狀態：設計已核可，待寫實作計畫

## 背景與動機

現況 AI 助理流程：老師語音 → Web Speech API（瀏覽器端 STT）轉文字 → `POST /api/ai/hints` → Gemini 生成 `{question, complete, extend}`。

Phase 0 對照（`backend/scripts/phase0-spike.mts`）與後續實測證明：**Web Speech 引擎本身是品質瓶頸**。即使透過 VB-CABLE 餵入乾淨數位音訊，Web Speech 仍把真實教室錄音（多人、噪音、台式口音）辨識成嚴重走音的逐字稿（如 "Friday I love you too angel… 20 minutes"），而同一段音訊直接給 Gemini 則得到可用結果。Web Speech API 是黑盒，無法餵乾淨音訊到辨識器、無法關閉 Chrome 的 getUserMedia DSP、無法自訂詞彙——調整空間已到頂。

結論：要突破品質天花板，必須換引擎 → 讓 Gemini 直接「聽」音訊（原生多模態，Path B）。

## 目標與範圍

**目標**：老師每輪語音 → 該輪音訊直接送 Gemini 生成 hints，繞過 Web Speech 文字瓶頸；音訊路徑失敗時自動回退現況文字流；開發階段顯示 Gemini 自己的轉譯文字。

**明確不做（YAGNI）**：
- 不另開 multipart 端點（base64 JSON 足夠短輪次音訊）。
- 不把音訊放進多輪 history（history 仍為文字，只有「當前輪」是音訊）。
- 不加 UI 模式切換鈕。
- 不做文字/音訊並列比對。

## Turn 流程

```
現況:
  startRec(Web Speech) → 老師講 → stopRec(finish) → finish(transcript)
    → handleHint(mode, transcript) → generateHints(text) → POST /ai/hints (text)

新:
  turn 開始: startRec(Web Speech, 背景備援) + 開始錄該輪音訊 (MediaRecorder)
  turn 結束: stopRec + 停止錄音 → 取得 audioBlob + Web Speech final transcript
    ├─ 主路徑: generateHints({ audio: blob, ... })
    │            → POST /ai/hints (audio)
    │            → { question, complete, extend, transcript, model }
    └─ 回退: 音訊路徑失敗時 → generateHints(webSpeechTranscript) 走現況文字流
  顯示: dev hint card 顯示回傳的 transcript (Gemini);
        question / complete / extend / rearrange 行為不變
```

## 觸及的元件

| # | 檔案 | 改動 |
|---|------|------|
| 1 | `backend/src/ai.ts` `generateHints` | 接受可選音訊輸入；有音訊時 contents 以 `inlineData` part（當前輪）+ 文字 history 組裝；responseSchema 加 `transcript` 欄。文字路徑與既有行為不變 |
| 2 | `backend/src/routes.ts` `POST /ai/hints` | body 接受可選 `audio: { data: base64, mimeType }`；驗證 shape；轉交 generateHints；放寬 express.json body limit |
| 3 | `frontend/src/utils/geminiClient.ts` | `generateHints` 加可選 audio 參數，放進 POST body；`HintsResult` 型別加 `transcript?: string` |
| 4 | `frontend/src/hooks/useTurnAudioRecorder.ts`（新） | 對 LiveKit local mic track 開 MediaRecorder，提供 start/stop，回傳該輪 Blob |
| 5 | `frontend/src/components/HostSession.tsx` | turn 起停接上音訊錄製；stop 後嘗試音訊主路徑、失敗回退文字；dev 顯示 `transcript` |

## 各元件設計

### §1 後端 `generateHints`（ai.ts）
- 介面擴充：`GenerateHintOptions` 或函式參數加可選 `audio?: { data: string /* base64 */; mimeType: string }`。
- contents 組裝：
  - 無音訊（現況）：維持文字 contents（string 或 history+prompt 陣列）。
  - 有音訊：當前輪 user turn 改為 `{ role: 'user', parts: [{ inlineData: { mimeType, data } }] }`；history 仍為先前各輪的文字 parts。
- responseSchema：properties 加 `transcript: { type: 'STRING' }`，加入 required。
- 回傳型別 `HintsResult` 加 `transcript: string`（文字模式回空字串）。
- 既有多模型 fallback、60s timeout、isRetryable 邏輯沿用，音訊與文字共用。

### §2 後端路由（routes.ts）
- `POST /ai/hints` body 解析加可選 `audio`。驗證：`audio` 存在時須 `typeof audio.data === 'string'` 且 `typeof audio.mimeType === 'string'`。**驗證不過則忽略 `audio`、退為文字模式**（不回 400），以利前端無感回退。
- 放寬 `express.json({ limit })`：音訊 base64 約數十～數百 KB，設 `25mb` 提供寬裕餘量。注意此 limit 套用範圍避免影響其他路由（必要時對此路由單獨掛 json parser）。
- 將 audio 透傳給 `generateAIHints`。

### §3 前端 client（geminiClient.ts）
- `generateHints(text, opts)` 的 opts 加可選 `audio?: { data: string; mimeType: string }`；有音訊時 POST body 帶 `audio`。**音訊模式不送 Web Speech 文字當 prompt**（避免把走音文字混入），當前輪一律以音訊為準；history 仍為先前輪次的文字。
- `HintsResult` 加 `transcript?: string`。

### §4 音訊擷取（useTurnAudioRecorder.ts）
- 來源：`room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack`（與 HostSession 既有 camera track 取法同 pattern，約 L1607-1610）→ `new MediaStream([track])` → `MediaRecorder`。
- API：`start()`、`stop(): Promise<Blob | null>`、`supported`。收集 `ondataavailable` chunks，stop 後合併成 Blob。
- 容器格式：優先 `audio/ogg;codecs=opus`（Gemini 支援的容器），`MediaRecorder.isTypeSupported` 為否時退 `audio/webm;codecs=opus`（見技術風險）。
- 邊界：mic track 不存在 / 未發佈 → `start()` no-op，`stop()` 回 `null`（觸發文字回退）。

### §5 systemInstruction 分模式（aiAssistant.ts）
現有 `buildHintsSystemInstruction` 內含一段針對「STT 文字輸入」的容錯重建敘述，對音訊模式不適用。
- 加參數 `inputMode: 'text' | 'audio'`（預設 `'text'` 維持向後相容）。
- `text`：維持現況（STT 容錯重建段）。
- `audio`：換成「你會收到老師語音音訊，先忠實轉寫進 `transcript` 欄，再據此抽出對學生的問句…」，並在輸出欄位清單加上 `transcript`（忠實轉錄）。
- 兩模式共用後半段（問句題型、強制作答不拒答、JSON 輸出格式）。
- `question` 欄位語意不變（乾淨英文問句）；`transcript` 為音訊模式的忠實轉錄。

### §6 HostSession 串接
- turn 開始（現有 `startRec` 路徑）同時呼叫音訊 recorder `start()`。
- turn 結束（`stopRec(finish)` 路徑）：先 `stop()` 取 Blob，再走：
  - Blob 有效 → `generateHints` 帶 audio。成功 → 用回傳 `transcript` 顯示。
  - Blob 為 null / 音訊呼叫失敗 → 用 `finish` 帶回的 Web Speech transcript 走現況 `handleHint` 文字流。
- dev 顯示：hint card 在 `import.meta.env.DEV` 下顯示 `transcript`。

## 回退觸發條件
以下任一即視為音訊路徑失敗，改走 Web Speech 文字流：
- 無 mic track 可用 / `stop()` 回傳 null。
- Blob 為空或過短。
- 音訊 `/ai/hints` 呼叫 throw 或逾時（沿用 ai.ts 既有 60s timeout + 多模型 fallback）。
若回退後 Web Speech 文字也為空 → 沿用現有「空語音」處理（不生成）。

## 測試策略
- 後端 `ai.test.ts`：補測「音訊輸入時 contents 以 inlineData 組裝、transcript 欄被解析」；mock Gemini client。既有文字路徑測試須保持綠（向後相容驗證）。
- 前端：MediaRecorder 在 jsdom 難以單元測試，`useTurnAudioRecorder` 以 dev 手動驗證為主；可對「無 track 時 stop() 回 null」做輕量測試。
- e2e / 手動：`backend/scripts/phase0-spike.mts` 作為 Gemini 音訊行為的驗證 harness。

## 技術風險與先行驗證
**Gemini 官方音訊格式列的是 wav / mp3 / aac / ogg / flac，不保證接受 `audio/webm`**；Chrome MediaRecorder 預設吐 `audio/webm;codecs=opus`。

對策（實作第一步）：
1. 先用一小段真實音訊（可用 MediaRecorder 錄一段，或既有測試音檔轉 ogg）確認 Gemini 收得下哪種容器。
2. 錄製優先 `audio/ogg;codecs=opus`；若瀏覽器不支援再退 `audio/webm;codecs=opus`，並確認後端透傳的 mimeType 與實際容器一致。
3. 若兩者 Gemini 都不收，退而求其次：後端或前端轉碼（成本較高，非最小原型範圍，需回頭討論）。

## 向後相容
- `/ai/hints` 不帶 `audio` 時行為完全等同現況。
- `buildHintsSystemInstruction` 的 `inputMode` 預設 `'text'`。
- Web Speech 路徑保留為回退，未移除。

## 成功標準
- 老師對麥講一輪後，hint card 顯示的 `transcript`（Gemini）明顯比現況 Web Speech 逐字稿乾淨、可讀。
- 音訊路徑失敗時無感回退到現況文字流，不中斷教學。
- 既有測試全綠。
