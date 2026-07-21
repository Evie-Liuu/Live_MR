/**
 * useAuth — React hook 版的身分驗證邏輯
 *
 * 對應 SDGs_journey/packages/shared/stores/auth.js 的 loginWithEmailAndPassword，
 * 流程完全一致：
 *   1. Firebase signInWithEmailAndPassword
 *   2. 取得 Firebase ID token
 *   3. POST /api/auth/login { id_token } → 後端回傳 user（含 role）
 *   4. 將 user 存入 localStorage('user_data') 供全域存取
 */

import { useState, useCallback, useEffect } from 'react';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { auth } from '../firebase';

// ── 型別定義 ────────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'institution_admin' | 'teacher' | 'student' | 'visitor';

export interface AuthUser {
  uid?: string;
  email?: string;
  full_name?: string;
  role: UserRole;
  institution_id?: number | string;
  [key: string]: unknown;
}

export interface LoginResult {
  success: boolean;
  user?: AuthUser;
  message?: string;
}

interface AuthState {
  isAuthenticated: boolean;
  user: AuthUser | null;
  /** true = Firebase onAuthStateChanged 尚未完成首次判斷 */
  isLoading: boolean;
}

// ── 後端 login API ──────────────────────────────────────────────────────────
// SDGs API Base URL: 我們需要向 SDGs 的後端 API 伺服器驗證，而不是 Live_MR 自己的後端。
// 預設為 SDGs 的正式環境 API，或者開發者可在 .env 中自訂 VITE_SDGS_API_BASE_URL
const API_BASE_URL = import.meta.env.VITE_SDGS_API_BASE_URL || 'https://api.sdgs-journey.com/api/v1';

async function backendLogin(idToken: string): Promise<AuthUser> {
  const res = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_token: idToken }),
  });
  console.log(res);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`後端登入失敗 (${res.status})${text ? ': ' + text : ''}`);
  }
  const data = await res.json() as { user: AuthUser };
  return data.user;
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>(() => {
    // 嘗試從 localStorage 還原已登入狀態（同 auth.js 的 onAuthStateChanged handler）
    const raw = localStorage.getItem('user_data');
    if (raw) {
      try {
        const user = JSON.parse(raw) as AuthUser;
        return { isAuthenticated: true, user, isLoading: true };
      } catch { /* ignore */ }
    }
    return { isAuthenticated: false, user: null, isLoading: true };
  });

  // 監聽 Firebase auth 狀態（對應 auth.js 的 onAuthStateChanged 全域設定）
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        // Firebase 有 session，嘗試從 localStorage 取 user_data
        const raw = localStorage.getItem('user_data');
        if (raw) {
          try {
            const user = JSON.parse(raw) as AuthUser;
            setAuthState({ isAuthenticated: true, user, isLoading: false });
            return;
          } catch { /* ignore */ }
        }
        // 有 Firebase session 但無本地資料 → 待 loginWithEmailAndPassword 完成後再更新
        setAuthState((prev) => ({ ...prev, isLoading: false }));
      } else {
        // 無 Firebase session → 清除狀態
        localStorage.removeItem('user_data');
        setAuthState({ isAuthenticated: false, user: null, isLoading: false });
      }
    });
    return unsubscribe;
  }, []);

  /**
   * loginWithEmailAndPassword
   * 完全對應 auth.js 的同名函式：
   *   Firebase 登入 → 取 idToken → 後端 /auth/login → 取得含 role 的 user
   */
  const loginWithEmailAndPassword = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      // 先清除舊資料，防止競態條件
      localStorage.removeItem('user_data');
      setAuthState({ isAuthenticated: false, user: null, isLoading: false });

      try {
        // 1. Firebase 身分驗證
        const credential = await signInWithEmailAndPassword(auth, email, password);
        const idToken = await credential.user.getIdToken();

        // 2. 後端驗證，取得含 role 的 user 資料
        let user: AuthUser;
        try {
          user = await backendLogin(idToken);
        } catch (backendErr) {
          console.error('後端登入失敗:', backendErr);
          return { success: false, message: String((backendErr as Error).message) };
        }

        // 3. 更新狀態與 localStorage（同 auth.js）
        localStorage.setItem('user_data', JSON.stringify(user));
        setAuthState({ isAuthenticated: true, user, isLoading: false });

        return { success: true, user };
      } catch (err) {
        const error = err as { code?: string; message?: string };
        console.error('Firebase 登入失敗:', error);

        // 清除狀態
        localStorage.removeItem('user_data');
        setAuthState({ isAuthenticated: false, user: null, isLoading: false });

        // Firebase 錯誤對應中文訊息
        const message = firebaseErrorMessage(error.code);
        return { success: false, message };
      }
    },
    [],
  );

  /** 登出（同 auth.js 的 logout） */
  const logout = useCallback(async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('登出失敗:', err);
    }
    localStorage.removeItem('user_data');
    setAuthState({ isAuthenticated: false, user: null, isLoading: false });
  }, []);

  return {
    ...authState,
    loginWithEmailAndPassword,
    logout,
    // 便利的 role 判斷
    isTeacher: authState.user?.role === 'teacher',
    isAdmin: authState.user?.role === 'admin' || authState.user?.role === 'institution_admin',
    isStudent: authState.user?.role === 'student',
  };
}

// ── 工具函式 ─────────────────────────────────────────────────────────────────

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
      return '登入失敗，請稍後再試';
  }
}
