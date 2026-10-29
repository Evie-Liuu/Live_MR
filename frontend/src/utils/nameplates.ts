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
  /** 逐句演練目前的發言者 */
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
      speaking: speaking.has(id),
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
