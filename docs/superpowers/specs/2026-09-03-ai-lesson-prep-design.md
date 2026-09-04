# AI 教學助理：Agent 引入評估與老師備課模組設計

> 日期：2026-09-03
> 狀態：設計已核可，待寫實作計畫
> 前置文件：`docs/plans/2026-06-04-ai-agent-migration.md`（課中提示的 Agent 化評估）、`docs/superpowers/specs/2026-06-16-path-b-native-audio-hints-design.md`（原生音訊）、`docs/superpowers/specs/2026-07-24-teacher-student-login-integration-design.md`（登入分流）

## 1. 背景與問題

Live MR 的 AI 助理目前只有一條流程：老師說話 → STT 或原生音訊 → `POST /api/ai/hints` → Gemini 回 `{question, complete, extend}`。它是無狀態、單發呼叫、由前端維護對話歷史。

產品下一步要把 AI 助理擴展成三個階段：

| 階段 | 需求 |
|------|------|
| 備課 | 一鍵生成 15 分鐘微教案與逐字腳本（輸入主題、預設學生程度），並產生學習目標、語法說明、教學注意點 |
| 課中 | 追蹤分析學生程度，實現適性教學 |
| 課後 | 學習資產化、可追蹤（例如常錯問題） |

本文件回答「是否要引入 Agent」，並完整設計第一階段（備課模組）與三階段共用的地基。

### 1.1 現況盤點（2026-09-03）

- 備課模組完全不存在，沒有教案、腳本、語法說明的任何程式或資料結構。
- 教學內容是手寫靜態設定：`frontend/src/config/scenes.ts` 的 Theme → Scene → Module → TaskItem，加上 `taskHints.ts` 的五階層鷹架（僅手寫服飾店收銀台 ask_price 十題）。這是大屏實際能執行的內容格式。
- 後端零持久化。`RoomStore`、`RecordingStore` 皆為記憶體；帳號與機構資料在外部 SDGs Journey 後端，Live MR 只做登入代理。
- 學生語音沒有被處理。只有老師端跑 STT；學生麥克風經 LiveKit 送到老師端但未轉文字、未評估。「學生程度」在程式裡不存在。
- `backend/src/ai.ts` 的 `generateHint` 與 `generateHints` 各自複製一份模型 fallback、逾時、重試邏輯。
- 封裝的 Node runtime 為 22.18，內建 `node:sqlite` 可用。
- 大屏用任務 id 靜態查 `TASK_HINTS`；`task-change` 廣播已攜帶完整任務清單。
- 老師登入分流 `routeAfterAuth` 目前只在未合併的 `teacher-student-login-integration` worktree，main 的 `state.ts` 仍是舊狀態機。

## 2. 是否引入 Agent：結論

這裡的 Agent 指「模型在迴圈中自行決定呼叫哪些工具、做幾步」的自主型態；與之相對的是「事先定義好步驟、以結構化輸出串接」的 workflow。

| 階段 | 建議形態 | 理由 |
|------|---------|------|
| 備課 | 結構化 workflow | 輸入固定、輸出格式固定、沒有動態決策需求。用 responseSchema 兩步生成即可，可測試、成本可預期 |
| 課中適性 | Agent-ready 的狀態層與工具層，先不跑自主迴圈 | 課堂每輪只有一到兩秒預算，自主多步迴圈的延遲不可接受。真正缺的是 server 端學習者狀態與評估器 |
| 課後資產化 | 批次 workflow 加持久化 | 是資料層問題，不是 Agent 問題 |

**決定：現階段不引入通用 Agent 框架或自主迴圈，但把 Agent 的三個地基先蓋好：統一的模型呼叫層（含 usage 觀測）、持久化資料層、以及可被包成工具的查詢函式。** 到第二階段若出現「模型需要自己決定查什麼資料、做什麼動作」的具體案例，再把 repository 的查詢函式包成 Gemini function declarations 加上迴圈，不需重寫。

否決的路線：

- 只做文件型教案生成器：最快，但產物與課堂脫鉤，後兩階段要另起資料模型。
- 直接上 function-calling Agent：備課沒有動態決策需求，只多付延遲與不可預測性，且資料層還沒有東西可查。

## 3. 已確認的決策

| 決策 | 選擇 |
|------|------|
| 教案產出 | 除文件外，同時產生符合現有 TaskItem 與 TaskHint 五階層格式的任務包，課堂可直接載入 |
| 持久化 | 第一版本機 SQLite（`node:sqlite`），資料表預留 `institution_id` 與 `teacher_uid`，第二階段再同步到 SDGs Journey |
| 學生程度尺度 | CEFR A1 / A2 / B1；第一版整班一個預設值，個別學生留到第二階段 |
| 主題輸入 | 先選現有 3D 場景，再輸入自由文字主題；AI 在該場景約束下生成 |
| 任務包編輯 | 允許刪單題與改文字，不做完整編輯器 |
| 入口 | 老師登入後進 `teacher-home`，分「備課」與「開始上課」；開始上課可挑一份教案帶進房間 |
| 產出形式 | 分段卡片顯示；「複製為 Markdown」與瀏覽器列印；不做 PDF |

**明確不做（YAGNI）**：Agent 框架、function calling 迴圈、串流輸出、PDF 匯出、完整任務編輯器、個別學生程度、後端身分驗證、SDGs 同步。

## 4. 模組邊界

### 4.1 後端

新增 `backend/src/ai/` 目錄，現有 `ai.ts` 拆入。

| 檔案 | 職責 | 相依 |
|------|------|------|
| `ai/client.ts` | 唯一會碰 `@google/genai` 的檔案。模型 fallback 清單、逾時、可重試判斷、responseSchema、usage 統計。對外暴露一個泛型函式：輸入 prompt / systemInstruction / schema / 溫度 / 思考預算 / 可選音訊，輸出已解析的 JSON 與 `{model, usage}` | `@google/genai` |
| `ai/hints.ts` | 現有 `generateHint` / `generateHints` 搬入並改用 client。對外介面與既有測試不變 | `ai/client.ts` |
| `ai/lessonPlan.ts` | 教案 workflow：組 prompt、呼叫 client、驗證、合併。純函式，不碰資料庫 | `ai/client.ts`、場景設定 |
| `db/connection.ts` | 開啟 `data/livemr.sqlite`，跑 migration | `node:sqlite` |
| `db/migrations.ts` | 版本化 SQL 字串陣列（不用獨立 .sql 檔，因 esbuild 打包成單一 bundle），以 `schema_version` 表記錄已套用版本 | |
| `db/lessonPlanRepo.ts` | 教案與任務的增刪改查 | `db/connection.ts` |
| `routes.ts` | 新增教案端點（見 4.3） | repo、`ai/lessonPlan.ts` |

場景描述（角色、站位、既有模組當格式範例）目前在前端 `scenes.ts`。後端生成時需要這份資料，作法：前端在生成請求中把選定場景的 `slots` 標籤、`labelEn` 與一組範例任務（含 TaskHint）一併送上，後端不另存一份場景表。這維持「編輯內容只改 THEMES」的原則。

### 4.2 前端

| 檔案 | 改動 |
|------|------|
| `state.ts` | 新增 `teacher-home`、`lesson-prep`；`host-lobby` 與 `host-session` 多帶可選 `planId` |
| `App.tsx` | `routeAfterAuth` 老師分流改為進 `teacher-home`，不再自動建房 |
| `components/TeacherHome.tsx` | 「備課」與「開始上課」；開始上課時可選一份已存教案 |
| `components/LessonPrep.tsx`、`components/LessonPlanView.tsx` | 清單、新建表單、生成中；結果卡片、編輯與儲存、複製 Markdown、列印 |
| `utils/lessonPlanClient.ts` | 教案端點的 fetch 封裝 |
| `config/content.ts`（新增） | `resolveModules(staticModules, plan?, sceneId)`、`resolveTaskHint(taskId, plan?)`、`resolveSceneConstraint(sceneId, plan?)`：先查教案，再查靜態設定 |
| `HostSession.tsx` | 用 `content.ts` 取代直接讀 `TASK_HINTS` / `SCENE_CONSTRAINTS`；任務庫改讀 `resolveModules`；有 `planId` 時載入教案並切換場景 |
| `BigScreen.tsx` | `task-change` 的 TaskItem 多帶可選 `hint`；查提示改為 `task.hint ?? TASK_HINTS[task.id]` |
| `types/vrm.ts` | `TaskItem` 加可選 `hint?: TaskHint` |

### 4.3 REST 端點

| 端點 | 說明 |
|------|------|
| `POST /api/lesson-plans/generate` | 輸入 `{teacherUid, institutionId?, sceneId, sceneContext, topic, level}`；同步等待生成完成後回傳已儲存的教案。逾時 90 秒 |
| `GET /api/lesson-plans?teacherUid=` | 該老師的教案清單（不含 plan_json 全文） |
| `GET /api/lesson-plans/:id` | 單筆完整教案 |
| `PATCH /api/lesson-plans/:id` | 更新標題與任務包（刪題、改文字） |
| `POST /api/lesson-plans/:id/delete` | 刪除。用 POST 而非 DELETE，因為 CORS 與安全標頭的方法白名單只開 GET / POST / PATCH |

身分沿用專案既有原則：後端信任前端傳來的 `teacherUid`，不驗 Firebase token。與登入整合規格一致，SDGs 同步階段再補。

## 5. 資料模型

第一版只建兩張表；其他表由第二、三階段各自的 spec 新增，但 migration 機制本次建好。

```sql
CREATE TABLE lesson_plans (
  id             TEXT PRIMARY KEY,      -- uuid
  teacher_uid    TEXT NOT NULL,
  institution_id TEXT,                  -- 預留 SDGs 同步
  scene_id       TEXT NOT NULL,
  topic          TEXT NOT NULL,
  level          TEXT NOT NULL,         -- 'A1' | 'A2' | 'B1'
  title          TEXT NOT NULL,
  plan_json      TEXT NOT NULL,         -- 見下方形狀；tasks 亦冗餘存於此以便單次讀取
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE lesson_tasks (
  id           TEXT PRIMARY KEY,        -- 'plan_{planId}_{n}'
  plan_id      TEXT NOT NULL REFERENCES lesson_plans(id) ON DELETE CASCADE,
  module_id    TEXT NOT NULL,
  module_label TEXT NOT NULL,
  sort_order   INTEGER NOT NULL,
  label        TEXT NOT NULL,
  hint_json    TEXT NOT NULL            -- TaskHint 五階層
);
```

`lesson_tasks` 獨立成表是為了第二、三階段的課堂紀錄與錯誤統計能以 `task_id` 做外鍵。`plan_json` 內的 `modules` 與 `lesson_tasks` 內容相同，以 `lesson_tasks` 為準；PATCH 時兩者一起更新。

`plan_json` 形狀：

```ts
interface LessonPlan {
  title: string
  sceneId: string
  topic: string
  level: 'A1' | 'A2' | 'B1'
  durationMin: 15
  objectives: string[]                                                   // 學習目標（中文）
  timeline: { phase: string; minutes: number; activity: string; teacherScript: string }[]  // 逐字腳本依時段切（腳本英文，phase/activity 中文）
  grammarNotes: { point: string; explanation: string; examples: string[] }[]  // 語法說明（explanation 中文）
  teachingNotes: string[]                                                // 教學注意點（中文）
  sceneConstraint: string                                                // 餵給課中提示 AI（英文）
  modules: { id: string; label: string; icon: string; tasks: { id: string; label: string; hint: TaskHint }[] }[]
}
```

任務 id 一律 `plan_{planId}_{n}` 前綴，避免與手寫 THEMES 撞名。

## 6. 教案生成 workflow

兩步結構化生成。總逾時 90 秒，任一子步驟失敗即整體失敗，不儲存半成品。

**第一步：大綱**（一次呼叫，較高思考預算，溫度偏低）

- 輸入：場景角色與站位描述、老師主題、CEFR 等級、15 分鐘、一組手寫任務作為 TaskHint 格式範例。
- 輸出（responseSchema）：`title`、`objectives`、`timeline` 骨架（phase / minutes / activity，不含腳本）、`modules` 與各任務 `label`、`sceneConstraint`。
- 約束：時段分鐘數總和必須為 15；模組 2 到 4 個，每模組 3 到 6 題；任務 label 為英文祈使句，與現有 THEMES 風格一致。

**第二步：展開**（三類呼叫並行，各有 responseSchema）

1. 逐時段教師逐字腳本：每個時段一次呼叫，輸入大綱與該時段活動，輸出 `teacherScript`。
2. 任務五階層提示：每個模組一次呼叫，輸入該模組所有任務 label 與 TaskHint 格式範例，輸出每題的 `keyStructure` / `partialSentence` / `unscramble` / `completeSentence` / `extraPhrases`。
3. 語法說明與教學注意點：一次呼叫，輸入大綱與所有任務完整句，輸出 `grammarNotes` 與 `teachingNotes`。

**驗證**

- 每題的 `unscramble` 單字多重集合必須與 `completeSentence` 拆字結果一致；不一致則該模組重試一次，仍不一致就以 `completeSentence` 拆字洗牌取代並記錄警告（資料仍正確，不因此整體失敗）。
- 每段腳本字數落在「分鐘數 × 100 到 150 字」範圍內，超出只記警告不擋。
- CEFR 符合度不做程式驗證，靠 prompt 約束。

**模型設定**：沿用 `GEMINI_MODEL` fallback 清單。大綱步驟思考預算 1024、`maxOutputTokens` 2048；展開步驟依內容量給 1024 到 2048。所有呼叫記錄 usage 至伺服器 log，供之後成本評估。

**前端等待**：單一請求，畫面顯示固定文案的步驟進度（大綱 → 腳本 → 任務 → 語法），不做真實進度串流。

## 7. 畫面流程與課堂整合

```
登入(teacher) → teacher-home ─┬─ 備課 → lesson-prep
                              │           ├─ 清單（既有教案，可開啟 / 刪除）
                              │           ├─ 新建表單（場景下拉、主題、CEFR）
                              │           ├─ 生成中（步驟文案）
                              │           └─ 結果（分段卡片、任務包編輯、儲存、複製 Markdown、列印）
                              └─ 開始上課（可選一份教案）→ host-lobby → host-session
```

- `host-session` 狀態帶可選 `planId`。HostSession 啟動時若有 `planId`，向後端取教案並存於 state；重新整理沿 sessionStorage 還原 `planId` 後重取。
- HostSession 載入教案後自動切換到教案的 `sceneId`。任務庫用 `resolveModules(staticModules, plan, sceneId)`：當所選場景與教案相符時，教案模組插在靜態模組之前並冠上「我的教案」字樣；切到其他場景則只顯示該場景的靜態模組。不另建虛擬 Theme，場景選單維持不變。
- `resolveSceneConstraint` 在教案存在且 sceneId 相符時回傳教案的 `sceneConstraint`，否則回 `SCENE_CONSTRAINTS[sceneId]`。
- `HintTaskContext` 的 `currentTargetSentence` / `nextTargetSentence` 改由 `resolveTaskHint` 取得。
- `task-change` 廣播時，教案任務的 TaskItem 帶 `hint`；BigScreen 優先用它。

## 8. 例外處理

- 生成逾時或任一子步驟失敗：回 502 與步驟名稱，前端顯示「生成失敗，請重試」，表單內容保留。
- Gemini 回傳 JSON 不符 schema：client 層拋錯，視為該模型失敗，依 fallback 換模型。
- 資料庫檔案不可寫（例如放在唯讀目錄）：後端啟動時記錄錯誤並停用教案端點（回 503），其他功能不受影響。
- 教案引用的 `sceneId` 在目前 THEMES 已不存在：清單仍顯示，開始上課時提示「此教案的場景已移除」並禁止帶入。
- `planId` 對應教案已刪除：HostSession 退回無教案模式並顯示提示。

## 9. 第二、三階段的預留

- **課中**：新增 `class_sessions`（plan_id、room_id、teacher_uid、起訖時間）與 `session_turns`（session_id、時間、說話者、transcript、AI 提示、當時 task_id）。學生語音走已完成的 Path B 原生音訊路徑，非同步評估寫入 `student_assessments`（cefr 估計、錯誤標籤），不擋提示生成。整班 CEFR 預設值屆時成為每位學生估計值的初始值。
- **課後**：對 `session_turns` 與 `student_assessments` 跑批次摘要，歸類常錯問題，掛在 `lesson_tasks` 與學生底下。
- **SDGs 同步**：兩張表已預留 `institution_id` 與 `teacher_uid`，加一個上傳任務即可。
- **Agent 迴圈**：若課中出現「模型需要自己決定查什麼、做什麼」的案例，把 repository 查詢函式包成 function declarations 交給 `ai/client.ts` 新增的迴圈模式。

## 10. 測試

- `ai/client.ts`：mock `@google/genai`，測 fallback 順序、逾時、不可重試錯誤直接拋出、schema 不符視為模型失敗。沿用現有 `ai.test.ts` 案例確保 hints 行為不變。
- `ai/lessonPlan.ts`：mock client，測兩步合併、時段分鐘總和驗證、重組單字驗證與重試、子步驟失敗整體失敗。
- `db/`：用 `:memory:` SQLite 測 migration 冪等與 repository 增刪改查、CASCADE 刪除。
- 路由：教案端點的輸入驗證、404、資料庫停用時的 503。
- 前端：沿用專案慣例只測純函式，不引入 Testing Library。`resolveAuthRoute` 分流、`content.ts` 三個 resolve 函式（涵蓋「有教案 / 無教案 / sceneId 不符」）、`buildSceneContext`、`lessonPlanToMarkdown`、`LessonPlanView` 的任務編輯 reducer。畫面元件以手動驗證。
- 品質：一支手動 spike 腳本（`backend/scripts/lesson-plan-spike.mts`）對三個等級各生成一份教案，人工檢視，不進自動測試。

## 11. 相依與執行順序

1. 先合併 `teacher-student-login-integration` 分支（`routeAfterAuth` 與新狀態機是本設計的入口前提）。
2. 後端：`ai/client.ts` 抽取 → hints 搬遷（既有測試綠）→ `db/` → `ai/lessonPlan.ts` → 端點。
3. 前端：`content.ts` 與 HostSession / BigScreen 接線（可用假教案先驗證）→ `TeacherHome` → `LessonPrep`。
4. spike 腳本跑三等級教案，人工檢視後調 prompt。

實作在獨立 git worktree 進行，完成後由使用者決定是否合併。
