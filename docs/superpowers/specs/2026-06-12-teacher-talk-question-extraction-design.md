# 老師長話 → 主問句抽取 → 學生回應（開發測試）設計

日期：2026-06-12
狀態：草稿（待使用者審閱）

## 背景與目標

現行教師端 AI 助理流程（見 `2026-06-01-interaction-turn-taking-design.md`）：
老師說話 → 麥克風連續 STT 累積 transcript → 按「換學生」→ 整段 transcript 送
Gemini（`/api/ai/hints`）→ 產生學生回應（complete / rearrange / extend），
以單一 hint card 廣播給學生與 BigScreen。

新需求（開發階段測試）：以 `frontend/public/voice/Teacher_chat_test.mp3` 當「老師段落」，
模擬老師一段**較長的連續談話**。這段長談話中夾雜寒暄、課堂指示、旁白，其中會有
**針對學生提問的重點句子**。AI 要能**從長 transcript 中過濾出最關鍵的那一句提問**，
並針對該句產生學生回應。

### 已決定的設計選擇（brainstorming 結論）

1. **輸入來源**：播放 mp3 由喇叭外放，沿用現有 Web Speech API（麥克風）收音轉文字。
2. **觸發模式**：老師話完一次性抽取（沿用現有「換學生／按鈕」觸發，不做背景連續/增量偵測）。
3. **多問句處理**：只取主問句 1 句，沿用現有單一 hint card（complete / rearrange / extend）。
4. **抽取作法**：單次 Gemini 呼叫回傳 `{ question, complete, extend }`；`question` 為抽出的主問句，供開發驗證。

### 非目標

- 不做背景連續 / 增量 AI 偵測（維持「老師話完才送」）。
- 不做多問句清單 UI 或多張卡。
- 不改學生端 turn-taking 機制、不改 `BigScreenMsg` 訊息契約、不改 LiveKit data 契約。
- 不做後端音檔 STT（沿用前端麥克風 STT）。

## 資料流（完整一輪）

```
[dev] ▶測試音檔鈕 → <audio> 播 /voice/Teacher_chat_test.mp3（喇叭外放）
        ↓ 老師同時按「開始互動」→ 現有 mic STT 收音（teacher phase）
   長 transcript 累積
        ↓ 老師按「換學生」(現有觸發，autoScriptTrigger 路徑)
   handleHint('rearrange')  ← 完全沿用現有冷路徑
        ↓
   generateHints(longTxt, { history, systemInstruction })
        ↓ 後端 Gemini 單呼叫，responseSchema 多一個 question 欄位
   { question, complete, extend }
        ↓
   - question  → 開發驗證：console.log + (可選) hint card 下方 dev 小字
               → 作為 chat history 的 user turn（取代整段長獨白）
               → 作為 AIHintPayload.sourceText（BigScreen 氣泡顯示實際問句）
   - complete  → 現有 cache.complete / broadcast / hint card
   - extend    → 現有 cache.extend
   - rearrange → shuffleWords(complete)（沿用，client 端推導）
```

## 具體改動點

### 1. `backend/src/ai.ts` — `generateHints`

- `HintsResult` 介面增 `question: string`。
- `config.responseSchema.properties` 增 `question: { type: 'STRING' }`，並加入 `required`
  （逼模型一定回傳此欄位）。
- 解析時讀 `parsed.question`（型別檢查 + trim）。
- fallback 路徑（回應非 JSON、`parsed = { complete: raw, extend: '' }`）時 `question = ''`。
- 回傳 `{ question, complete, extend, model }`。

### 2. `backend/src/routes.ts` — `POST /api/ai/hints`

- 取得 `question` 並 `res.json({ question, complete, extend, model })`。

### 3. `frontend/src/utils/geminiClient.ts` — `generateHints` / `HintsResult`

- `HintsResult` 介面增 `question: string`。
- 讀取 `data.question`（`(data.question ?? '').trim()`），回傳值帶上 `question`。
- `complete` 仍為必要欄位（空則 throw 'Empty response'，沿用）。

### 4. `frontend/src/config/aiAssistant.ts` — `buildHintsSystemInstruction`

- 系統指令新增「過濾」段落：使用者回合可能是**一長段老師獨白**，夾雜寒暄、課堂指示、
  旁白與多句話；請先**靜默鎖定其中唯一一句、最關鍵且針對學生的提問**，以該句為準作答，
  忽略其餘內容。若整段沒有明確提問，挑最接近「對學生說」的一句。
- JSON 輸出欄位由 2 個變 3 個：
  - `question`：抽出的主問句**原文**（老師實際說的那句，英文）。
  - `complete`：針對該問句的學生完整回應句（沿用現有規則）。
  - `extend`：接續延伸句（沿用現有規則）。
- 沿用現有「缺資訊就 INVENT 具體值、勿給模糊答案」與 task focus block 規則。

### 5. `frontend/src/components/HostSession.tsx` — `handleHint` 冷路徑

- 取 `result.question`；`console.log('[hint] extracted question:', result.question)` 供開發驗證。
- **chat history 的 user turn 改記 `result.question`**（而非整段長獨白 `txt`）：
  ```ts
  const userTurnText = result.question || txt;  // question 空則 fallback 原 txt
  chatHistoryRef.current = [
    ...history,
    { role: 'user' as const, text: userTurnText },
    { role: 'model' as const, text: result.complete },
  ].slice(-MAX_CHAT_TURNS);
  ```
  好處：多輪續寫上下文更乾淨、每次送 Gemini 的 token 更省。
- `AIHintPayload.sourceText` 改帶 `result.question || txt`，讓 BigScreen 機器人氣泡顯示
  「老師實際問的那句」而非冗長獨白。`cachedSourceTextRef.current` 同步存此值，
  讓 cache-first path 切模式時 sourceText 一致。
- （可選，dev）hint card 下方顯示一行小字「偵測問句：…」。

### 6. `frontend/src/components/HostSession.tsx` — 開發用音檔播放鈕

- AI panel 內新增一顆 **dev-only** 按鈕「▶ 測試音檔」，用 `import.meta.env.DEV` 包住，
  正式 build 不顯示。
- 點擊以 `<audio>`（或 `new Audio('/voice/Teacher_chat_test.mp3')`）播放，喇叭外放，
  讓老師可重現地跑測試（同時按「開始互動」由 mic 收音）。
- 再按一次停止 / 重播（簡易 toggle 即可）。

## 錯誤處理與邊界

- transcript < 3 字、AI 失敗、逾時 → 沿用既有 `aiError` 與 phase 回退路徑，不變。
- 模型抽不出明確提問 → 系統指令要求挑「最接近對學生說的一句」放入 `question`，
  並仍保證 `complete` 有值（沿用 INVENT 規則）。
- `question` 為空字串 → 前端所有使用點 fallback 回原 `txt`（chat history、sourceText）。
- 多輪：第二輪起 history 帶的是上一輪「抽取問句」+ 上一輪 `complete`，續寫一致性沿用既有機制。

## 介面契約變更

- HTTP `POST /api/ai/hints` 回應：`{ complete, extend, model }` → 增 `question`
  （新增欄位，向後相容；舊呼叫端忽略即可）。
- `BigScreenMsg`、LiveKit `publishData` 訊息契約：**不變**。

## 測試計畫

無自動測試 framework — 沿用 tsc + lint + 手動。

- `npx tsc -b --noEmit` 通過。
- `npm run lint` 維持 baseline。
- 既有 `backend/src/*.test.ts`（若涵蓋 hints 形狀）對應更新。
- 手動：
  1. 開發模式按「▶ 測試音檔」播 mp3，同時按「開始互動」收音。
  2. mp3 播完／老師按「換學生」→ console 印出 `[hint] extracted question:` 為其中一句提問。
  3. 學生 hint card 顯示針對該問句的回應；BigScreen 機器人氣泡顯示該問句（非整段獨白）。
  4. 連兩輪 → 第二輪送 Gemini 的 history user turn 是上一輪「抽取問句」而非長獨白。
  5. 講一段完全沒提問的內容 → 仍回一個合理 `complete`（不崩、不空白）。

## 風險

- STT 對 mp3 外放的辨識品質受環境/喇叭影響，長段談話可能有辨識誤差；屬測試輸入品質問題，
  與抽取邏輯解耦（抽取邏輯吃到什麼文字就處理什麼）。
- 模型抽取「主問句」的判斷有主觀性；以 `question` 欄位回傳即為了讓開發者可檢視並據以調整 prompt。
- `required` 含 `question` 後，舊有僅回 `{complete, extend}` 的 fallback 仍需容忍 `question` 缺漏（設空字串）。
