# Task Hints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 老師可在 HostSession 對「當前任務」顯示 5 階語言鷹架提示（關鍵字 / 句首 / 半句型 / 選項引導 / 完整示範），學生在 BigScreen 底部橫條看到選定那一階。

**Architecture:** 新增純資料檔 `config/taskHints.ts`（任務 id → 5 階提示 + 階層元資料）。HostSession 持有 `hintEnabled` / `hintLevel` 狀態 → sessionStorage 持久化 + 透過既有 BroadcastChannel 發 `hint-change` 訊息給 BigScreen。HostSession 在 `hs-task-banner` 加開關、在 `hs-video-area` 右側加控制欄（含 5 階按鈕 + 內容檢視）。BigScreen 收訊息 → 在畫面底部 render `.bs-hint-bar`。當前任務沿用既有 `activeTasks` 第一個未完成的；當它改變時 HostSession 把 `hintLevel` 重設為 `null`（初始不提示）。

**Tech Stack:** React + TypeScript（Vite）、BroadcastChannel、sessionStorage、CSS。本專案 frontend 無自動化測試 runner，驗證方式為 `npx tsc --noEmit` + 手動操作（與既有 specs 一致）。

**Spec:** `docs/superpowers/specs/2026-05-11-task-hints-design.md`

---

## File Structure

| 檔案 | 動作 | 責任 |
|---|---|---|
| `frontend/src/config/taskHints.ts` | 建立 | 型別 `HintLevel`、`TaskHint`；`TASK_HINTS`（ask_price_1~10 完整內容）；`HINT_LEVELS`（有序的階層元資料：num + 中文標籤） |
| `frontend/src/components/BigScreen.tsx` | 修改 | `BigScreenMsg` 加 `hint-change` 欄位；新增 `hintEnabled`/`hintLevel` 狀態（sessionStorage 還原）；onmessage 加 `hint-change` case；render `.bs-hint-bar` |
| `frontend/src/components/HostSession.tsx` | 修改 | 新增 `hintEnabled`/`hintLevel` 狀態；sessionStorage 持久化；`broadcastHintChange` helper；當前任務變更時重設 `hintLevel`；`hs-task-banner` 加開關；`hs-video-area` 重排版 + `.hs-hint-panel` 控制欄；`openBigScreen`/`syncBigScreenState` 帶上 hint 狀態 |
| `frontend/src/App.css` | 修改 | `.hs-hint-panel`、`.hs-hint-panel` 內按鈕、版面 `.hs-video-body(--with-hint)` / `.hs-video-main`、`.bs-hint-bar`、hs-task-banner 開關按鈕樣式 |

`taskHints.ts` 是唯一新檔，職責單一（提示資料 + 元資料）。BigScreen 與 HostSession 都 import 它。`BigScreenMsg` 仍留在 `BigScreen.tsx`（既有慣例），但會 `import type { HintLevel } from '../config/taskHints'`。

---

## Task 1: 建立 `config/taskHints.ts`（型別 + 階層元資料 + 10 題內容）

**Files:**
- Create: `frontend/src/config/taskHints.ts`

任務 label 對照（取自 `frontend/src/config/scenes.ts` 的 `ask_price` 模組）：
- `ask_price_1` Ask for the price of a blue T-shirt.
- `ask_price_2` Ask for the price of a black jacket.
- `ask_price_3` Ask for the price of the red skirt.
- `ask_price_4` Ask how much the white shirt is.
- `ask_price_5` Ask how much the pants are.
- `ask_price_6` Ask for the total price of two items.
- `ask_price_7` Ask whether this is the final price.
- `ask_price_8` Ask whether the displayed price is correct.
- `ask_price_9` Ask how much the item costs after the discount.
- `ask_price_10` Ask which item is cheaper.

- [ ] **Step 1: 寫檔**

```ts
// frontend/src/config/taskHints.ts
// ─────────────────────────────────────────────────────────────────────────────
// Task Hints — 5-level scaffolding prompts for teaching tasks.
//   key = TaskItem.id (見 scenes.ts)。查無 key → BigScreen 顯示「此任務尚無提示」。
//   本檔目前只覆蓋服飾店收銀台「Ask for a Price」模組（ask_price_1~10）。
// ─────────────────────────────────────────────────────────────────────────────

export type HintLevel = 'keyword' | 'sentenceStart' | 'halfPattern' | 'options' | 'fullDemo'

export interface TaskHint {
  /** ① 關鍵字 chips */
  keyword: string[]
  /** ② 句首提示，例如 "How much ...?" */
  sentenceStart: string
  /** ③ 半句型，用 ___ 表示要填的空格 */
  halfPattern: string
  /** ④ 選項引導：2~3 個完整句子讓學生選 */
  options: string[]
  /** ⑤ 完整示範 */
  fullDemo: string
}

/** 有序的階層元資料 —— HostSession 按鈕列與 BigScreen 標籤都用這個 */
export const HINT_LEVELS: ReadonlyArray<{ level: HintLevel; num: string; label: string }> = [
  { level: 'keyword',       num: '①', label: '關鍵字' },
  { level: 'sentenceStart', num: '②', label: '句首提示' },
  { level: 'halfPattern',   num: '③', label: '半句型提示' },
  { level: 'options',       num: '④', label: '選項引導' },
  { level: 'fullDemo',      num: '⑤', label: '完整示範' },
]

export function hintLevelMeta(level: HintLevel) {
  return HINT_LEVELS.find(l => l.level === level)!
}

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
  ask_price_2: {
    keyword: ['price', 'black', 'jacket'],
    sentenceStart: 'How much ...?',
    halfPattern: 'How much ___ the black jacket?',
    options: [
      'How much is the black jacket?',
      'How much does the black jacket cost?',
      'What is the price of the black jacket?',
    ],
    fullDemo: 'How much is the black jacket?',
  },
  ask_price_3: {
    keyword: ['price', 'red', 'skirt'],
    sentenceStart: 'How much ...?',
    halfPattern: 'How much ___ the red skirt?',
    options: [
      'How much is the red skirt?',
      'How much does the red skirt cost?',
      'What is the price of the red skirt?',
    ],
    fullDemo: 'How much is the red skirt?',
  },
  ask_price_4: {
    keyword: ['how much', 'white', 'shirt'],
    sentenceStart: 'How much ...?',
    halfPattern: 'How much ___ the white shirt?',
    options: [
      'How much is the white shirt?',
      'How much does the white shirt cost?',
      'Could you tell me how much the white shirt is?',
    ],
    fullDemo: 'How much is the white shirt?',
  },
  ask_price_5: {
    keyword: ['how much', 'pants'],
    sentenceStart: 'How much ...?',
    halfPattern: 'How much ___ the pants?',
    options: [
      'How much are the pants?',
      'How much do the pants cost?',
      'Could you tell me how much the pants are?',
    ],
    fullDemo: 'How much are the pants?',
  },
  ask_price_6: {
    keyword: ['total', 'price', 'two items'],
    sentenceStart: 'How much ...?',
    halfPattern: 'How much ___ these two items together?',
    options: [
      'How much are these two items in total?',
      'What is the total price for these two items?',
      'How much do these two items cost together?',
    ],
    fullDemo: 'How much are these two items in total?',
  },
  ask_price_7: {
    keyword: ['final', 'price'],
    sentenceStart: 'Is this ...?',
    halfPattern: 'Is this ___ the final price?',
    options: [
      'Is this the final price?',
      'Is that your final price?',
      'Is this price final?',
    ],
    fullDemo: 'Is this the final price?',
  },
  ask_price_8: {
    keyword: ['price', 'correct', 'right'],
    sentenceStart: 'Is the price ...?',
    halfPattern: 'Is the ___ price correct?',
    options: [
      'Is the displayed price correct?',
      'Is this price right?',
      'Is the price on the tag correct?',
    ],
    fullDemo: 'Is the displayed price correct?',
  },
  ask_price_9: {
    keyword: ['how much', 'after', 'discount'],
    sentenceStart: 'How much ...?',
    halfPattern: 'How much ___ it after the discount?',
    options: [
      'How much is it after the discount?',
      'How much does it cost after the discount?',
      'What is the price after the discount?',
    ],
    fullDemo: 'How much is it after the discount?',
  },
  ask_price_10: {
    keyword: ['which', 'cheaper'],
    sentenceStart: 'Which one ...?',
    halfPattern: 'Which one ___ cheaper?',
    options: [
      'Which one is cheaper?',
      'Which item is cheaper?',
      'Which of these is cheaper?',
    ],
    fullDemo: 'Which one is cheaper?',
  },
}
```

- [ ] **Step 2: 型別檢查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 無錯誤（新檔尚未被 import，純粹確認語法正確）

- [ ] **Step 3: Commit**

```bash
git add frontend/src/config/taskHints.ts
git commit -m "feat: add task hints data + types (ask_price module)"
```

---

## Task 2: `BigScreenMsg` 加 `hint-change` 欄位

**Files:**
- Modify: `frontend/src/components/BigScreen.tsx`（檔首 import 區 + `BigScreenMsg` interface，約 line 1–33）

- [ ] **Step 1: 加 import**

在 `frontend/src/components/BigScreen.tsx` 檔首 import 區（`import { getRecordings } from '../api.ts';` 之後）加：

```ts
import { TASK_HINTS, HINT_LEVELS, hintLevelMeta } from '../config/taskHints.ts';
import type { HintLevel, TaskHint } from '../config/taskHints.ts';
```

- [ ] **Step 2: 擴充 `BigScreenMsg`**

把 `BigScreen.tsx` 的 `BigScreenMsg`（約 line 17–33）的 `type` union 加上 `'hint-change'`，並在 interface 尾端加兩個欄位：

```ts
export interface BigScreenMsg {
  type: 'pose' | 'leave' | 'scene-change' | 'vrm-change' | 'vrm-identity-change' | 'slot-assign' | 'task-change' | 'recording-start' | 'recording-stop' | 'settlement-done' | 'hint-change';
  identity?: string;
  poseData?: unknown;
  sceneId?: string;
  vrmSourceId?: string;
  vrmUrl?: string;
  slotId?: string;
  tasks?: TaskEntry[];
  sessionId?: string;
  /** For 'hint-change': 是否啟用提示欄 */
  hintEnabled?: boolean;
  /** For 'hint-change': 目前顯示的階層（null = 不顯示任何階） */
  hintLevel?: HintLevel | null;
}
```

（注意：`vrm.ts` 的另一份 `BigScreenMsg`-like 結構 —— 確認後發現 `frontend/src/types/vrm.ts` line 18 的那個 union 是<strong>另一個無關的型別</strong>，不需動。本步只改 `BigScreen.tsx` 內的 `BigScreenMsg`。）

- [ ] **Step 3: 型別檢查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 可能會出現 `TaskHint` / `hintLevelMeta` 等「已宣告未使用」的 warning（視 tsconfig 而定）—— 若 tsconfig 把未使用 import 當 error，先把這幾個尚未用到的 import 留到後面 Task 才加；否則通過即可。

實作備註：若 `noUnusedLocals` 開啟導致報錯，把 Step 1 的 import 拆成「本 Task 只 import `HintLevel`」，其餘（`TASK_HINTS` / `HINT_LEVELS` / `hintLevelMeta` / `TaskHint`）延到 Task 3 一起加。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/BigScreen.tsx
git commit -m "feat: add hint-change to BigScreenMsg"
```

---

## Task 3: BigScreen — hint 狀態 + onmessage + 底部橫條

**Files:**
- Modify: `frontend/src/components/BigScreen.tsx`（狀態區約 line 160 附近、onmessage 約 line 931 附近、JSX return 約 line 1082 附近）

- [ ] **Step 1: 加狀態（在 `activeTasks` 的 `useState` 之後，約 line 164 後）**

```ts
const [hintEnabled, setHintEnabled] = useState<boolean>(() => {
  try { return JSON.parse(sessionStorage.getItem('bigscreen-hintEnabled') ?? 'false'); } catch { return false; }
});
const [hintLevel, setHintLevel] = useState<HintLevel | null>(() => {
  try { return JSON.parse(sessionStorage.getItem('bigscreen-hintLevel') ?? 'null'); } catch { return null; }
});
```

- [ ] **Step 2: onmessage 加 case（在 `else if (msg.type === 'task-change')` 區塊之後，約 line 934 後）**

```ts
      } else if (msg.type === 'hint-change') {
        const en = msg.hintEnabled ?? false;
        const lv = msg.hintLevel ?? null;
        setHintEnabled(en);
        setHintLevel(lv);
        sessionStorage.setItem('bigscreen-hintEnabled', JSON.stringify(en));
        sessionStorage.setItem('bigscreen-hintLevel', JSON.stringify(lv));
```

- [ ] **Step 3: 在 JSX 加底部橫條（在 `activeTasks.length > 0 && (() => { ... })()` 區塊之後、`{/* Settlement overlay on BigScreen */}` 之前，約 line 1083）**

```tsx
      {/* Bottom hint bar — 顯示當前任務選定階的提示 */}
      {hintEnabled && hintLevel && currentTaskId && (() => {
        const hint = TASK_HINTS[currentTaskId];
        const meta = hintLevelMeta(hintLevel);
        return (
          <div className="bs-hint-bar">
            <span className="bs-hint-bar-tag">{meta.num} {meta.label}</span>
            <span className="bs-hint-bar-content">
              {!hint ? (
                <span className="bs-hint-empty">此任務尚無提示</span>
              ) : hintLevel === 'keyword' ? (
                hint.keyword.map((w, i) => <span key={i} className="bs-hint-chip">{w}</span>)
              ) : hintLevel === 'options' ? (
                hint.options.map((o, i) => (
                  <span key={i} className="bs-hint-opt"><b>{i + 1}.</b> {o}</span>
                ))
              ) : (
                <span className="bs-hint-line">{hint[hintLevel]}</span>
              )}
            </span>
          </div>
        );
      })()}
```

備註：`hint[hintLevel]` 在 `hintLevel` 為 `'sentenceStart' | 'halfPattern' | 'fullDemo'` 時是 `string`；TS 會把 `hint[hintLevel]` 推成 `string | string[]`，若報錯就改寫成明確分支：`hintLevel === 'sentenceStart' ? hint.sentenceStart : hintLevel === 'halfPattern' ? hint.halfPattern : hint.fullDemo`。

- [ ] **Step 4: 型別檢查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 通過（若 `hint[hintLevel]` 報 union 型別錯，照 Step 3 備註改成明確分支）

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/BigScreen.tsx
git commit -m "feat: BigScreen hint state + bottom hint bar"
```

---

## Task 4: HostSession — hint 狀態 + 持久化 + 廣播 helper

**Files:**
- Modify: `frontend/src/components/HostSession.tsx`（檔首 import、狀態區約 line 115 附近、broadcast helper 區約 line 303 附近、sessionStorage sync `useEffect` 約 line 850 附近、`syncBigScreenState` 約 line 861 附近、`openBigScreen` 約 line 841 附近）

- [ ] **Step 1: 加 import（檔首，`import { decodePoseFrame, createPoseDecodePool } from '../utils/poseCodec.ts';` 附近）**

```ts
import { TASK_HINTS, HINT_LEVELS, hintLevelMeta } from '../config/taskHints.ts';
import type { HintLevel } from '../config/taskHints.ts';
```

- [ ] **Step 2: 加狀態（在 `lowPowerMode` 的 `useState` 之後，約 line 117 後）**

```ts
const [hintEnabled, setHintEnabled] = useState<boolean>(() => {
  try { return JSON.parse(sessionStorage.getItem('bigscreen-hintEnabled') ?? 'false'); } catch { return false; }
});
const [hintLevel, setHintLevel] = useState<HintLevel | null>(() => {
  try { return JSON.parse(sessionStorage.getItem('bigscreen-hintLevel') ?? 'null'); } catch { return null; }
});
```

- [ ] **Step 3: 加廣播 helper（在 `broadcastTaskChange` 之後，約 line 307 後）**

```ts
const broadcastHintChange = useCallback((enabled: boolean, level: HintLevel | null) => {
  sessionStorage.setItem('bigscreen-hintEnabled', JSON.stringify(enabled));
  sessionStorage.setItem('bigscreen-hintLevel', JSON.stringify(level));
  const msg: BigScreenMsg = { type: 'hint-change', hintEnabled: enabled, hintLevel: level };
  channelRef.current?.postMessage(msg);
}, []);

const setHint = useCallback((level: HintLevel | null) => {
  setHintLevel(level);
  broadcastHintChange(hintEnabled, level);
}, [hintEnabled, broadcastHintChange]);

const toggleHintEnabled = useCallback(() => {
  setHintEnabled(prev => {
    const next = !prev;
    broadcastHintChange(next, next ? hintLevel : null);
    if (!next) setHintLevel(null); // 關掉時一併清掉選定階
    return next;
  });
}, [hintLevel, broadcastHintChange]);
```

- [ ] **Step 4: sessionStorage sync — `openBigScreen` 帶上 hint 狀態（約 line 851，`sessionStorage.setItem('bigscreen-tasks', ...)` 之後加）**

```ts
      sessionStorage.setItem('bigscreen-hintEnabled', JSON.stringify(hintEnabled));
      sessionStorage.setItem('bigscreen-hintLevel', JSON.stringify(hintLevel));
```

同時把 `openBigScreen` 的 `useCallback` 依賴陣列（約 line 857）加上 `hintEnabled, hintLevel`。

- [ ] **Step 5: `syncBigScreenState` 帶上 hint 狀態（約 line 865，`ch.postMessage({ type: 'task-change', ... })` 之後加）**

```ts
    ch.postMessage({ type: 'hint-change', hintEnabled, hintLevel } satisfies BigScreenMsg);
```

把 `syncBigScreenState` 的 `useCallback` 依賴陣列（約 line 878）加上 `hintEnabled, hintLevel`。

- [ ] **Step 6: 型別檢查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 可能出現 `setHint` / `toggleHintEnabled` / `TASK_HINTS` / `HINT_LEVELS` / `hintLevelMeta` 未使用 warning（後續 Task 會用到）。若 tsconfig 將未使用變數視為 error，把這幾個的宣告/import 延到 Task 6、7 再加，本 Task 只加 `hintEnabled` / `hintLevel` / `broadcastHintChange` 及 Step 4/5 的同步。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/HostSession.tsx
git commit -m "feat: HostSession hint state + persistence + broadcast"
```

---

## Task 5: HostSession — 當前任務改變時重設 `hintLevel`

**Files:**
- Modify: `frontend/src/components/HostSession.tsx`（新增一個 `useEffect`，放在 `currentTaskIndex` 計算附近 / 任何能讀到 `selectedTasks` 與 `setHint` 的位置；建議放在既有監看 `selectedTasks` 的 `useEffect` 群附近，約 line 261 之後）

- [ ] **Step 1: 加 ref + effect**

在 HostSession 元件內、`selectedTasks` 宣告之後（約 line 227 後）加：

```ts
const prevCurrentTaskIdRef = useRef<string | undefined>(undefined);
```

然後在 broadcast helper 定義之後（Task 4 的 `setHint` 已存在），加一個 effect：

```ts
// 當「第一個未完成任務」改變（含全完成 → undefined）時，把提示重設為「不顯示」
useEffect(() => {
  const currentId = selectedTasks.find(t => !t.completed)?.id;
  if (prevCurrentTaskIdRef.current === undefined && currentId !== undefined) {
    // 初次掛載 / 初次有任務：只記錄，不動 hintLevel（保留 sessionStorage 還原值）
    prevCurrentTaskIdRef.current = currentId;
    return;
  }
  if (currentId !== prevCurrentTaskIdRef.current) {
    prevCurrentTaskIdRef.current = currentId;
    if (hintLevel !== null) setHint(null);
  }
}, [selectedTasks, hintLevel, setHint]);
```

- [ ] **Step 2: 型別檢查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 通過

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/HostSession.tsx
git commit -m "feat: reset hint level when current task advances"
```

---

## Task 6: HostSession — `hs-task-banner` 上的開關按鈕

**Files:**
- Modify: `frontend/src/components/HostSession.tsx`（`hs-task-banner` 的 JSX，約 line 1270–1297）

- [ ] **Step 1: 在 banner 文字後加開關按鈕**

把 `hs-task-banner` 內 `hs-task-banner-text` 的兩個分支（`allDone` 與否）各加一顆按鈕。最簡潔做法：在 `<div className="hs-task-banner-text">…</div>` 之後、`hs-task-banner` 這個外層 div 關閉之前，無條件加一顆按鈕（兩種狀態共用）：

找到（約 line 1275–1296）：

```tsx
              <div className={`hs-task-banner ${allDone ? 'hs-task-banner--done' : ''}`}>
                <div className="hs-task-banner-bar">
                  <div className="hs-task-banner-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="hs-task-banner-text">
                  {allDone ? (
                    ...
                  ) : (
                    ...
                  )}
                </div>
              </div>
```

改成在 `</div>`（`hs-task-banner-text`）之後加：

```tsx
                </div>
                <button
                  className={`hs-hint-toggle ${hintEnabled ? 'is-on' : ''}`}
                  onClick={(e) => { e.stopPropagation(); toggleHintEnabled(); }}
                  title={hintEnabled ? '關閉任務提示' : '開啟任務提示'}
                >
                  <span className="material-symbols-outlined">lightbulb</span>
                  <span className="hs-hint-toggle-label">任務提示</span>
                  <span className="hs-hint-toggle-badge">{hintEnabled ? 'ON' : 'OFF'}</span>
                </button>
              </div>
```

（即在原 `hs-task-banner` 外層 div 的最後一個子元素位置插入該 `<button>`。）

- [ ] **Step 2: 型別檢查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 通過

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/HostSession.tsx
git commit -m "feat: task-hint toggle button on hs-task-banner"
```

---

## Task 7: HostSession — `.hs-hint-panel` 控制欄 + 版面重排

**Files:**
- Modify: `frontend/src/components/HostSession.tsx`（`hs-video-area` 區塊，約 line 1267–1374）

- [ ] **Step 1: 重排 `hs-video-area`，把 preview + grid 包進 `.hs-video-main`，右側加 `.hs-hint-panel`**

找到（約 line 1267）：

```tsx
        {/* ── Video Area ────────────────────────────────────────────────────── */}
        <div className="hs-video-area">

          {/* Task banner strip */}
          {selectedTasks.length > 0 && (() => { ... })()}

          {/* BigScreen embedded preview */}
          {showBigScreenPreview && (
            <div className="hs-preview-pane">...</div>
          )}

          {/* Video grid */}
          <div className={`hs-grid ${showBigScreenPreview ? 'hs-grid--with-preview' : ''}`}>
            {/* teacher card + student tiles */}
          </div>
        </div>
```

改成（保留 task banner 在最上方全寬；把 preview-pane + grid 包進 `.hs-video-main`；其後條件 render `.hs-hint-panel`；外層 `hs-video-area` 加狀態 class）：

```tsx
        {/* ── Video Area ────────────────────────────────────────────────────── */}
        <div className={`hs-video-area ${hintEnabled ? 'hs-video-area--with-hint' : ''}`}>

          {/* Task banner strip（含任務提示開關） */}
          {selectedTasks.length > 0 && (() => { /* 原內容不動 */ })()}

          <div className="hs-video-body">
            <div className="hs-video-main">
              {/* BigScreen embedded preview */}
              {showBigScreenPreview && (
                <div className="hs-preview-pane">{/* 原內容不動 */}</div>
              )}

              {/* Video grid */}
              <div className={`hs-grid ${showBigScreenPreview ? 'hs-grid--with-preview' : ''}`}>
                {/* teacher card + student tiles —— 原內容不動 */}
              </div>
            </div>

            {hintEnabled && (() => {
              const currentTask = selectedTasks.find(t => !t.completed);
              const hint = currentTask ? TASK_HINTS[currentTask.id] : undefined;
              const renderLevelContent = (lv: HintLevel) => {
                if (!hint) return null;
                if (lv === 'keyword') return <div className="hs-hint-chips">{hint.keyword.map((w, i) => <span key={i} className="hs-hint-chip">{w}</span>)}</div>;
                if (lv === 'options') return <ol className="hs-hint-opts">{hint.options.map((o, i) => <li key={i}>{o}</li>)}</ol>;
                const text = lv === 'sentenceStart' ? hint.sentenceStart : lv === 'halfPattern' ? hint.halfPattern : hint.fullDemo;
                return <div className="hs-hint-line">{text}</div>;
              };
              return (
                <div className="hs-hint-panel">
                  <div className="hs-hint-panel-header">
                    <span className="material-symbols-outlined">lightbulb</span>
                    <span>任務提示</span>
                  </div>
                  <div className="hs-hint-panel-task">
                    {selectedTasks.length === 0 ? '尚未選擇任務'
                      : !currentTask ? '所有任務已完成'
                      : currentTask.label}
                  </div>
                  <div className="hs-hint-levels">
                    {HINT_LEVELS.map(({ level, num, label }) => (
                      <button
                        key={level}
                        className={`hs-hint-level-btn ${hintLevel === level ? 'is-active' : ''}`}
                        disabled={!currentTask || !hint}
                        onClick={() => setHint(level)}
                      >{num}{label}</button>
                    ))}
                    <button
                      className={`hs-hint-level-btn hs-hint-level-btn--none ${hintLevel === null ? 'is-active' : ''}`}
                      onClick={() => setHint(null)}
                    >✕ 不顯示</button>
                  </div>
                  <div className="hs-hint-panel-body">
                    {!currentTask ? (
                      <div className="hs-hint-placeholder">{selectedTasks.length === 0 ? '請先在「任務」面板選擇任務' : '所有任務已完成'}</div>
                    ) : !hint ? (
                      <div className="hs-hint-placeholder">此任務尚無提示資料</div>
                    ) : hintLevel === null ? (
                      <div className="hs-hint-placeholder">目前未顯示提示。點上方階層按鈕讓學生大屏顯示。</div>
                    ) : (
                      <div className="hs-hint-active">
                        <div className="hs-hint-active-tag">{hintLevelMeta(hintLevel).num} {hintLevelMeta(hintLevel).label}（學生大屏顯示中）</div>
                        {renderLevelContent(hintLevel)}
                      </div>
                    )}
                    {/* 老師參考：列出其他階內容 */}
                    {hint && currentTask && (
                      <div className="hs-hint-allref">
                        {HINT_LEVELS.filter(l => l.level !== hintLevel).map(({ level, num, label }) => (
                          <div key={level} className="hs-hint-ref-row">
                            <span className="hs-hint-ref-tag">{num}{label}</span>
                            <span className="hs-hint-ref-content">{renderLevelContent(level)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
```

- [ ] **Step 2: 型別檢查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 通過（若 `renderLevelContent` 在 `hint` 為 undefined 的分支被呼叫到，TS 可能抱怨 —— 上面已用 `if (!hint) return null;` 防護；確保所有呼叫點都在 `hint` 已存在的條件內）

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/HostSession.tsx
git commit -m "feat: HostSession hint control panel + layout"
```

---

## Task 8: `App.css` — 樣式

**Files:**
- Modify: `frontend/src/App.css`

- [ ] **Step 1: 加版面與面板樣式（建議放在 `.hs-video-area` 相關規則附近，約 line 3945 之後；以及 `.hs-grid` 規則附近）**

```css
/* ── Task Hint: layout when hint panel is open ─────────────────────────── */
.hs-video-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.hs-video-area--with-hint .hs-video-body {
  flex-direction: row;
  gap: 10px;
}
.hs-video-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* ── Task Hint: toggle button on hs-task-banner ───────────────────────── */
.hs-hint-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: 10px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
  font-family: 'Nunito', inherit;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
}
.hs-hint-toggle .material-symbols-outlined { font-size: 16px; }
.hs-hint-toggle.is-on {
  background: rgba(255, 255, 255, 0.95);
  color: var(--primary, #f76e12);
  border-color: rgba(255, 255, 255, 0.95);
}
.hs-hint-toggle-badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.18);
}
.hs-hint-toggle.is-on .hs-hint-toggle-badge {
  background: rgba(247, 110, 18, 0.18);
}

/* ── Task Hint: control panel (HostSession, right of preview) ──────────── */
.hs-hint-panel {
  width: 340px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #fffaf5;
  border: 1.5px solid rgba(247, 110, 18, 0.35);
  border-radius: 14px;
  overflow: hidden;
}
.hs-hint-panel-header {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 12px;
  background: var(--primary-light2, rgba(247, 110, 18, 0.12));
  color: var(--primary, #f76e12);
  font-weight: 800;
  font-size: 14px;
  border-bottom: 1px solid rgba(247, 110, 18, 0.2);
}
.hs-hint-panel-task {
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text-dark, #482607);
  opacity: 0.85;
  border-bottom: 1px dashed rgba(247, 110, 18, 0.2);
}
.hs-hint-levels {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 12px;
}
.hs-hint-level-btn {
  font-family: 'Nunito', inherit;
  font-size: 11px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid rgba(247, 110, 18, 0.25);
  background: #fff;
  color: var(--text-dark, #482607);
  cursor: pointer;
  transition: all 0.12s;
}
.hs-hint-level-btn:hover:not(:disabled) { background: rgba(247, 110, 18, 0.08); }
.hs-hint-level-btn.is-active {
  background: var(--primary, #f76e12);
  color: #fff;
  border-color: var(--primary, #f76e12);
}
.hs-hint-level-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.hs-hint-level-btn--none { border-style: dashed; }
.hs-hint-panel-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 12px;
  font-size: 13px;
}
.hs-hint-placeholder {
  font-size: 12px;
  opacity: 0.6;
  padding: 10px 0;
  line-height: 1.6;
}
.hs-hint-active {
  background: #fff;
  border: 1px solid rgba(247, 110, 18, 0.25);
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 12px;
}
.hs-hint-active-tag {
  font-size: 11px;
  font-weight: 800;
  color: var(--primary, #f76e12);
  margin-bottom: 6px;
}
.hs-hint-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.hs-hint-chip {
  background: var(--primary, #f76e12);
  color: #fff;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
}
.hs-hint-line { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; }
.hs-hint-opts { margin: 0; padding-left: 20px; }
.hs-hint-opts li { margin: 3px 0; }
.hs-hint-allref { border-top: 1px dashed rgba(247, 110, 18, 0.2); padding-top: 8px; }
.hs-hint-ref-row { display: flex; gap: 8px; padding: 4px 0; font-size: 12px; }
.hs-hint-ref-tag { flex-shrink: 0; font-weight: 700; opacity: 0.7; min-width: 56px; }
.hs-hint-ref-content { opacity: 0.85; }
.hs-hint-ref-content .hs-hint-chips { gap: 4px; }
.hs-hint-ref-content .hs-hint-chip { font-size: 11px; padding: 1px 7px; }
.hs-hint-ref-content .hs-hint-line { font-size: 12px; }

/* ── Task Hint: bottom bar on BigScreen ───────────────────────────────── */
.bs-hint-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 32px;
  background: rgba(20, 15, 10, 0.88);
  border-top: 2px solid var(--primary, #f76e12);
  color: #fff;
  backdrop-filter: blur(4px);
}
.bs-hint-bar-tag {
  flex-shrink: 0;
  font-size: 15px;
  font-weight: 800;
  color: #ffb347;
  white-space: nowrap;
}
.bs-hint-bar-content {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  font-size: 20px;
}
.bs-hint-bar .bs-hint-chip {
  background: var(--primary, #f76e12);
  color: #fff;
  padding: 4px 14px;
  border-radius: 999px;
  font-size: 19px;
  font-weight: 700;
}
.bs-hint-bar .bs-hint-line { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.bs-hint-bar .bs-hint-opt { margin-right: 14px; }
.bs-hint-bar .bs-hint-opt b { color: #ffb347; }
.bs-hint-bar .bs-hint-empty { opacity: 0.7; font-style: italic; }
```

- [ ] **Step 2: 型別檢查（確認 JS 沒被影響）**

Run: `cd frontend && npx tsc --noEmit`
Expected: 通過

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.css
git commit -m "feat: styles for task hint panel + bottom bar"
```

---

## Task 9: 手動驗證

**Files:** 無（純手動測試）

- [ ] **Step 1: 啟動開發環境**

```bash
docker compose up -d   # 或專案既有的啟動方式
```

開 HostSession（建立房間 → 進入課堂）。

- [ ] **Step 2: 驗證清單**

1. `hs-task-banner` 在有選任務時出現「💡 任務提示」開關，預設 OFF。
2. 在「任務」面板選「Ask for a Price」模組數個任務 → 開「大屏預覽」→ 開「任務提示」→ `hs-video-area` 右側出現 `.hs-hint-panel`，預覽 iframe 在左、面板在右。
3. 面板顯示當前任務 label + 6 顆按鈕（①關鍵字 / ②句首提示 / ③半句型提示 / ④選項引導 / ⑤完整示範 / ✕ 不顯示）+ 下方參考內容。
4. 點 ①~⑤ → 預覽 iframe（= BigScreen）底部出現 `.bs-hint-bar`，依序顯示關鍵字 chips / 句首 / 半句型 / 選項列表 / 完整示範；面板上對應按鈕高亮。
5. 點「✕ 不顯示」→ 底部橫條消失。
6. 把當前任務在 banner 打勾完成 → 橫條自動消失（hintLevel 重置為 null），面板的「當前任務」更新為下一題。
7. 切到沒有提示資料的模組任務（例如「Sizes」模組）→ 面板階層按鈕停用、body 顯示「此任務尚無提示資料」；若此時硬點不到（按鈕 disabled）橫條維持隱藏。
8. 把全部任務完成 → 面板顯示「所有任務已完成」，橫條隱藏。
9. 點「開啟大屏」開實體 BigScreen 視窗 → 還原 `hintEnabled` / `hintLevel`，底部橫條狀態與預覽一致；之後在 HostSession 切階 → 實體大屏即時同步。
10. 關掉「任務提示」開關 → `.hs-hint-panel` 與大屏橫條都消失，版面回復單欄。

- [ ] **Step 3: 型別檢查總驗**

Run: `cd frontend && npx tsc --noEmit`
Expected: 無錯誤

- [ ] **Step 4: 若以上全過，無需額外 commit（程式碼已在前面 Task 提交）。否則回到對應 Task 修正並重新 commit。**

---

## Notes / 已知限制

- 任務提示開關只在 `hs-task-banner` 上 —— 若 `selectedTasks` 為空（沒有 banner），無法切換開關；但此時提示功能本來就無意義（面板顯示「尚未選擇任務」）。
- `.bs-hint-bar` 是 DOM overlay，不畫進 canvas 錄影（與既有 `bigscreen-current-task-label` 相同處理）。
- 本次只填 `ask_price_1`~`10` 的提示內容；其他任務的提示之後再補進 `TASK_HINTS`。
