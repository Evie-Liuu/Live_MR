/**
 * Editor reducer — 純函數版本,所有純邏輯都在這裡。
 * React hook (`useBigScreenEditor.ts`) 只負責 dispatch、副作用(localStorage / channel / onCommit)。
 *
 * 設計重點:
 *  - 任何 mutation 都產生新的 `draft` snapshot(immutable)。
 *  - 隨 mutation 自動推進 dirty / undo stack;reducer 本身不知道 localStorage。
 *  - instanceId 由呼叫端提供(便於測試與 SSR-safe);hook 端用 crypto.randomUUID()。
 */
import type { SceneOccluderInstance } from '../types/sceneOccluder'
import { OCCLUDER_LIBRARY_BY_ID } from '../config/sceneOccluders'
import { defaultOccluderTransform } from '../utils/occluderDefaults'
import { IDENTITY_TRANSFORM, type Vec3 } from '../utils/groupTransform'

export const MAX_OCCLUDERS_PER_SCENE = 10
export const UNDO_STACK_LIMIT = 50
export const COALESCE_WINDOW_MS = 400

export type StoredGroupTransform = { pos: Vec3; rot: Vec3 }

export type EditorDraft = {
  sceneId: string
  occluders: SceneOccluderInstance[]
  groupTransforms: Record<string, StoredGroupTransform>
  /** 隱藏的 group id 集合(只記錄 hidden = true 的;缺項 = 顯示)。 */
  groupHidden: Record<string, true>
}

export type Selection =
  | { kind: 'occluder'; id: string }
  | { kind: 'group'; id: string }
  | null

export type GizmoMode = 'translate' | 'rotate'

export type EditorState = {
  draft: EditorDraft
  selection: Selection
  gizmoMode: GizmoMode
  past: EditorDraft[]
  future: EditorDraft[]
  dirty: boolean
  /** 最近一筆 update action 的 (kind, id, ts);用於 coalesce 判斷。 */
  lastUpdate: { kind: 'occluder' | 'group'; id: string; ts: number } | null
  /** 進入編輯模式 / 最近一次 commit 後的 baseline,用於 commit 時 diff group。 */
  baselineGroupTransforms: Record<string, StoredGroupTransform>
}

export type EditorAction =
  | { type: 'add-occluder'; libraryId: string; instanceId: string }
  | { type: 'update-occluder'; instanceId: string; patch: Partial<SceneOccluderInstance>; ts?: number }
  | { type: 'delete-occluder'; instanceId: string }
  | { type: 'duplicate-occluder'; instanceId: string; newInstanceId: string }
  | { type: 'update-group'; groupId: string; transform: StoredGroupTransform; ts?: number }
  | { type: 'toggle-group-hidden'; groupId: string }
  | { type: 'reset-item'; kind: 'occluder' | 'group'; id: string }
  | { type: 'reset-scene' }
  | { type: 'select'; sel: Selection }
  | { type: 'deselect' }
  | { type: 'gizmo-mode'; mode: GizmoMode }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'commit' }
  | { type: 'discard' }
  | { type: 'load-scene'; draft: EditorDraft }

export function initialEditorState(draft: EditorDraft): EditorState {
  return {
    draft,
    selection: null,
    gizmoMode: 'translate',
    past: [],
    future: [],
    dirty: false,
    lastUpdate: null,
    baselineGroupTransforms: { ...draft.groupTransforms },
  }
}

function pushHistory(state: EditorState, nextDraft: EditorDraft, coalesceKey?: { kind: 'occluder' | 'group'; id: string; ts: number }): EditorState {
  // Coalesce: same target update within COALESCE_WINDOW_MS → overwrite top of past instead of push.
  const last = state.lastUpdate
  if (coalesceKey && last && last.kind === coalesceKey.kind && last.id === coalesceKey.id && coalesceKey.ts - last.ts < COALESCE_WINDOW_MS) {
    return { ...state, draft: nextDraft, future: [], dirty: true, lastUpdate: coalesceKey }
  }
  const past = [...state.past, state.draft]
  if (past.length > UNDO_STACK_LIMIT) past.shift()
  return {
    ...state,
    draft: nextDraft,
    past,
    future: [],
    dirty: true,
    lastUpdate: coalesceKey ?? null,
  }
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'add-occluder': {
      if (!OCCLUDER_LIBRARY_BY_ID[action.libraryId]) return state
      if (state.draft.occluders.length >= MAX_OCCLUDERS_PER_SCENE) return state
      const t = defaultOccluderTransform(action.libraryId)
      const instance: SceneOccluderInstance = {
        instanceId: action.instanceId,
        libraryId: action.libraryId,
        position: t.position,
        rotation: t.rotation,
        scale: t.scale,
      }
      const nextDraft = { ...state.draft, occluders: [...state.draft.occluders, instance] }
      return {
        ...pushHistory(state, nextDraft),
        selection: { kind: 'occluder', id: instance.instanceId },
      }
    }
    case 'update-occluder': {
      const idx = state.draft.occluders.findIndex(o => o.instanceId === action.instanceId)
      if (idx < 0) return state
      const merged = { ...state.draft.occluders[idx], ...action.patch }
      const occluders = state.draft.occluders.slice()
      occluders[idx] = merged
      const nextDraft = { ...state.draft, occluders }
      const ts = action.ts ?? Date.now()
      return pushHistory(state, nextDraft, { kind: 'occluder', id: action.instanceId, ts })
    }
    case 'delete-occluder': {
      const occluders = state.draft.occluders.filter(o => o.instanceId !== action.instanceId)
      if (occluders.length === state.draft.occluders.length) return state
      const nextDraft = { ...state.draft, occluders }
      const next = pushHistory(state, nextDraft)
      const sel = state.selection?.kind === 'occluder' && state.selection.id === action.instanceId ? null : state.selection
      return { ...next, selection: sel }
    }
    case 'duplicate-occluder': {
      if (state.draft.occluders.length >= MAX_OCCLUDERS_PER_SCENE) return state
      const src = state.draft.occluders.find(o => o.instanceId === action.instanceId)
      if (!src) return state
      const dup: SceneOccluderInstance = {
        ...src,
        instanceId: action.newInstanceId,
        position: [src.position[0] + 0.3, src.position[1], src.position[2] + 0.3],
      }
      const nextDraft = { ...state.draft, occluders: [...state.draft.occluders, dup] }
      return {
        ...pushHistory(state, nextDraft),
        selection: { kind: 'occluder', id: dup.instanceId },
      }
    }
    case 'update-group': {
      const nextDraft = {
        ...state.draft,
        groupTransforms: { ...state.draft.groupTransforms, [action.groupId]: action.transform },
      }
      const ts = action.ts ?? Date.now()
      return pushHistory(state, nextDraft, { kind: 'group', id: action.groupId, ts })
    }
    case 'reset-item': {
      if (action.kind === 'occluder') {
        const idx = state.draft.occluders.findIndex(o => o.instanceId === action.id)
        if (idx < 0) return state
        const src = state.draft.occluders[idx]
        const t = defaultOccluderTransform(src.libraryId)
        const occluders = state.draft.occluders.slice()
        occluders[idx] = { ...src, position: t.position, rotation: t.rotation, scale: t.scale }
        return pushHistory(state, { ...state.draft, occluders })
      } else {
        if (!(action.id in state.draft.groupTransforms)) return state
        const groupTransforms = { ...state.draft.groupTransforms }
        groupTransforms[action.id] = { pos: IDENTITY_TRANSFORM.pos, rot: IDENTITY_TRANSFORM.rot }
        return pushHistory(state, { ...state.draft, groupTransforms })
      }
    }
    case 'toggle-group-hidden': {
      const groupHidden = { ...state.draft.groupHidden }
      if (groupHidden[action.groupId]) delete groupHidden[action.groupId]
      else groupHidden[action.groupId] = true
      return pushHistory(state, { ...state.draft, groupHidden })
    }
    case 'reset-scene': {
      const nextDraft = { ...state.draft, occluders: [], groupTransforms: {}, groupHidden: {} }
      return { ...pushHistory(state, nextDraft), selection: null }
    }
    case 'select':
      return { ...state, selection: action.sel }
    case 'deselect':
      return { ...state, selection: null }
    case 'gizmo-mode':
      return { ...state, gizmoMode: action.mode }
    case 'undo': {
      if (state.past.length === 0) return state
      const prev = state.past[state.past.length - 1]
      const past = state.past.slice(0, -1)
      const future = [state.draft, ...state.future]
      return { ...state, draft: prev, past, future, dirty: true, lastUpdate: null }
    }
    case 'redo': {
      if (state.future.length === 0) return state
      const next = state.future[0]
      const future = state.future.slice(1)
      const past = [...state.past, state.draft]
      return { ...state, draft: next, past, future, dirty: true, lastUpdate: null }
    }
    case 'commit':
      return {
        ...state,
        past: [],
        future: [],
        dirty: false,
        lastUpdate: null,
        baselineGroupTransforms: { ...state.draft.groupTransforms },
      }
    case 'discard':
      return {
        ...state,
        past: [],
        future: [],
        dirty: false,
        lastUpdate: null,
      }
    case 'load-scene':
      return initialEditorState(action.draft)
  }
}
