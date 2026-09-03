import type { UserRole } from './hooks/useAuth.ts';

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
