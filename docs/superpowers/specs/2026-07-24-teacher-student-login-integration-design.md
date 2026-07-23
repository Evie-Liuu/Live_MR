# 老師/學生登入身分整合設計

> 日期：2026-07-24
> 狀態：設計已核可，待寫實作計畫

## 背景與動機

現行 `LoginScreen.tsx` 是「老師/學生」雙 tab：老師 tab 走真正的 Firebase + SDGs 帳密登入（`useAuth.ts`），學生 tab 只是輸入房間 ID + 暱稱直接呼叫 `joinRequest`，完全沒有帳號驗證。兩條路徑並存，且外部 QR/連結（帶 `?roomId=`）目前會在 `App.tsx` 的 `getInitialState()` 直接跳過登入、進 `student-join` 畫面。

目標：整合成單一入口——所有人都用同一份 email/password 表單登入（走既有 Firebase + SDGs 流程），登入成功後依 `user.role` 分流；學生登入後進入新畫面，可手動輸入房間 ID 或用鏡頭掃 QR 加入；外部 QR/連結帶進站也必須先登入才能繼續。

## 目標與範圍

**目標**：
- `LoginScreen` 簡化成單一表單，移除老師/學生 tab 區分。
- 登入成功（或開機時偵測到既有 Firebase session）後，依 `role` 自動分流：`teacher`/`admin`/`institution_admin` → 現有建房間流程；`student`/`visitor` → 新的學生主畫面。
- 新增 `StudentHome` 畫面：房間 ID 手動輸入 + QR 掃描（鏡頭）+ 登出。
- 外部 QR/連結帶 `?roomId=` 進站時，一律先要求登入，登入成功後才用該 `roomId` 自動送出加入請求。
- 已登入使用者（Firebase session 仍有效）重新整理或用新連結進站時，自動跳過登入表單、直接依 role 導向對應畫面。

**明確不做（YAGNI）**：
- 後端不新增任何驗證邏輯。目前後端本來就完全信任前端傳來的資訊（`joinRequest`/`createToken`/`rooms.ts` 都沒有身分檢查），這次「需要登入」純粹是前端 UX 層級的閘門，不引入 Firebase Admin SDK 做後端 token 驗證。
- 不更動老師端 `host-lobby`/`host-session` 的「離開」行為——離開後一樣回到登入表單、需要重新輸入帳密。開機時的「自動依 role 導向」只在應用程式**開機當下**跑一次（用 `useRef` 擋掉重複觸發），離開房間屬於畫面內操作，不會再次觸發自動導向，避免老師離開房間後被立刻彈回一個新建的房間。
- 不做後端 join-request 的身分關聯（例如把 LiveKit identity 換成 SDGs `uid`）——`name` 欄位沿用現有字串型別，只是內容來源從「手動輸入」改成「帳號的 `full_name`」。
- 學生端「登出」入口只加在新的 `StudentHome` 畫面，不擴及 `StudentWaiting`/`StudentSession`。

## 架構

沿用現行 `App.tsx` 的手動 state machine（`AppState` union + `switch`），不引入 React Router。

```
useAuth() 解出 isLoading / isAuthenticated / user
        │
        ▼
  isLoading → 顯示 spinner
        │
  !isAuthenticated → LoginScreen（單一表單），保留 pendingRoomId（若 URL 有帶）
        │  onLoginSuccess(user)
        ▼
  routeAfterAuth(user, pendingRoomId)  ←── 開機時也會呼叫一次（僅一次，useRef 擋重複）
        │
        ├─ role ∈ {teacher, admin, institution_admin}
        │     → handleHost()（忽略 pendingRoomId）→ host-session
        │
        └─ role ∈ {student, visitor}
              ├─ 有 pendingRoomId → student-joining（送出 joinRequest）→ student-waiting / error
              └─ 無 pendingRoomId → student-home（輸入房號 或 掃 QR）→ student-waiting
```

`routeAfterAuth` 是這次整合的核心：分流規則只寫一份，開機自動導向與登入表單送出後都呼叫它，避免兩處各寫一次規則造成分歧。

## 觸及的元件

| # | 檔案 | 改動 |
|---|------|------|
| 1 | `frontend/src/components/LoginScreen.tsx` / `.css` | 移除老師/學生 tab、`roomId`/`studentName` state、`handleStudentSubmit`；`onStudentJoin` prop 移除；只剩 email+password 表單 |
| 2 | `frontend/src/state.ts` | `AppState` 新增 `student-home`、`student-joining`；移除 `student-join` |
| 3 | `frontend/src/App.tsx` | 新增 `routeAfterAuth()`、開機自動導向的 `useRef` 旗標、`pendingRoomId` 追蹤；`getInitialState()` 不再因 `?roomId=` 就跳過登入 |
| 4 | `frontend/src/components/StudentHome.tsx` / `.css`（新增） | 房間 ID 輸入 + 「加入」、「掃描 QR Code」（切換到掃描 view）、「登出」（呼叫 `useAuth().logout()`） |
| 5 | `frontend/src/hooks/useQrScanner.ts`（新增） | 包裝 `qr-scanner` 套件：開啟指定 `<video>` 的鏡頭、回傳解碼文字。解碼結果先嘗試當 URL 解析出 `roomId` 查詢參數，失敗則整段文字當 roomId 使用 |
| 6 | `frontend/src/components/StudentJoin.tsx`（刪除） | 功能被 `StudentHome`（手動輸入）+ `App` 的 auto-join（深連結）取代 |
| 7 | `frontend/package.json` | 新增依賴 `qr-scanner` |
| 8 | `frontend/src/components/StudentWaiting.tsx` / `StudentSession.tsx` | 不變更邏輯，`name` 來源改為呼叫端傳入的 `user.full_name` |

後端（`rooms.ts`、`routes.ts`、`livekit.ts`）完全不變。

## 資料流

**A. 學生手動輸入房間 ID**
`LoginScreen` 送出帳密 → `useAuth`（Firebase → `/api/sdgs/auth/login`）→ `user`（`role: student`）→ `onLoginSuccess(user)` → `routeAfterAuth`：無 pendingRoomId → `student-home`。使用者輸入房號按「加入」→ `StudentHome` 呼叫既有 `joinRequest(roomId, user.full_name)` → `App` 轉場 `student-waiting`（等待老師核准的既有流程不變）。

**B. 學生掃 QR（房間內的 QR，`HostLobby`/`ShareScreen` 顯示的那組）**
`StudentHome` 切到掃描模式 → `useQrScanner` 解碼出網址 → 抽出 `roomId` → 呼叫 `joinRequest`，其餘同 A。

**C. 外部 QR/連結（`?roomId=` 帶進站）**
`getInitialState()` 記下 `pendingRoomId`，畫面先顯示登入表單 → 登入成功 → `routeAfterAuth` 發現 `role ∈ {student, visitor}` 且有 `pendingRoomId` → 顯示 `student-joining`（spinner + 「正在加入房間…」）並呼叫 `joinRequest(pendingRoomId, user.full_name)` → 成功轉 `student-waiting`；失敗（房間不存在/過期）轉既有 `error` 畫面。若登入後發現是老師/管理員身分 → 忽略 `pendingRoomId`，走 `handleHost()` 正常建房間流程。

**D. 已登入使用者重新整理頁面或直接開網址（無 roomId）**
Firebase session 還在 → `useAuth` 解出 `isAuthenticated=true` → 開機時的 `routeAfterAuth`（僅觸發一次）自動依 role 導向：老師直接建新房間進 `host-session`；學生直接到 `student-home`。不需要重新輸入帳密。

## 例外處理

- `joinRequest` 失敗（房間不存在、過期、後端錯誤）→ 一律導到既有 `error` 畫面，文案沿用現況。
- QR 解碼出的內容既不是合法 URL、也抽不出 `roomId` → 停留在掃描畫面，顯示「無法辨識的 QR Code」提示，不跳轉。
- 相機權限被拒 → `StudentHome` 顯示錯誤訊息並退回手動輸入模式，不阻斷整個畫面。

## 測試

- `useQrScanner` 的 URL/roomId 抽取邏輯：vitest 純函式測試，涵蓋合法 URL、純文字房號、垃圾字串三種輸入。
- `App.tsx` 的 `routeAfterAuth` 分流：vitest + React Testing Library，覆蓋「老師/學生/visitor × 有無 pendingRoomId」的組合，並明確驗證「已登入使用者從 host-session 呼叫 exit 後，不會被自動彈回 host-session」（開機旗標只觸發一次的行為）。
- `StudentHome` 手動輸入與掃描兩條路徑都導到同一個 `onJoin(roomId)` callback，用既有 `joinRequest` mock 驗證即可，不需要分別重複測試提交邏輯。
- 相機/QR 掃描本身（真實鏡頭畫面辨識）無法自動化測試，需要實機（含 iPad Safari）手動驗證；這點會列在實作計畫的驗證步驟中，不假裝自動測試涵蓋得到。

## 執行方式

實作在獨立的 git worktree 中進行，不動目前 `main` 的工作目錄；完成後由使用者決定是否 merge。
