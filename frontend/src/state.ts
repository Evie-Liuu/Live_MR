import type { UserRole } from './hooks/useAuth.ts';

export type AppState =
  | { screen: 'select-role' }
  | { screen: 'teacher-home' }
  | { screen: 'lesson-prep' }
  | { screen: 'host-lobby'; roomId: string; hostToken: string; livekitToken: string; planId?: string }
  | { screen: 'host-session'; roomId: string; hostToken: string; livekitToken: string; planId?: string }
  | { screen: 'student-home' }
  | { screen: 'student-joining'; roomId: string }
  | { screen: 'student-waiting'; roomId: string; requestId: string; name: string }
  | { screen: 'student-session'; roomId: string; token: string; name: string }
  | { screen: 'student-rejected'; roomId: string }
  | { screen: 'error'; message: string };

export type AuthRoute =
  | { action: 'teacher-home' }
  | { action: 'auto-join'; roomId: string }
  | { action: 'student-home' };

const STUDENT_LIKE_ROLES: ReadonlySet<UserRole> = new Set(['student', 'visitor']);

/**
 * 登入成功、或開機時偵測到既有 session 後，依 role 決定下一步畫面。
 * 老師/管理員進老師主畫面（備課 / 開始上課），忽略 pendingRoomId；學生/訪客若帶著
 * 外部連結的房號就直接自動加入，否則進房間選擇畫面（手動輸入房號或掃 QR）。
 */
export function resolveAuthRoute(role: UserRole, pendingRoomId: string | null): AuthRoute {
  if (!STUDENT_LIKE_ROLES.has(role)) {
    return { action: 'teacher-home' };
  }
  return pendingRoomId ? { action: 'auto-join', roomId: pendingRoomId } : { action: 'student-home' };
}
