/**
 * 大屏角色名牌的內容：每個上台的模型顯示「角色・演出者」。
 * 任務中依目前步驟判斷誰有台詞（沒台詞的淡化），LiveKit 偵測到聲音的發光。
 */
import type { SceneSlot } from '../types/vrm.ts';
import type { LessonScreenState } from './lessonSession.ts';

export type AvatarAnchors = Record<string, { x: number; y: number }>;

export interface NameplateInfo {
  /** 角色名稱，例如「店員A」；沒有指定角色時省略 */
  role?: string;
  /** 演出者名稱（學生姓名或「老師」）；任務前只顯示角色時為空字串 */
  name: string;
  /** 角色代表色 */
  color: string;
  /** 目前步驟有台詞：false 時淡化（這一段不用開口） */
  active: boolean;
  /** 正在說話（LiveKit 偵測到聲音） */
  speaking: boolean;
  /** 逐句演練中輪到這個人說 */
  turn?: boolean;
}

/** 角色代表色（依場景 slot 順序）；白字在上面也清楚 */
export const ROLE_COLORS = ['#1E88E5', '#F57C00', '#8E24AA', '#2E7D32'] as const;

export function buildNameplates(opts: {
  slots: readonly Pick<SceneSlot, 'id' | 'label'>[];
  slotAssignments: Record<string, string>;
  participantNames: ReadonlyMap<string, string>;
  lesson: Pick<LessonScreenState, 'phase' | 'allDone' | 'roles'> | null;
  speaking: ReadonlySet<string>;
  /**
   * 逐句演練目前的發言者：undefined＝沒在演練；null＝演練中但沒人發言（暫停、步驟講完、角色未指派）
   */
  turnIdentity?: string | null;
  /**
   * 任務前階段：已指派的角色以靜態模型展示（key 為 `${rolesOnlyPrefix}${slotId}`），
   * 名牌只顯示虛擬角色名稱，不顯示演出者
   */
  rolesOnlyPrefix?: string;
}): Record<string, NameplateInfo> {
  const { slots, slotAssignments, participantNames, lesson, speaking, turnIdentity, rolesOnlyPrefix } = opts;
  const nameOf = (id: string) => participantNames.get(id) || (id.startsWith('host-') ? '老師' : id);
  // 任務中才依步驟判斷誰有台詞；任務前／後、未上課、已完成時全部正常顯示
  const stepRoles = lesson && lesson.phase === 'during' && !lesson.allDone ? lesson.roles : null;
  const plates: Record<string, NameplateInfo> = {};
  slots.forEach((slot, i) => {
    const id = slotAssignments[slot.id];
    if (!id) return;
    if (rolesOnlyPrefix !== undefined) {
      plates[`${rolesOnlyPrefix}${slot.id}`] = {
        role: slot.label, name: '', color: ROLE_COLORS[i % ROLE_COLORS.length], active: true, speaking: false,
      };
      return;
    }
    plates[id] = {
      role: slot.label,
      name: nameOf(id),
      color: ROLE_COLORS[i % ROLE_COLORS.length],
      active: !stepRoles || stepRoles.includes(slot.label),
      // 逐句演練中只有發言者有收音效果（老師或其他人的聲音不讓名牌發光；暫停時沒人發光）
      speaking: speaking.has(id) && (turnIdentity === undefined || turnIdentity === id),
      ...(turnIdentity && turnIdentity === id ? { turn: true } : {}),
    };
  });
  // 沒有角色 slot 的場景：只顯示名字
  if (slots.length === 0) {
    for (const id of participantNames.keys()) {
      plates[id] = { name: nameOf(id), color: ROLE_COLORS[0], active: true, speaking: speaking.has(id) };
    }
  }
  return plates;
}

// ─── 名牌避讓 ──────────────────────────────────────────────────────────────

export interface PlateBox {
  id: string;
  /** 錨點（頭頂）x，像素 */
  x: number;
  /** 錨點 y（名牌底邊），像素 */
  y: number;
  w: number;
  h: number;
}

export type PlateOffsets = Record<string, { dx: number; dy: number }>;

/**
 * 角色站得近時名牌會疊在一起：先左右推開（每邊最多移 maxShift），
 * 推到上限仍重疊的，錨點較高（y 較小）的那個往上疊一層。最後夾在畫面內。
 */
export function layoutNameplates(
  boxes: readonly PlateBox[],
  width: number,
  opts: { gap?: number; margin?: number; maxShift?: number } = {},
): PlateOffsets {
  const gap = opts.gap ?? 8;
  const margin = opts.margin ?? 8;
  const items = boxes.map(b => ({ ...b, cx: b.x, by: b.y }));
  const maxShift = (b: PlateBox) => opts.maxShift ?? b.w * 0.75;
  const vOverlap = (a: typeof items[number], b: typeof items[number]) =>
    a.by - a.h < b.by && b.by - b.h < a.by;
  const hOverlap = (a: typeof items[number], b: typeof items[number]) =>
    (a.w + b.w) / 2 + gap - Math.abs(a.cx - b.cx);

  // ① 左右推開：依 x 排序，相鄰重疊的各退一半，多跑幾輪讓連鎖重疊也散開
  items.sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
  for (let round = 0; round < 8; round++) {
    let moved = false;
    for (let i = 0; i < items.length - 1; i++) {
      const a = items[i];
      const b = items[i + 1];
      if (!vOverlap(a, b)) continue;
      const over = hOverlap(a, b);
      if (over <= 0.5) continue;
      const pushA = Math.min(over / 2, Math.max(0, maxShift(a) - (a.x - a.cx)));
      const pushB = Math.min(over / 2, Math.max(0, maxShift(b) - (b.cx - b.x)));
      if (pushA + pushB < 0.5) continue;
      a.cx -= pushA;
      b.cx += pushB;
      moved = true;
    }
    if (!moved) break;
  }

  // ② 仍重疊：錨點較高者往上疊（由下往上處理，疊過的也會跟後面的比）
  const byHeight = [...items].sort((a, b) => b.y - a.y || a.id.localeCompare(b.id));
  for (let i = 0; i < byHeight.length; i++) {
    const cur = byHeight[i];
    for (let j = 0; j < i; j++) {
      const below = byHeight[j];
      if (vOverlap(cur, below) && hOverlap(cur, below) > 0.5) cur.by = below.by - below.h - gap / 2;
    }
  }

  // ③ 夾在畫面內
  const out: PlateOffsets = {};
  for (const it of items) {
    const half = it.w / 2;
    const cx = width > it.w + margin * 2 ? Math.min(Math.max(it.cx, half + margin), width - half - margin) : it.cx;
    const by = Math.max(it.by, it.h + margin);
    out[it.id] = { dx: Math.round(cx - it.x), dy: Math.round(by - it.y) };
  }
  return out;
}
