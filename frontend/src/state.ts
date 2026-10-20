import type { UserRole } from './hooks/useAuth.ts';
import { normalizeRoomId } from './utils/qrRoomId.ts';

export type AppState =
  | { screen: 'select-role' }
  | { screen: 'teacher-home' }
  | { screen: 'lesson-prep' }
  | { screen: 'host-lobby'; roomId: string; hostToken: string; livekitToken: string; planId?: string }
  | { screen: 'host-session'; roomId: string; hostToken: string; livekitToken: string; planId?: string }
  /** roomId / error：自動加入失敗時預填房號並顯示原因，學生不必重新輸入 */
  | { screen: 'student-home'; roomId?: string; error?: string }
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

/** QR / 加入連結帶進來、尚未使用的房號（存在 sessionStorage：登入前重新整理也不會遺失） */
export const PENDING_ROOM_STORAGE_KEY = 'pending-room-id';

type PendingRoomStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * 開機時決定待加入的房號：網址有 roomId 就用它（並記到 storage）；
 * 沒有的話用 storage 裡先前記下的（例如在登入畫面重新整理，網址上的 roomId 已被清掉）。
 */
export function readPendingRoomId(search: string, storage: PendingRoomStorage | null): string | null {
  const fromUrl = new URLSearchParams(search).get('roomId');
  const normalized = fromUrl ? normalizeRoomId(fromUrl) : '';
  try {
    if (normalized) {
      storage?.setItem(PENDING_ROOM_STORAGE_KEY, normalized);
      return normalized;
    }
    return storage?.getItem(PENDING_ROOM_STORAGE_KEY) || null;
  } catch {
    return normalized || null;
  }
}
