# 任務提示（Task Hints）設計

**日期**：2026-05-11
**範圍**：`frontend/` — HostSession、BigScreen、新增 `config/taskHints.ts`、`App.css`

---

## 目標

在情境對話中，老師可針對「當前任務」對學生顯示分階的語言鷹架提示（5 階），由少到多：

1. **關鍵字提示**（keyword）— 幾個關鍵單字
2. **句首提示**（sentenceStart）— 句子開頭，例如 `How much ...?`
3. **半句型提示**（halfPattern）— 帶空格的半成句，例如 `How much ___ the blue T-shirt?`
4. **選項引導**（options）— 2~3 個完整句子讓學生選
5. **完整示範**（fullDemo）— 一句完整正確答案

老師在 HostSession 控制要顯示哪一階（或不顯示）；學生在投影大屏底部橫條看到選定那一階的內容。

---

## 使用者流程

1. 老師在 `hs-task-banner` 點「💡 任務提示」開關 → `hintEnabled = true`
2. HostSession 的 `hs-video-area` 右側出現「提示控制欄」（與大屏預覽 iframe 各自獨立）
3. 控制欄內：當前任務文字、5 顆階層按鈕 + 「✕ 不顯示」、選定階的內容檢視
4. 老師點某一階 → `hintLevel` 設為該階 → 廣播給 BigScreen → 大屏底部橫條顯示該階內容
5. 老師點「✕ 不顯示」→ `hintLevel = null` → 大屏底部橫條消失
6. 當前任務完成、推進到下一任務 → HostSession 自動把 `hintLevel` 設回 `null` 並廣播（初始不提示）
7. 老師關掉「任務提示」開關 → `hintEnabled = false` → 控制欄與大屏橫條都消失

---

## 架構

### 資料層 — `frontend/src/config/taskHints.ts`（新檔）

```ts
export type HintLevel = 'keyword' | 'sentenceStart' | 'halfPattern' | 'options' | 'fullDemo'

export interface TaskHint {
  keyword: string[]        // ① 關鍵字 chips
  sentenceStart: string    // ② 句首提示
  halfPattern: string      // ③ 半句型（用 ___ 表示空格）
  options: string[]        // ④ 選項引導，2~3 個完整句子
  fullDemo: string         // ⑤ 完整示範
}

/** key = TaskItem.id（對應 scenes.ts 裡的任務 id） */
export const TASK_HINTS: Record<string, TaskHint> = {
  ask_price_1: {
    keyword: ['price', 'blue', 'T-shirt'],
    sentenceStart: 'How much ...?',
    halfPattern: 'How much ___ the blue T-shirt?',
    options: [
      'How much is the blue T-shirt?',
      'How much does the blue T-shirt cost?',
      'What is the price of the blue T-shirt?',
    ],
    fullDemo: 'How much is the blue T-shirt?',
  },
  // ... ask_price_2 ~ ask_price_10（依各任務 label 比照填寫，內容須為自然、正確的英語句型）
}
```

- 本次填 `ask_price_1` ~ `ask_price_10`（服飾店收銀台「Ask for a Price」模組，對應 `scenes.ts` 該模組的 10 個任務 label）。每筆都要 5 階完整內容，品質比照上方 `ask_price_1` 範例。
- 其他任務查無資料 → BigScreen 底部橫條顯示「此任務尚無提示」。

### 型別 — `frontend/src/types/vrm.ts`

新增 `HintLevel`、`TaskHint` 的 re-export（或直接定義在 `taskHints.ts`，由 BigScreen / HostSession import）。決定：型別定義放 `taskHints.ts`，其他檔案從那裡 import，與 `scenes.ts` 一致風格。

### 訊息層 — `BigScreenMsg`（`BigScreen.tsx`）

```ts
export interface BigScreenMsg {
  type: ... | 'hint-change'
  // 既有欄位 ...
  /** For 'hint-change' */
  hintEnabled?: boolean
  hintLevel?: HintLevel | null
}
```

### HostSession (`components/HostSession.tsx`)

新增 state：

```ts
const [hintEnabled, setHintEnabled] = useState<boolean>(() => {
  try { return JSON.parse(sessionStorage.getItem('bigscreen-hintEnabled') ?? 'false') } catch { return false }
})
const [hintLevel, setHintLevel] = useState<HintLevel | null>(() => {
  try { return JSON.parse(sessionStorage.getItem('bigscreen-hintLevel') ?? 'null') } catch { return null }
})
```

- **持久化**：在既有的 sessionStorage sync `useEffect`（與 scene/tasks/slots 同一處）加上 `bigscreen-hintEnabled`、`bigscreen-hintLevel`。
- **廣播**：在既有 BroadcastChannel sync `useEffect` 加上一條 `{ type: 'hint-change', hintEnabled, hintLevel }`；`hintEnabled` / `hintLevel` 改變時也即時 `ch.postMessage`（與 `task-change` 等模式一致）。
- **任務推進重置**：在既有監看 `selectedTasks` 的 `useEffect` 裡，偵測「第一個未完成任務 id」變化 → `setHintLevel(null)`。需用 ref 記住上一次的 currentTaskId 來比對。
  - 邊界：任務全部完成（沒有 currentTask）也視為變化 → `hintLevel = null`。
- **UI — hs-task-banner 開關**：在 `hs-task-banner` 內（顯示當前任務的那條）加一顆按鈕，樣式比照既有 `hs-action-btn` 的 on/off 風格（或自訂小 pill），點擊 `setHintEnabled(v => !v)`。任務全部完成那條 banner（`hs-task-banner--done`）也保留此開關。
- **UI — 提示控制欄與版面**：`hintEnabled` 為 true 時，在 `hs-video-area` 內 render 一個 `.hs-hint-panel`，固定寬度，**docked 在 hs-video-area 的右側**：
  - 作法：`hintEnabled` 時 `.hs-video-area` 改為 `flex-direction: row`，左半是原本的 `[task-banner → preview-pane(若開) → grid]`（包成一個 `flex:1` column 容器），右半是 `.hs-hint-panel`。如此「提示欄在大屏預覽右側」自然成立（預覽沒開時提示欄就在影片牆右側）。
  - `.hs-hint-panel` 內容：當前任務 label、6 顆按鈕（① keyword / ② sentenceStart / ③ halfPattern / ④ options / ⑤ fullDemo / ✕ 不顯示），active 那顆高亮；下方顯示選定階的內容（若 `hintLevel === null` 顯示「未顯示提示」文字）。
  - 沒有當前任務、`selectedTasks` 為空、或 `TASK_HINTS[currentTaskId]` 不存在 → 顯示對應 placeholder（6 顆階層按鈕停用，「✕ 不顯示」可保留）。

### BigScreen (`components/BigScreen.tsx`)

新增 state（從 sessionStorage 還原）：

```ts
const [hintEnabled, setHintEnabled] = useState<boolean>(/* read bigscreen-hintEnabled */)
const [hintLevel, setHintLevel] = useState<HintLevel | null>(/* read bigscreen-hintLevel */)
```

- BroadcastChannel `onmessage` 處理 `case 'hint-change'`：`setHintEnabled(msg.hintEnabled ?? false); setHintLevel(msg.hintLevel ?? null)`。
- 當前任務沿用既有 `activeTasks.find(t => !t.completed)`。
- **底部橫條 `.bs-hint-bar`**：當 `hintEnabled && hintLevel && currentTask` 時 render，固定在 BigScreen 畫面底部：
  - 取 `TASK_HINTS[currentTask.id]`：
    - 不存在 → 橫條顯示「此任務尚無提示」；
    - 存在 → 顯示「階層標籤 + 內容」。內容依 `hintLevel`：
      - `keyword`：chips 列表（join 或逐個 span）；
      - `sentenceStart` / `halfPattern` / `fullDemo`：單行文字（等寬字體呈現句型）；
      - `options`：條列 2~3 句。
  - 不需要動到 canvas 錄影那邊（`.bs-hint-bar` 是 DOM overlay，與既有的 `bigscreen-current-task-label` 一樣是 DOM 層；canvas 內的任務文字維持原樣，不畫提示）。

### 樣式 — `App.css`

- `.hs-hint-panel`：固定寬度（比照 `.hs-grid--with-preview` 風格），垂直排版，橘色邊框主題（沿用 `--primary` 色系）。
- `.hs-hint-panel` 的按鈕列：6 顆小按鈕，active 高亮。
- `.bs-hint-bar`：絕對定位 `bottom: 0`，半透明深色背景、上緣橘色細線，字大（投影可讀），置中或靠左。
- hs-task-banner 內的開關按鈕樣式。

---

## 元件邊界

| 單元 | 職責 | 對外介面 | 依賴 |
|---|---|---|---|
| `taskHints.ts` | 提供任務 id → 5 階提示資料、型別 | `TASK_HINTS`、`HintLevel`、`TaskHint` | 無 |
| HostSession 提示控制欄 | 老師選階 / 開關 / 檢視 | 透過 `setHintEnabled` / `setHintLevel`，最終走 sessionStorage + BroadcastChannel | `taskHints`、當前任務（`selectedTasks`） |
| BigScreen `.bs-hint-bar` | 顯示選定階內容給學生 | 讀 `hintEnabled` / `hintLevel`（來自訊息）+ `activeTasks` | `taskHints` |
| `hint-change` 訊息 | HostSession → BigScreen 狀態同步 | `{ type, hintEnabled, hintLevel }` | 既有 BroadcastChannel 機制 |

---

## 邊界情況

- `hintEnabled = true` 但 `hintLevel = null` → 大屏底部橫條不顯示；控制欄顯示「未顯示提示」。
- 當前任務無 `TASK_HINTS` 條目 → 大屏橫條顯示「此任務尚無提示」；控制欄按鈕停用、顯示同樣文字。
- 所有任務完成（無 currentTask）→ 視為任務推進 → `hintLevel = null`；大屏橫條不顯示。
- 沒有選任何任務（`selectedTasks` 空）→ 控制欄顯示「尚未選擇任務」；大屏橫條不顯示。
- BigScreen 開窗時：從 sessionStorage 還原 `hintEnabled` / `hintLevel`，與 scene/tasks 還原同一時機。

---

## 不在範圍內（YAGNI）

- 自動偵測學生說對答案 → 不做（老師手動推進任務）。
- 逐階累加揭露、計時顯示、提示使用統計 → 不做。
- 其他場景 / 模組的提示內容 → 之後再補，本次只做 `ask_price_1`~`10`。
- 把提示文字畫進 canvas 錄影 → 不做（橫條是 DOM overlay）。

---

## 測試方式

手動驗證（前端 UI 功能）：

1. 開 HostSession → hs-task-banner 出現「任務提示」開關，預設 OFF。
2. 選「Ask for a Price」模組數個任務 → 開預覽 + 開「任務提示」→ 右側出現控制欄。
3. 點 ①~⑤ → 大屏預覽底部橫條依序顯示關鍵字 / 句首 / 半句型 / 選項 / 示範。
4. 點「✕ 不顯示」→ 底部橫條消失。
5. 把當前任務打勾完成 → 橫條自動消失（hintLevel 重置），控制欄當前任務更新為下一題。
6. 切到沒有提示資料的模組任務 → 控制欄與橫條顯示「此任務尚無提示」。
7. 開實體大屏視窗（`/?screen=bigscreen`）→ 還原 hintEnabled / hintLevel，底部橫條狀態一致。
8. `npx tsc --noEmit` 通過。
