# AI Agent 化規劃 — 從純生成式到工具化代理

> 日期: 2026-06-04
> 範圍: 教師端 AI 助理 (HostSession 提示生成) 與學生端延伸句 (StudentSession `generateHint`)
> 狀態: 討論/方向確認中,尚未實作

---

## 1. 目前架構 (純生成式 / stateless)

```
HostSession ─┐
             │  POST /api/ai/hints
             │    systemInstruction (場景約束 + 任務焦點 + 學生角色)
             │    history          (client 每次重送完整對話)
             │    prompt           (老師最新一句轉文字)
             ▼
backend/ai.ts ─► genAI.models.generateContent (一次性 call)
             │    responseSchema: { complete, extend }
             │    MODELS fallback: 2.5-flash → 2.5-flash-lite → 2.0-flash-lite
             ▼
返回客戶端 ──► 對 `complete` 做 client-side shuffleWords ⇒ `rearrange` 模式
```

關鍵程式碼:
- 前端代理: `frontend/src/utils/geminiClient.ts`
- 後端入口: `backend/src/ai.ts` (`generateHint` / `generateHints`)
- Prompt 組裝: `frontend/src/config/aiAssistant.ts`
  (`buildSystemInstruction` / `buildHintsSystemInstruction` / `buildPrompt` / `buildStudentExtendPrompt`)

特性歸納:
- **Stateless** — 後端不存 session memory,每次重組
- **單發 call** — 沒有 tool use、沒有 self-critique、沒有多步推理
- **Client 維護 history** — chat history 跟 systemInstruction 由前端每次序列化重送
- **`rearrange` 是 client shuffle** — 純機械洗牌,沒有教學難度梯度
- **`SCENE_CONSTRAINTS` 目前只填了 `clothingStore_cashier`**,其他場景退化為空字串

---

## 2. 與 AI Agent 的差異

| 面向 | 現在 | Agent 化 |
| --- | --- | --- |
| 上下文 | client 每次塞完整 history + system prompt | server 維護 session memory,agent 自取 |
| 決策 | 單發產出,model 看到啥回啥 | 多步推理 + tool calling 拉真實狀態 |
| 工具 | 無 | `getCurrentTask()` / `getSceneState()` / `getRecentVocab()` 等 |
| 副作用 | HostSession 手動觸發 task-change / hint-change | agent 可自呼 `markTaskComplete()` 主動推進任務 |
| Token 成本 | 線性成長 (history 越長越貴),無修剪 | server-side trim + 工具回傳取代長 history |
| 延遲 | 1 round-trip ≈ 1–2 s | 多 round-trip,2–5 s |
| 失誤恢復 | 換 model 重試 (MODELS fallback) | self-critique loop 可糾正中文夾雜、太複雜句等 |
| 多模態 | text only (吃 STT 後文字) | Gemini Live 可直接 audio in/out |

---

## 3. 當前可見痛點 (從程式碼推得)

1. **場景約束資料不全** — `SCENE_CONSTRAINTS` 僅 `clothingStore_cashier`,其他場景 AI 沒有專屬詞彙約束,容易跑題到通用日常英語。
2. **client 維護 history,無 sliding window** — token 隨課堂線性成長,長課可能逼近 model context 限制或費用爆增。
3. **`rearrange` 是 `shuffleWords` 機械洗牌** — 無法依詞性或難度智慧排序;學生若已熟練,洗牌挑戰性過低或過高皆不可控。
4. **無自我檢核** — model 偶爾跑出中文、ellipsis、太複雜句,只能靠 prompt 嚴詞約束;失敗時前端只看到「Empty response」或不合預期句。
5. **HostSession 對 AI 是 fire-and-forget** — 沒有「AI 主動建議推進任務 / 標記完成」能力,所有 task 狀態都由教師手動。
6. **`generateHint` 與 `generateHints` 兩個端點分離** — 重複的 model fallback / abort 邏輯,共用工具呼叫時較容易維護成本錯位。

---

## 4. 三條可行路線

### Path 1 — 強化結構化輸出 (推薦先做,1–2 天)

不改架構,純升級 prompt + responseSchema:

- 一次產出更豐富的結構:
  ```json
  {
    "complete":         "It is 200 dollars.",
    "extend":           "It is 200 dollars, but we have a 10% discount today.",
    "rearrangedWords":  ["dollars", "It", "200", "is"],
    "vocabTags":        ["price", "dollar"],
    "taskFitScore":     0.86
  }
  ```
- 用 `rearrangedWords` 取代 client `shuffleWords`,可由 model 控制難度梯度。
- 用 `taskFitScore` 讓前端判斷「AI 認為這句是否切題」,UI 可標示低分;教師決定是否採用。
- 補齊所有 `SCENE_CONSTRAINTS` (列舉所有 scene preset 並填入專屬詞彙、Scene/Language/Grammar/Vocabulary/Response style 五段)。
- Client history 加 sliding window,例如保留最近 6 turns。

**收穫**:立刻見效、token 不增反降、把現存最弱的兩個點 (場景約束缺失 + rearrange 弱) 補掉。
**取捨**:仍是單發 call,model 失誤仍需重試;沒有自主推理。

### Path 2 — Server-side hybrid agent (中度,3–5 天)

把 `/api/ai/hints` 改成 Function Calling agent loop:

- 後端持有 session memory (in-memory Map 或 Redis,以 `roomId` 為 key)。
- 暴露給 model 的工具:
  - `getSceneConstraint(sceneId)` — 取代靜態 lookup
  - `getActiveTask()` — 目前進行中任務 + 目標句
  - `getStudentRole(identity)` — 學生角色 (customer/shop assistant)
  - `getRecentVocab(window)` — 已學/已用詞彙
  - `getDialogHistory(n)` — server-side 歷史,取代 client 重傳
- Client 端 payload 縮為 `{ roomId, teacherTranscript, mode }`,context 由 agent 主動取。

**收穫**:context 集中、token 大幅降、未來可加 `markTaskComplete()` 讓 AI 主動推進。
**取捨**:+800 ms 延遲、需寫工具實作 + 維護;backend 變有狀態 → 影響 scale 與部署模式 (單實例好做,多實例要共享 store)。

### Path 3 — Gemini Live (長期,1 週+)

WebSocket 直送 audio in / audio out + 結構化 metadata,移除 STT 段。

**收穫**:真實時雙向對話、延遲降到 ~500 ms、不再受 STT 噪音/誤識影響。
**取捨**:計費跳一階、region 限制 (台灣可用性需確認)、現有教師端 SpaceBar STT pipeline 要整段拆掉、整合 LiveKit audio track 與 Gemini Live socket 有非平凡複雜度。

---

## 5. 推薦組合與排程

| 階段 | 範圍 | 預估工時 | 主要 KPI |
| --- | --- | --- | --- |
| **1** | Path 1 — structured output + 補 SCENE_CONSTRAINTS + client history 修剪 | 1–2 天 | rearrange 可控、所有場景可用、每課 token 降 30%+ |
| **2** | Path 2 子集 — server-side history (暫不加 tool calling) | 1.5 天 | client payload 大幅縮、後端持有可觀測對話狀態 |
| **3** | Path 2 完整版 — function calling tools + `markTaskComplete()` | 2–3 天 | 教師端 task 流程可半自動;AI 可主動拉真實狀態 |
| **4** | Path 3 — 評估 Gemini Live PoC | 1 週 | 即時對話 demo 可用,決定是否替換現流程 |

階段 1–2 風險低、可分次上線;階段 3 需配合 UI 設計 (AI 主動 markComplete 時教師如何 confirm);階段 4 需與商務確認 Gemini Live 計費。

---

## 6. 待確認問題

- 場景列舉:除了 `clothingStore_cashier`,還有哪些 scene preset 已上線/將上線?需要的話可先在 SCENE_PRESETS 盤點。
- `taskFitScore` 是否要影響教師端 UI (例如低分句子打灰、加註提示)?還是先記錄 telemetry 不顯示?
- 後端 session memory 是否需跨重啟保留?in-memory 已足夠 (課堂單次) 或必須 Redis?
- 多教師情境 (host 多人) 是否需要區分 memory namespace?目前 server 只有 `roomId` 視角。
- Gemini Live 在使用者所在地是否可商用?

---

## 7. 相關文件 / 程式

- `frontend/src/config/aiAssistant.ts` — 所有 prompt 模板
- `frontend/src/utils/geminiClient.ts` — 前端 API 代理
- `backend/src/ai.ts` — Gemini 呼叫與 model fallback
- `backend/src/routes.ts` — `/api/ai/hint(s)` 路由
- `docs/plans/2026-05-25-student-ai-assistant.md` — 前一版學生端 AI 規劃 (背景)
