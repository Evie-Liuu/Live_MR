# React.lazy() Code Splitting + Google Fonts 優化設計

**日期**：2026-05-08
**範圍**：`frontend/src/App.tsx`、`frontend/index.html`
**目標**：透過 code splitting 與 font 載入優化降低 LCP（目前 6.11s）

---

## 問題背景

`App.tsx` 靜態 import 所有 8 個元件，導致初始 JS bundle 包含 BigScreen（Three.js）、HostSession（LiveKit + MediaPipe）等重量級元件，即使用戶只看到 RoleSelect 畫面也需全部下載。

`index.html` 的兩個 Google Fonts `<link>` 沒有 preconnect 也沒有 `display=swap`，阻塞初始渲染。

---

## 設計

### 1. `App.tsx`：7 個元件改 `React.lazy()`

`RoleSelect` 維持靜態 import（首屏元件，體積小，必須立即可用）。

其餘 7 個元件改為動態載入：

```typescript
import { useState, useEffect, lazy, Suspense } from 'react';
import RoleSelect from './components/RoleSelect.tsx';

const BigScreen     = lazy(() => import('./components/BigScreen.tsx'));
const ShareScreen   = lazy(() => import('./components/ShareScreen.tsx'));
const HostLobby     = lazy(() => import('./components/HostLobby.tsx'));
const HostSession   = lazy(() => import('./components/HostSession.tsx'));
const StudentJoin   = lazy(() => import('./components/StudentJoin.tsx'));
const StudentWaiting = lazy(() => import('./components/StudentWaiting.tsx'));
const StudentSession = lazy(() => import('./components/StudentSession.tsx'));
```

### 2. `AppSpinner`：純 CSS，不依賴字型

定義在 `App.tsx` 頂層（或 `App.css`），在字型尚未載入時仍可正常顯示：

```tsx
function AppSpinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <div style={{
        width: 40, height: 40,
        border: '4px solid #e0e0e0',
        borderTopColor: '#1976d2',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }} />
    </div>
  );
}
```

`App.css` 加入 `@keyframes spin { to { transform: rotate(360deg); } }`。

### 3. `App()` 內部加 `<Suspense>` 邊界

`renderScreen()` 的回傳值包在 `<Suspense>` 內：

```tsx
return (
  <div className="app">
    <Suspense fallback={<AppSpinner />}>
      {renderScreen()}
    </Suspense>
  </div>
);
```

### 4. 重構 `export default`（第 169 行）

原本：
```typescript
export default isBigScreen ? BigScreen : (isShareScreen ? ShareScreen : App);
```

改為 `Root` 包裝元件，讓 BigScreen / ShareScreen 也受 Suspense 保護：

```tsx
function Root() {
  if (isBigScreen)   return <Suspense fallback={<AppSpinner />}><BigScreen /></Suspense>;
  if (isShareScreen) return <Suspense fallback={<AppSpinner />}><ShareScreen /></Suspense>;
  return <App />;
}

export default Root;
```

### 5. `index.html`：preconnect + `display=swap`

在現有兩個 `<link>` 之前插入 preconnect：

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
```

現有 font link 加 `&display=swap`：

```html
<link href="https://fonts.googleapis.com/icon?family=Material+Icons&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" rel="stylesheet">
```

---

## 預期效益

| 項目 | 改前 | 改後 |
|------|------|------|
| 初始 JS bundle | 含所有 8 元件 | 僅 RoleSelect + routing |
| BigScreen / HostSession | 同步載入 | 按需下載（用戶進入時）|
| Fonts 阻塞 render | 是 | 否（preconnect + swap）|
| LCP 預估 | 6.11s | 1.5–2.5s |

---

## 不在範圍內

- `RoleSelect` 不拆分（首屏元件）
- 不自架 Google Fonts（字型檔案龐大，ROI 低）
- 不修改 Vite rollupOptions（Vite 自動依 dynamic import 拆 chunk）
