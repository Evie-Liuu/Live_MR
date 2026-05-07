# React.lazy() Code Splitting + Google Fonts 優化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將 `App.tsx` 的 7 個非首屏元件改為 `React.lazy()` 動態載入，並優化 `index.html` 的 Google Fonts 載入，降低 LCP。

**Architecture:** `RoleSelect` 維持靜態 import 作為首屏；其餘 7 個元件透過 `lazy()` 按需載入。新增 `AppSpinner`（純 CSS，重用既有 `@keyframes spin`）作為 `Suspense` fallback。`export default` 重構為 `Root` 元件以正確包裹 BigScreen/ShareScreen。

**Tech Stack:** React 18（lazy / Suspense）、TypeScript、Vite

---

## 修改檔案

- Modify: `frontend/src/App.tsx`（lazy imports + AppSpinner + Suspense + Root）
- Modify: `frontend/index.html`（preconnect + display=swap）

---

### Task 1：App.tsx — lazy imports、AppSpinner、Suspense、Root

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1：替換 import 區塊**

將檔案頂部的 import 區塊（目前第 1–12 行）整段替換為：

```typescript
import { useState, useEffect, lazy, Suspense } from 'react';
import type { AppState } from './state.ts';
import { createRoom } from './api.ts';
import RoleSelect from './components/RoleSelect.tsx';
import './App.css';

const BigScreen      = lazy(() => import('./components/BigScreen.tsx'));
const ShareScreen    = lazy(() => import('./components/ShareScreen.tsx'));
const HostLobby      = lazy(() => import('./components/HostLobby.tsx'));
const HostSession    = lazy(() => import('./components/HostSession.tsx'));
const StudentJoin    = lazy(() => import('./components/StudentJoin.tsx'));
const StudentWaiting = lazy(() => import('./components/StudentWaiting.tsx'));
const StudentSession = lazy(() => import('./components/StudentSession.tsx'));

function AppSpinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <div style={{
        width: 40,
        height: 40,
        border: '4px solid #e0e0e0',
        borderTopColor: '#1976d2',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }} />
    </div>
  );
}
```

注意：`@keyframes spin` 已存在於 `App.css:649`，不需另外新增。

- [ ] **Step 2：App() 的 return 包入 Suspense**

找到 `App()` 函式最後的 return（目前為）：

```tsx
  return <div className="app">{renderScreen()}</div>;
```

替換為：

```tsx
  return (
    <div className="app">
      <Suspense fallback={<AppSpinner />}>
        {renderScreen()}
      </Suspense>
    </div>
  );
```

- [ ] **Step 3：重構 export default 為 Root 元件**

找到檔案最後一行（目前為）：

```typescript
export default isBigScreen ? BigScreen : (isShareScreen ? ShareScreen : App);
```

替換為：

```tsx
function Root() {
  if (isBigScreen)   return <Suspense fallback={<AppSpinner />}><BigScreen /></Suspense>;
  if (isShareScreen) return <Suspense fallback={<AppSpinner />}><ShareScreen /></Suspense>;
  return <App />;
}

export default Root;
```

- [ ] **Step 4：TypeScript 確認**

```bash
cd frontend && npx tsc --noEmit
```

預期：0 錯誤。若出現 `Cannot find module` 錯誤，確認各元件的 `.tsx` 副檔名是否正確。

- [ ] **Step 5：Commit**

```bash
git add frontend/src/App.tsx
git commit -m "perf: React.lazy code splitting — 7 個元件改動態載入"
```

---

### Task 2：index.html — preconnect + display=swap

**Files:**
- Modify: `frontend/index.html`

- [ ] **Step 1：新增 preconnect hints + 加 display=swap**

找到 `index.html` 的 `<head>` 區塊中現有的兩行 Google Fonts `<link>`（目前為）：

```html
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" rel="stylesheet" />
```

替換為：

```html
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" rel="stylesheet" />
```

- [ ] **Step 2：Commit**

```bash
git add frontend/index.html
git commit -m "perf: Google Fonts preconnect + display=swap，消除字型阻塞渲染"
```

---

### Task 3：驗證

**Files:**（不修改，僅驗證）

- [ ] **Step 1：TypeScript + build 確認**

```bash
cd frontend && npm run build
```

預期：build 成功，無 TypeScript 錯誤。觀察輸出的 chunk 分割結果——應看到多個 JS chunk（BigScreen、HostSession 等各自獨立）。

- [ ] **Step 2：Dev server 啟動與功能確認**

```bash
cd frontend && npm run dev
```

確認：
1. 開啟首頁（`/`）：RoleSelect 畫面正常顯示，不出現 spinner
2. 點擊「老師」→ HostLobby 正常載入（可能短暫出現 spinner）
3. 進入 HostSession → 正常
4. 開啟 `?screen=bigscreen` → BigScreen 正常
5. 開啟 `?screen=share` → ShareScreen 正常

- [ ] **Step 3：DevTools 確認 LCP 改善**

開啟 Chrome DevTools → Lighthouse，執行 Performance 分析。
確認 LCP 相較原本 6.11s 有明顯改善（預期 1.5–2.5s）。

Network 面板確認：
- 初始載入不包含 BigScreen / HostSession chunk
- 切換到 HostLobby 時才觸發對應 chunk 下載
