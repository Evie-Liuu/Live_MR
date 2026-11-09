/**
 * savedSceneLayout.ts
 *
 * 大螢幕編輯模式存下來的場景擺放（存在 localStorage，以 sceneId 分開）：
 * 群組移動／旋轉、隱藏的群組、遮罩物件。劇本模擬器讀同一份，讓物件擺放跟上課時一致。
 */
import type { GroupMemberRef, SceneConfig } from '../types/vrm';
import type { SceneOccluderInstance } from '../types/sceneOccluder';
import { applyGroupTransform, computePivot, IDENTITY_TRANSFORM, type Vec3 } from './groupTransform';

export const GROUP_TRANSFORMS_KEY = 'bigscreen-group-transforms';
export const GROUP_HIDDEN_KEY = 'bigscreen-group-hidden';
export const OCCLUDERS_KEY = 'bigscreen-scene-occluders';

export type GroupTransform = { pos: Vec3; rot: Vec3 };

export interface SavedSceneLayout {
  groupTransforms: Record<string, GroupTransform>;
  groupHidden: Record<string, true>;
  occluders: SceneOccluderInstance[];
}

function readForScene<T>(storage: Pick<Storage, 'getItem'>, key: string, sceneId: string): T | undefined {
  try {
    const all = JSON.parse(storage.getItem(key) || '{}') as Record<string, T>;
    return all[sceneId];
  } catch {
    return undefined;
  }
}

/** 讀某場景存下來的擺放；沒存過或資料壞掉就回空設定（等於場景預設擺法） */
export function readSavedSceneLayout(sceneId: string, storage: Pick<Storage, 'getItem'> = localStorage): SavedSceneLayout {
  const occluders = readForScene<SceneOccluderInstance[]>(storage, OCCLUDERS_KEY, sceneId);
  return {
    groupTransforms: readForScene<Record<string, GroupTransform>>(storage, GROUP_TRANSFORMS_KEY, sceneId) ?? {},
    groupHidden: readForScene<Record<string, true>>(storage, GROUP_HIDDEN_KEY, sceneId) ?? {},
    occluders: Array.isArray(occluders) ? occluders : [],
  };
}

export const memberKey = (ref: GroupMemberRef) => `${ref.kind}:${ref.id}`;

function memberBase(ref: GroupMemberRef, preset: SceneConfig): GroupTransform | null {
  if (ref.kind === 'slot') {
    const s = preset.slots?.find(x => x.id === ref.id);
    return s ? { pos: s.position, rot: s.rotation ?? [0, 0, 0] } : null;
  }
  if (ref.kind === 'staticProp') {
    const p = preset.propSystem?.staticProps?.find(x => x.id === ref.id);
    return p ? { pos: p.position, rot: p.rotation ?? [0, 0, 0] } : null;
  }
  const t = preset.propSystem?.taskProps?.[ref.id];
  return t ? { pos: t.displayPos, rot: t.rotation ?? [0, 0, 0] } : null;
}

/**
 * 套用群組變換後每個成員的位置與角度（key 見 memberKey），算法與大螢幕相同：
 * 支點用場景設定的原始座標算；角色腳貼地，高度固定用 slotY。
 * 不在任何群組裡的物件不會出現在結果中，維持場景預設位置。
 */
export function resolveGroupPlacements(
  preset: SceneConfig,
  transforms: Record<string, GroupTransform>,
  slotY: number,
): Map<string, GroupTransform> {
  const out = new Map<string, GroupTransform>();
  for (const g of preset.groups ?? []) {
    const t = transforms[g.id] ?? IDENTITY_TRANSFORM;
    const pivot = g.pivot ?? computePivot(
      g.members.map(m => memberBase(m, preset)).filter((b): b is GroupTransform => b !== null).map(b => b.pos),
    );
    for (const m of g.members) {
      const base = memberBase(m, preset);
      if (!base) continue;
      const from = m.kind === 'slot' ? { pos: [base.pos[0], slotY, base.pos[2]] as Vec3, rot: base.rot } : base;
      out.set(memberKey(m), applyGroupTransform(from, pivot, t));
    }
  }
  return out;
}

/** 被隱藏的群組裡的所有成員（key 見 memberKey） */
export function hiddenMembers(preset: SceneConfig, groupHidden: Record<string, true>): Set<string> {
  const out = new Set<string>();
  for (const g of preset.groups ?? []) {
    if (groupHidden[g.id]) for (const m of g.members) out.add(memberKey(m));
  }
  return out;
}
