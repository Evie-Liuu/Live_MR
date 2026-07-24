# 老師/學生登入身分整合 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 統一老師/學生登入入口為單一 email/password 表單，登入成功（或偵測到既有 session）後依 `user.role` 自動分流；學生新增「輸入房間 ID 或掃 QR」畫面；外部 QR/連結帶房號進站一律先要求登入。

**Architecture:** 沿用 `App.tsx` 既有的手動 state machine（`AppState` union + `switch`），不引入 router。新增一個純函式 `resolveAuthRoute(role, pendingRoomId)` 集中分流規則，開機（偵測到既有 session）與登入表單送出成功後都呼叫同一個入口 `routeUser()`。新畫面 `StudentHome` 用 `qr-scanner` 套件包出 `useQrScanner` hook 做鏡頭掃碼（不用原生 `BarcodeDetector`，因為 iPad Safari 不支援）。

**Tech Stack:** React 19 + TypeScript（現有）、`qr-scanner`（新增 npm 依賴）、Vitest（現有，純函式單元測試）。

## Global Constraints

- 後端完全不動（`backend/src/rooms.ts` / `routes.ts` / `livekit.ts` 不得修改）——這次整合只在前端做 UX 層級的登入把關，不新增後端 token 驗證邏輯。
- 不引入 React Router，沿用現有 `AppState` + `switch` 手動 state machine。
- 學生顯示名稱一律用帳號的 `full_name`（依序退回 `email` / `id` / `uid` / `'學生'`），不再手動輸入暱稱。
- 開機時「已登入就自動依 role 導向」只在應用程式**開機當下**觸發一次；使用者之後在畫面內按「離開」回到登入畫面不會被自動導回去（避免老師離開房間被瞬間彈回新建房間的迴圈）。
- 老師端 `host-lobby`/`host-session` 的「離開」行為維持現況（回登入表單，需重新輸入帳密），本次不修改。
- 學生「登出」入口只加在新的 `StudentHome` 畫面，不擴及 `StudentWaiting`/`StudentSession`。
- QR 掃描用 `qr-scanner` 套件（自動 fallback，涵蓋 iPad Safari），不用原生 `BarcodeDetector`。

---

### Task 1: 純函式 — 登入後路由分流 + QR 內容解析

**Files:**
- Modify: `frontend/src/state.ts`
- Create: `frontend/src/state.test.ts`
- Create: `frontend/src/utils/qrRoomId.ts`
- Create: `frontend/src/utils/qrRoomId.test.ts`

**Interfaces:**
- Consumes: `UserRole`（`frontend/src/hooks/useAuth.ts` 既有 export，值為 `'admin' | 'institution_admin' | 'teacher' | 'student' | 'visitor'`）
- Produces：
  - `resolveAuthRoute(role: UserRole, pendingRoomId: string | null): AuthRoute`，其中 `AuthRoute = { action: 'host' } | { action: 'auto-join'; roomId: string } | { action: 'student-home' }`（Task 3 的 `App.tsx` 會用）
  - `extractRoomId(scannedText: string): string | null`（Task 2 的 `StudentHome`/`useQrScanner` 會用）

這個 task 只新增純函式，不動 `AppState` union、不動任何畫面，App 現有行為完全不受影響。

- [ ] **Step 1: 寫 `resolveAuthRoute` 的失敗測試**

Create `frontend/src/state.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveAuthRoute } from './state'

describe('resolveAuthRoute', () => {
  it('routes teacher to host regardless of pendingRoomId', () => {
    expect(resolveAuthRoute('teacher', 'room-123')).toEqual({ action: 'host' })
    expect(resolveAuthRoute('teacher', null)).toEqual({ action: 'host' })
  })

  it('routes admin and institution_admin to host', () => {
    expect(resolveAuthRoute('admin', null)).toEqual({ action: 'host' })
    expect(resolveAuthRoute('institution_admin', null)).toEqual({ action: 'host' })
  })

  it('routes student with a pending roomId to auto-join', () => {
    expect(resolveAuthRoute('student', 'room-123')).toEqual({ action: 'auto-join', roomId: 'room-123' })
  })

  it('routes student with no pending roomId to student-home', () => {
    expect(resolveAuthRoute('student', null)).toEqual({ action: 'student-home' })
  })

  it('treats visitor the same as student', () => {
    expect(resolveAuthRoute('visitor', 'room-456')).toEqual({ action: 'auto-join', roomId: 'room-456' })
    expect(resolveAuthRoute('visitor', null)).toEqual({ action: 'student-home' })
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd frontend && npx vitest run src/state.test.ts`
Expected: FAIL — `resolveAuthRoute` is not exported by `./state`（或找不到該 export）

- [ ] **Step 3: 在 `state.ts` 新增 `resolveAuthRoute`（不動既有 `AppState`）**

在 `frontend/src/state.ts` 檔案**最後**追加（不改動檔案原本的 `AppState` 內容）：

```ts
import type { UserRole } from './hooks/useAuth.ts';

export type AuthRoute =
  | { action: 'host' }
  | { action: 'auto-join'; roomId: string }
  | { action: 'student-home' };

const STUDENT_LIKE_ROLES: ReadonlySet<UserRole> = new Set(['student', 'visitor']);

/**
 * 登入成功、或開機時偵測到既有 session 後，依 role 決定下一步畫面。
 * 老師/管理員一律走建房間流程（忽略 pendingRoomId）；學生/訪客若帶著外部連結
 * 的房號（pendingRoomId）就直接自動加入，否則進房間選擇畫面（手動輸入房號或掃 QR）。
 */
export function resolveAuthRoute(role: UserRole, pendingRoomId: string | null): AuthRoute {
  if (!STUDENT_LIKE_ROLES.has(role)) {
    return { action: 'host' };
  }
  return pendingRoomId ? { action: 'auto-join', roomId: pendingRoomId } : { action: 'student-home' };
}
```

記得在檔案最上方加上這行 import（放在既有內容的最前面）：

```ts
import type { UserRole } from './hooks/useAuth.ts';
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd frontend && npx vitest run src/state.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: 寫 `extractRoomId` 的失敗測試**

Create `frontend/src/utils/qrRoomId.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { extractRoomId } from './qrRoomId'

describe('extractRoomId', () => {
  it('extracts roomId from a join URL', () => {
    expect(extractRoomId('https://example.com/?roomId=abc-123')).toBe('abc-123')
  })

  it('extracts roomId when the URL has other query params too', () => {
    expect(extractRoomId('https://example.com/?screen=share&roomId=abc-123')).toBe('abc-123')
  })

  it('returns null for a valid URL with no roomId param', () => {
    expect(extractRoomId('https://example.com/')).toBeNull()
  })

  it('treats non-URL text as a raw room ID', () => {
    expect(extractRoomId('ROOM-4567')).toBe('ROOM-4567')
  })

  it('returns null for empty/whitespace input', () => {
    expect(extractRoomId('   ')).toBeNull()
    expect(extractRoomId('')).toBeNull()
  })
})
```

- [ ] **Step 6: 執行測試確認失敗**

Run: `cd frontend && npx vitest run src/utils/qrRoomId.test.ts`
Expected: FAIL — 找不到 `frontend/src/utils/qrRoomId.ts` 模組

- [ ] **Step 7: 實作 `extractRoomId`**

Create `frontend/src/utils/qrRoomId.ts`:

```ts
/**
 * 從掃描到的 QR 內容抽出房間 ID。
 * 先嘗試當作網址解析出 `roomId` 查詢參數（對應 HostLobby/ShareScreen 產生的加入連結）；
 * 不是合法網址時，把整段文字當作房號本身（相容「QR 裡直接放房號」的情況）。
 * 是合法網址卻沒有 roomId 參數，或內容整個是空白，視為無法辨識，回傳 null。
 */
export function extractRoomId(scannedText: string): string | null {
  const trimmed = scannedText.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    const roomId = url.searchParams.get('roomId');
    return roomId ? roomId : null;
  } catch {
    return trimmed;
  }
}
```

- [ ] **Step 8: 執行測試確認通過**

Run: `cd frontend && npx vitest run src/utils/qrRoomId.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 9: 全量跑一次 frontend 測試 + 型別檢查，確認沒弄壞既有東西**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS，型別檢查無錯誤

- [ ] **Step 10: Commit**

```bash
git add frontend/src/state.ts frontend/src/state.test.ts frontend/src/utils/qrRoomId.ts frontend/src/utils/qrRoomId.test.ts
git commit -m "feat: add resolveAuthRoute and extractRoomId pure functions for login integration"
```

---

### Task 2: `StudentHome` 畫面（房間 ID 輸入 + QR 掃描 + 登出）

**Files:**
- Create: `frontend/src/components/StudentHome.tsx`
- Create: `frontend/src/components/StudentHome.css`
- Create: `frontend/src/hooks/useQrScanner.ts`
- Modify: `frontend/package.json`（新增 `qr-scanner` 依賴）

**Interfaces:**
- Consumes: `extractRoomId`（Task 1 產生）、`joinRequest(roomId, name): Promise<{requestId: string}>`（既有 `frontend/src/api.ts`）
- Produces: `StudentHome` 元件，props `{ fullName: string; onSubmitted: (requestId: string, roomId: string) => void; onLogout: () => void }`（Task 3 的 `App.tsx` 會 render 它）；`useQrScanner({onDecode, onError}): { start: (video: HTMLVideoElement) => Promise<void>; stop: () => void }`

這個 task 產出的 `StudentHome` 這時還沒被 `App.tsx` 引用（Task 3 才會接上），是獨立可測試/可預覽的元件。

- [ ] **Step 1: 安裝 `qr-scanner`**

Run: `cd frontend && npm install qr-scanner`
Expected: `frontend/package.json` 的 `dependencies` 新增 `"qr-scanner": "^..."`，`package-lock.json` 一併更新

- [ ] **Step 2: 確認安裝版本的 API 對得上下一步要寫的程式碼**

Run: `cat frontend/node_modules/qr-scanner/qr-scanner.d.ts | grep -A5 "class QrScanner"`

檢查建構子簽名是否為 `new QrScanner(video: HTMLVideoElement, onDecode: (result: {data: string}) => void, options?: {...})`，以及是否有 `static WORKER_PATH` 這個靜態屬性。若安裝到的版本 API 有出入，下一步的 `useQrScanner.ts` 需要對應調整（例如舊版 callback 直接收字串而非 `{data}` 物件）。

- [ ] **Step 3: 寫 `useQrScanner` hook**

Create `frontend/src/hooks/useQrScanner.ts`:

```ts
import { useCallback, useRef } from 'react';
import QrScanner from 'qr-scanner';

// Vite 需要明確指出 worker 檔案位置，否則套件內部的 web worker 載入會失敗。
QrScanner.WORKER_PATH = new URL('qr-scanner/qr-scanner-worker.min.js', import.meta.url).toString();

interface UseQrScannerOptions {
  onDecode: (text: string) => void;
  onError: (message: string) => void;
}

export interface UseQrScannerResult {
  start: (video: HTMLVideoElement) => Promise<void>;
  stop: () => void;
}

/**
 * 包裝 qr-scanner 套件：開啟指定 <video> 元素的鏡頭，持續解碼畫面中的 QR Code。
 * onDecode/onError 存進 ref 而非直接放進 useCallback 依賴，讓 start/stop 的函式
 * 參考維持穩定——呼叫端（StudentHome）每次 render 都會傳新的 inline callback 進來，
 * 若把它們列進依賴陣列，start/stop 每次 render 都會變成新函式，觸發呼叫端的
 * useEffect 重跑、鏡頭被重開。
 */
export function useQrScanner({ onDecode, onError }: UseQrScannerOptions): UseQrScannerResult {
  const scannerRef = useRef<QrScanner | null>(null);
  const onDecodeRef = useRef(onDecode);
  const onErrorRef = useRef(onError);
  onDecodeRef.current = onDecode;
  onErrorRef.current = onError;

  const stop = useCallback(() => {
    scannerRef.current?.stop();
    scannerRef.current?.destroy();
    scannerRef.current = null;
  }, []);

  const start = useCallback(async (video: HTMLVideoElement) => {
    stop();
    try {
      const scanner = new QrScanner(
        video,
        (result) => onDecodeRef.current(result.data),
        {
          preferredCamera: 'environment',
          highlightScanRegion: false,
          highlightCodeOutline: false,
        },
      );
      scannerRef.current = scanner;
      await scanner.start();
    } catch (err) {
      onErrorRef.current('無法開啟相機，請確認已授權相機權限');
      console.error('[useQrScanner] Failed to start camera:', err);
    }
  }, [stop]);

  return { start, stop };
}
```

- [ ] **Step 4: 寫 `StudentHome` 元件**

Create `frontend/src/components/StudentHome.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { joinRequest } from '../api.ts';
import { extractRoomId } from '../utils/qrRoomId.ts';
import { useQrScanner } from '../hooks/useQrScanner.ts';
import './StudentHome.css';

interface StudentHomeProps {
  fullName: string;
  onSubmitted: (requestId: string, roomId: string) => void;
  onLogout: () => void;
}

export default function StudentHome({ fullName, onSubmitted, onLogout }: StudentHomeProps) {
  const [mode, setMode] = useState<'input' | 'scanning'>('input');
  const [roomId, setRoomId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const submitRoomId = async (id: string) => {
    const trimmed = id.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError('');
    try {
      const { requestId } = await joinRequest(trimmed, fullName);
      onSubmitted(requestId, trimmed);
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  };

  const { start, stop } = useQrScanner({
    onDecode: (text) => {
      const scannedRoomId = extractRoomId(text);
      if (!scannedRoomId) {
        setError('無法辨識的 QR Code，請再試一次');
        return;
      }
      setMode('input');
      void submitRoomId(scannedRoomId);
    },
    onError: (message) => setError(message),
  });

  // 只在「掃描模式」開鏡頭；離開掃描模式（取消或掃到有效結果）就關閉
  useEffect(() => {
    if (mode !== 'scanning') return;
    const video = videoRef.current;
    if (!video) return;
    void start(video);
    return () => stop();
  }, [mode, start, stop]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitRoomId(roomId);
  };

  return (
    <div className="student-home-screen">
      <button className="student-home-logout-btn" onClick={onLogout} title="登出">
        <span className="material-symbols-outlined">logout</span>
        登出
      </button>

      <div className="student-home-container">
        <h2 className="student-home-title">
          <span className="title-orange">加入</span>
          <span className="title-teal">課堂</span>
        </h2>

        {mode === 'input' ? (
          <div className="student-home-card">
            <form onSubmit={handleSubmit}>
              <input
                type="text"
                placeholder="請輸入房間 ID"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                disabled={loading}
                autoFocus
                className="student-home-input"
              />
              <button type="submit" disabled={loading || !roomId.trim()} className="student-home-btn">
                {loading ? '送出中...' : '加入'}
              </button>
            </form>
            <button
              type="button"
              className="student-home-scan-btn"
              onClick={() => { setError(''); setMode('scanning'); }}
            >
              <span className="material-symbols-outlined">qr_code_scanner</span>
              掃描 QR Code
            </button>
            {error && <p className="error-text">{error}</p>}
          </div>
        ) : (
          <div className="student-home-scan-card">
            <video ref={videoRef} className="student-home-scan-video" muted playsInline />
            <button
              type="button"
              className="student-home-scan-cancel-btn"
              onClick={() => setMode('input')}
            >
              取消
            </button>
            {error && <p className="error-text">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 寫 CSS**

Create `frontend/src/components/StudentHome.css`（沿用 `LoginScreen.css` 同一套橘/青配色與圓角風格，可依實際視覺需求微調）:

```css
.student-home-screen {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  padding: 24px;
  background: #FAFAF8;
}

.student-home-logout-btn {
  position: absolute;
  top: 20px;
  right: 20px;
  display: flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  color: #6B7280;
  font-size: 14px;
  cursor: pointer;
}

.student-home-container {
  width: 100%;
  max-width: 420px;
  text-align: center;
}

.student-home-title {
  font-size: 28px;
  font-weight: 800;
  margin-bottom: 24px;
}

.student-home-title .title-orange { color: #D97706; }
.student-home-title .title-teal { color: #008080; }

.student-home-card,
.student-home-scan-card {
  background: #FFFFFF;
  border-radius: 24px;
  padding: 32px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
}

.student-home-input {
  width: 100%;
  padding: 14px 20px;
  border-radius: 30px;
  border: 1px solid #E5E7EB;
  font-size: 16px;
  margin-bottom: 16px;
  box-sizing: border-box;
}

.student-home-btn {
  width: 100%;
  padding: 14px;
  border-radius: 30px;
  border: none;
  background: #0C7B83;
  color: #FFFFFF;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
}

.student-home-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.student-home-scan-btn {
  width: 100%;
  margin-top: 16px;
  padding: 14px;
  border-radius: 30px;
  border: 1px solid #0C7B83;
  background: transparent;
  color: #0C7B83;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.student-home-scan-video {
  width: 100%;
  border-radius: 16px;
  background: #000;
  aspect-ratio: 1 / 1;
  object-fit: cover;
}

.student-home-scan-cancel-btn {
  width: 100%;
  margin-top: 16px;
  padding: 14px;
  border-radius: 30px;
  border: none;
  background: #F0F2F5;
  color: #374151;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
}
```

- [ ] **Step 6: 型別檢查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 無錯誤（`StudentHome`/`useQrScanner` 此時尚未被任何地方 import，但仍需自身型別正確）

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/StudentHome.tsx frontend/src/components/StudentHome.css frontend/src/hooks/useQrScanner.ts frontend/package.json frontend/package-lock.json
git commit -m "feat: add StudentHome screen with room-ID input and QR camera scanning"
```

---

### Task 3: 整合進 `App.tsx` — 單一登入表單 + 自動路由 + 移除舊學生流程

**Files:**
- Modify: `frontend/src/state.ts`（`AppState` union）
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/LoginScreen.tsx`
- Modify: `frontend/src/components/LoginScreen.css`
- Delete: `frontend/src/components/StudentJoin.tsx`

**Interfaces:**
- Consumes: `resolveAuthRoute`、`extractRoomId`（Task 1）、`StudentHome`（Task 2）、既有 `useAuth()`（`user`/`isAuthenticated`/`isLoading`/`logout`）、既有 `joinRequest`/`createRoom`（`api.ts`）
- Produces: 完整可運作的登入 → 分流 → 學生/老師畫面流程（這是本次功能的最終整合點，之後沒有 Task 4）

這個 task 把前兩個 task 的產出接起來，同時是唯一會動到 `AppState` union 形狀與既有畫面 render 邏輯的地方，所以放在一起做，做完立刻用手動驗證清單過一輪。

- [ ] **Step 1: 修改 `AppState`：新增 `student-home`/`student-joining`，移除 `student-join`**

在 `frontend/src/state.ts`，把現有的 `AppState` union（檔案開頭）：

```ts
export type AppState =
  | { screen: 'select-role' }
  | { screen: 'host-lobby'; roomId: string; hostToken: string; livekitToken: string }
  | { screen: 'host-session'; roomId: string; hostToken: string; livekitToken: string }
  | { screen: 'student-join'; roomId: string }
  | { screen: 'student-waiting'; roomId: string; requestId: string; name: string }
  | { screen: 'student-session'; roomId: string; token: string; name: string }
  | { screen: 'student-rejected'; roomId: string }
  | { screen: 'error'; message: string };
```

改成：

```ts
export type AppState =
  | { screen: 'select-role' }
  | { screen: 'host-lobby'; roomId: string; hostToken: string; livekitToken: string }
  | { screen: 'host-session'; roomId: string; hostToken: string; livekitToken: string }
  | { screen: 'student-home' }
  | { screen: 'student-joining'; roomId: string }
  | { screen: 'student-waiting'; roomId: string; requestId: string; name: string }
  | { screen: 'student-session'; roomId: string; token: string; name: string }
  | { screen: 'student-rejected'; roomId: string }
  | { screen: 'error'; message: string };
```

（Task 1 加在檔案尾端的 `AuthRoute`/`resolveAuthRoute`/`STUDENT_LIKE_ROLES` 不動。）

- [ ] **Step 2: 簡化 `LoginScreen.tsx` 成單一表單**

用以下內容整個取代 `frontend/src/components/LoginScreen.tsx`：

```tsx
import { useState } from 'react';
import loginIllustration from '../assets/login_page.png';
import type { AuthUser } from '../hooks/useAuth.ts';
import { useAuth } from '../hooks/useAuth.ts';
import './LoginScreen.css';

interface LoginScreenProps {
  onLoginSuccess: (user: AuthUser) => void;
}

export default function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const { loginWithEmailAndPassword } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    setError('');
    try {
      const { success, user, message } = await loginWithEmailAndPassword(email, password);

      if (success) {
        localStorage.setItem('user_data', JSON.stringify(user));
        console.log(`[Auth] 登入成功，role: ${user?.role}，user:`, user);
        onLoginSuccess(user!);
      } else {
        setError(message || '登入失敗');
        setLoading(false);
      }
    } catch (err) {
      const error = err as { code?: string; message?: string };
      const msg = firebaseErrorMessage(error.code) || error.message || '登入失敗';
      setError(msg);
      setLoading(false);
    }
  };

  return (
    <div className="login-screen-container">
      <div className="login-left-panel">
        <div className="login-illustration-wrapper">
          <img src={loginIllustration} alt="Educational Illustration" />
        </div>
      </div>

      <div className="login-right-panel">
        <div className="login-card">
          <h1 className="login-card-title">
            <span className="text-orange">登入</span>
            <span className="text-teal">系統</span>
          </h1>

          <form onSubmit={handleSubmit} className="login-form">
            <div className="input-group">
              <div className="input-icon-wrapper">
                <span className="material-symbols-outlined input-icon">mail</span>
              </div>
              <input
                type="email"
                placeholder="電郵地址"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                required
              />
            </div>

            <div className="input-group">
              <div className="input-icon-wrapper">
                <span className="material-symbols-outlined input-icon">lock</span>
              </div>
              <input
                type="password"
                placeholder="密碼"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                required
              />
            </div>

            <div className="form-options">
              <label className="remember-me-label">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  disabled={loading}
                  className="custom-checkbox"
                />
                <span>記住我</span>
              </label>
              <a href="#forgot" className="forgot-password-link" onClick={(e) => e.preventDefault()}>
                忘記密碼？
              </a>
            </div>

            {error && <p className="login-error-text">{error}</p>}

            <button type="submit" className="login-submit-btn" disabled={loading}>
              {loading ? '登入中...' : '登入'}
            </button>
          </form>

          <div className="login-footer">
            <span className="footer-text">還沒有帳戶？</span>
            <a href="#register" className="footer-link" onClick={(e) => e.preventDefault()}>
              立即註冊
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function firebaseErrorMessage(code?: string): string {
  switch (code) {
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return '電子郵件或密碼錯誤';
    case 'auth/invalid-email':
      return '無效的電子郵件格式';
    case 'auth/user-disabled':
      return '此帳號已被停用';
    case 'auth/too-many-requests':
      return '登入嘗試次數過多，請稍後再試';
    default:
      return '';
  }
}
```

- [ ] **Step 3: 從 `LoginScreen.css` 移除 tab 樣式**

在 `frontend/src/components/LoginScreen.css` 找到並整段刪除這個區塊（`/* Tabs */` 註解到 `.login-tab.active` 結束）：

```css
/* Tabs */
.login-tabs {
  display: flex;
  background-color: #F0F2F5;
  border-radius: 30px;
  padding: 6px;
  margin-bottom: 28px;
}

.login-tab {
  flex: 1;
  border: none;
  background: transparent;
  padding: 10px;
  font-size: 16px;
  font-weight: 700;
  color: #6B7280;
  border-radius: 24px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.login-tab.active {
  background-color: #FFFFFF;
  color: #0C7B83;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}
```

- [ ] **Step 4: 刪除 `StudentJoin.tsx`**

Run: `rm frontend/src/components/StudentJoin.tsx`

- [ ] **Step 5: 改寫 `App.tsx`**

用以下內容整個取代 `frontend/src/App.tsx`：

```tsx
import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import type { AppState } from './state.ts';
import { resolveAuthRoute } from './state.ts';
import type { AuthUser } from './hooks/useAuth.ts';
import { useAuth } from './hooks/useAuth.ts';
import { createRoom, joinRequest } from './api.ts';
import LoginScreen from './components/LoginScreen.tsx';
import BigScreen from './components/BigScreen.tsx';
import HostSession from './components/HostSession.tsx';
import './App.css';

const ShareScreen = lazy(() => import('./components/ShareScreen.tsx'));
const HostLobby = lazy(() => import('./components/HostLobby.tsx'));
const StudentHome = lazy(() => import('./components/StudentHome.tsx'));
const StudentWaiting = lazy(() => import('./components/StudentWaiting.tsx'));
const StudentSession = lazy(() => import('./components/StudentSession.tsx'));

function AppSpinner() {
  return (
    <div className='loading-container'>
      <div className='waiting-inner'>
        <div className="gradient-spinner" />
        <h2 className="waiting-text">載入中...</h2>
      </div>
    </div>
  );
}

const APP_STATE_STORAGE_KEY = 'live-mr-app-state';

function loadPersistedState(): AppState | null {
  try {
    const raw = sessionStorage.getItem(APP_STATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppState;
    if (parsed && typeof parsed === 'object' && typeof parsed.screen === 'string') {
      return parsed;
    }
  } catch { /* ignore corrupt storage */ }
  return null;
}

function getInitialState(): AppState {
  const params = new URLSearchParams(window.location.search);
  const urlRoomId = params.get('roomId');
  const persisted = loadPersistedState();

  // 若 refresh 時 URL 仍帶著同一個房號、且已有進行中的 student-waiting/student-session，直接恢復
  if (urlRoomId && persisted && 'roomId' in persisted && persisted.roomId === urlRoomId &&
    (persisted.screen === 'student-waiting' || persisted.screen === 'student-session')) {
    return persisted;
  }

  if (persisted) return persisted;
  return { screen: 'select-role' };
}

/** 顯示用名稱：優先用帳號的 full_name，其餘依序退回 email / id / uid。 */
function displayNameOf(user: AuthUser): string {
  return user.full_name || user.email || (typeof user.id === 'string' ? user.id : user.uid) || '學生';
}

// Detect specific screen modes before mounting any hook-bearing components
const screenParam = new URLSearchParams(window.location.search).get('screen');
const isBigScreen = screenParam === 'bigscreen';
const isShareScreen = screenParam === 'share';

function App() {
  const [state, setState] = useState<AppState>(getInitialState);
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  // 外部 QR/連結帶進站的房號只在開機當下讀一次；登入成功後才會用到（見 routeUser）
  const [pendingRoomId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('roomId'),
  );
  const hasAutoRoutedRef = useRef(false);

  // Handle host room creation
  const handleHost = async () => {
    try {
      const { roomId, hostToken, livekitToken } = await createRoom();
      setState({ screen: 'host-session', roomId, hostToken, livekitToken });
    } catch (err) {
      setState({ screen: 'error', message: String(err) });
    }
  };

  // 外部深連結（roomId 已知）登入成功後自動送出加入請求；student-home 手動輸入/
  // 掃 QR 走 StudentHome 自己內部呼叫 joinRequest，不經過這個函式。
  const autoJoinRoom = async (roomId: string, name: string) => {
    setState({ screen: 'student-joining', roomId });
    try {
      const { requestId } = await joinRequest(roomId, name);
      setState({ screen: 'student-waiting', roomId, requestId, name });
    } catch (err) {
      setState({ screen: 'error', message: String(err) });
    }
  };

  /**
   * 登入成功（或開機時偵測到既有 session）後的統一分流入口，規則見 resolveAuthRoute：
   *   - teacher / admin / institution_admin → 建房間，進 host-session（忽略 pendingRoomId）
   *   - student / visitor + 有 pendingRoomId → 自動送出加入請求
   *   - student / visitor + 無 pendingRoomId → student-home（手動輸入房號或掃 QR）
   */
  const routeUser = (loggedInUser: AuthUser) => {
    const route = resolveAuthRoute(loggedInUser.role, pendingRoomId);
    if (route.action === 'host') {
      void handleHost();
    } else if (route.action === 'auto-join') {
      void autoJoinRoom(route.roomId, displayNameOf(loggedInUser));
    } else {
      setState({ screen: 'student-home' });
    }
  };

  const handleLoginSuccess = (loggedInUser: AuthUser) => {
    routeUser(loggedInUser);
  };

  // 開機時若已有有效 session（Firebase 持久化），自動依 role 導向，不必重新登入。
  // 只在「當前畫面還是登入表單」時才導向——避免蓋掉 refresh 後恢復的進行中 session
  // （host-session/student-waiting 等）。這段刻意不寫依賴陣列、每次 render 都跑，
  // 靠 hasAutoRoutedRef 保證只在開機當下真正執行一次：之後使用者從房間畫面按
  // 「離開」回到 select-role 不會被立刻導回去（否則老師離開房間會馬上被彈進新房間）。
  useEffect(() => {
    if (isLoading || hasAutoRoutedRef.current) return;
    hasAutoRoutedRef.current = true;
    if (isAuthenticated && user && state.screen === 'select-role') {
      routeUser(user);
    }
  });

  // Clear roomId from URL when on select-role
  useEffect(() => {
    if (state.screen === 'select-role') {
      const url = new URL(window.location.href);
      if (url.searchParams.has('roomId')) {
        url.searchParams.delete('roomId');
        window.history.replaceState({}, '', url.toString());
      }
    }
  }, [state.screen]);

  // Persist AppState to sessionStorage so a page refresh restores the user back
  // to the same screen (and auto-rejoins their LiveKit room when applicable).
  // sessionStorage scope = current tab only, so closing the tab still resets.
  // select-role/error/student-rejected/student-home/student-joining 都不持久化——
  // 這些畫面在 refresh 後可以靠開機時的 routeUser 自行正確地重新導向。
  useEffect(() => {
    try {
      if (state.screen === 'select-role' || state.screen === 'error' ||
        state.screen === 'student-rejected' || state.screen === 'student-home' ||
        state.screen === 'student-joining') {
        sessionStorage.removeItem(APP_STATE_STORAGE_KEY);
      } else {
        sessionStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state));
      }
    } catch { /* quota / disabled storage — ignore */ }
  }, [state]);

  const renderScreen = () => {
    switch (state.screen) {
      case 'select-role':
        return <LoginScreen onLoginSuccess={handleLoginSuccess} />;

      case 'host-lobby':
        return (
          <HostLobby
            roomId={state.roomId}
            hostToken={state.hostToken}
            livekitToken={state.livekitToken}
            onStart={(livekitToken) =>
              setState({ screen: 'host-session', roomId: state.roomId, hostToken: state.hostToken, livekitToken })
            }
            onExit={() => setState({ screen: 'select-role' })}
          />
        );

      case 'host-session':
        return (
          <HostSession
            roomId={state.roomId}
            livekitToken={state.livekitToken}
            hostToken={state.hostToken}
          />
        );

      case 'student-home':
        return (
          <StudentHome
            fullName={user ? displayNameOf(user) : '學生'}
            onSubmitted={(requestId, roomId) =>
              setState({
                screen: 'student-waiting',
                roomId,
                requestId,
                name: user ? displayNameOf(user) : '學生',
              })
            }
            onLogout={() => { void logout(); }}
          />
        );

      case 'student-joining':
        return (
          <div className='loading-container'>
            <div className='waiting-inner'>
              <div className="gradient-spinner" />
              <h2 className="waiting-text">正在加入房間...</h2>
            </div>
          </div>
        );

      case 'student-waiting':
        return (
          <StudentWaiting
            roomId={state.roomId}
            requestId={state.requestId}
            name={state.name}
            onApproved={(token) =>
              setState({ screen: 'student-session', roomId: state.roomId, token, name: state.name })
            }
            onRejected={() =>
              setState({ screen: 'student-rejected', roomId: state.roomId })
            }
            onError={(message) => setState({ screen: 'error', message })}
            onExit={() => setState({ screen: 'select-role' })}
          />
        );

      case 'student-session':
        return (
          <StudentSession
            roomId={state.roomId}
            token={state.token}
            name={state.name}
            onExit={() => setState({ screen: 'select-role' })}
          />
        );

      case 'student-rejected':
        return (
          <div className="rejected-screen">
            <div className="rejected-card">
              <div className="rejected-icon-wrapper">
                <span className="material-symbols-outlined rejected-icon">person_cancel</span>
              </div>
              <h2 className="rejected-title">
                <span className="title-orange">請求</span>
                <span className="title-teal">被拒絕</span>
              </h2>
              <p className="rejected-subtitle">老師已拒絕你的加入請求。</p>
              <button
                className="rejected-back-btn"
                onClick={() => setState({ screen: 'select-role' })}
              >
                返回
              </button>
            </div>
          </div>
        );

      case 'error':
        return (
          <div className="error-screen">
            <div className="error-card">
              <div className="error-icon-wrapper">
                <span className="material-symbols-outlined error-icon">person_alert</span>
              </div>
              <h2 className="error-title">
                <span className="title-orange">發生</span>
                <span className="title-teal">錯誤</span>
              </h2>
              <p className="error-subtitle">{state.message}</p>
              <button
                className="error-back-btn"
                onClick={() => setState({ screen: 'select-role' })}
              >
                返回
              </button>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="app">
      <Suspense fallback={<AppSpinner />}>
        {renderScreen()}
      </Suspense>
    </div>
  );
}

function Root() {
  if (isBigScreen) return <Suspense fallback={<AppSpinner />}><BigScreen /></Suspense>;
  if (isShareScreen) return <Suspense fallback={<AppSpinner />}><ShareScreen /></Suspense>;
  return <App />;
}

export default Root;
```

- [ ] **Step 6: 確認沒有殘留的 `StudentJoin` 參照**

Run: `cd frontend && grep -rn "StudentJoin" src/`
Expected: 無輸出（沒有任何檔案還在 import 或提到 `StudentJoin`）

- [ ] **Step 7: 型別檢查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 無錯誤。若有錯誤，最常見的落漆點是 `state.ts` 的 `AppState` union 改動後，`App.tsx` 的 `switch` 是否每個 case 都對得上新的欄位形狀。

- [ ] **Step 8: 跑全部前端測試**

Run: `cd frontend && npx vitest run`
Expected: 全部 PASS（含 Task 1 新增的 `resolveAuthRoute`/`extractRoomId` 測試，以及既有測試都不受影響）

- [ ] **Step 9: Commit**

```bash
git add frontend/src/state.ts frontend/src/App.tsx frontend/src/components/LoginScreen.tsx frontend/src/components/LoginScreen.css
git rm frontend/src/components/StudentJoin.tsx
git commit -m "feat: unify login entry, add role-based auto routing, wire StudentHome into App"
```

- [ ] **Step 10: 手動驗證（無法自動化，需要實機）**

啟動 dev server（`npx tsx scripts/dev-livekit.ts`、`cd backend && npm run dev`、`cd frontend && npm run dev`，見 `docs/superpowers/specs/2026-07-22-dev-mode-design.md`），依序驗證：

1. **老師登入**：用老師帳密登入 → 直接建房間進 `host-session`（跟改動前行為一致）。
2. **學生手動輸入房號**：學生帳密登入 → 進 `student-home` → 輸入老師剛建立的房間 ID → 送出 → 進 `student-waiting` → 老師端核准 → 進 `student-session`。
3. **學生掃 QR**：在 `student-home` 點「掃描 QR Code」→ 對著 `HostLobby`/`ShareScreen` 顯示的 QR → 自動解出房號並送出加入請求，其餘同上。
4. **外部深連結**：**未登入**狀態下，直接開啟 `http://<host>/?roomId=<現有房間ID>` → 應該先看到登入表單（不能直接跳過）→ 用學生帳密登入 → 自動顯示「正在加入房間...」→ 轉 `student-waiting`。
5. **老師掃到學生連結**：用同一個 `?roomId=` 連結，改用老師帳密登入 → 應忽略 roomId，正常建立自己的新房間。
6. **已登入直接重開**：完成第 2 點加入房間後，直接重新整理分頁（不登出）→ 應該自動跳過登入表單，依 role 直接導向（學生會回到 `student-home`，不用重新輸入帳密）。
7. **老師離開房間不迴圈**：老師在 `host-session` 觸發「離開」（若目前 UI 沒有離開按鈕，改用瀏覽器回上一頁或直接把 state 清成 `select-role` 測試）→ 應該看到登入表單，**不會**被自動彈回一個新建的房間。
8. **登出**：在 `student-home` 點「登出」→ 應回到登入表單，且重新整理頁面不會又自動登入回去。
9. **iPad Safari 相機掃描**：在真的 iPad（Safari）上重複第 3 點，確認鏡頭畫面能顯示、QR 能被解碼（`qr-scanner` 在不支援 `BarcodeDetector` 的瀏覽器會自動用 WASM 解碼，需要實機確認沒有卡住或全黑畫面）。

全部都符合預期才算這個 task 完成；任何一步不符合，先回頭檢查對應的 `App.tsx`/`StudentHome.tsx` 邏輯，不要跳過。
