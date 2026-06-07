/**
 * useBigScreenEditor — BigScreen 編輯模式狀態與副作用。
 * 純函數規則在 `useBigScreenEditor.reducer.ts`;本檔負責:
 *  - 把 sceneId 變化 → reducer `load-scene`。
 *  - commit 時寫兩支 localStorage、廣播 channel、呼叫 onCommit。
 *  - 包裝 dispatch 提供穩定的 wrapper API(自動補 instanceId / ts)。
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import type { SceneOccluderInstance } from '../types/sceneOccluder'
import {
  initialEditorState,
  editorReducer,
  type EditorAction,
  type EditorDraft,
  type EditorState,
  type Selection,
  type StoredGroupTransform,
} from './useBigScreenEditor.reducer'

const OCCLUDERS_KEY = 'bigscreen-scene-occluders'
const GROUP_TRANSFORMS_KEY = 'bigscreen-group-transforms'
const GROUP_HIDDEN_KEY = 'bigscreen-group-hidden'

function loadOccludersForScene(sceneId: string): SceneOccluderInstance[] {
  try {
    const all = JSON.parse(localStorage.getItem(OCCLUDERS_KEY) || '{}') as Record<string, SceneOccluderInstance[]>
    const list = all[sceneId]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function loadGroupTransformsForScene(sceneId: string): Record<string, StoredGroupTransform> {
  try {
    const all = JSON.parse(localStorage.getItem(GROUP_TRANSFORMS_KEY) || '{}') as Record<string, Record<string, StoredGroupTransform>>
    return all[sceneId] ?? {}
  } catch {
    return {}
  }
}

function loadGroupHiddenForScene(sceneId: string): Record<string, true> {
  try {
    const all = JSON.parse(localStorage.getItem(GROUP_HIDDEN_KEY) || '{}') as Record<string, Record<string, true>>
    return all[sceneId] ?? {}
  } catch {
    return {}
  }
}

function buildInitialDraft(sceneId: string): EditorDraft {
  return {
    sceneId,
    occluders: loadOccludersForScene(sceneId),
    groupTransforms: loadGroupTransformsForScene(sceneId),
    groupHidden: loadGroupHiddenForScene(sceneId),
  }
}

export type BigScreenChannelMsg = {
  type: 'occluders-set' | 'group-transform' | 'group-hidden-set'
  occluders?: SceneOccluderInstance[]
  groupId?: string
  groupTransform?: StoredGroupTransform
  /** For 'group-hidden-set': 整個場景的隱藏 group 集合(覆蓋式)。 */
  groupHidden?: Record<string, true>
}

export interface UseBigScreenEditorOptions {
  sceneId: string
  editMode: boolean
  channel: { postMessage: (m: BigScreenChannelMsg) => void } | null
  /** 由 BigScreen 提供:commit 時用來同步 `occluderInstances` 與 `groupTransforms` 上游 state。 */
  onCommit?: (committed: EditorDraft) => void
  /** quota 等寫入失敗 → 顯示 toast。預設 alert 退路。 */
  onCommitError?: (err: unknown) => void
}

export interface BigScreenEditorApi {
  state: EditorState
  // High-level wrappers
  addOccluder: (libraryId: string) => void
  updateOccluder: (instanceId: string, patch: Partial<SceneOccluderInstance>) => void
  deleteOccluder: (instanceId: string) => void
  duplicateOccluder: (instanceId: string) => void
  updateGroup: (groupId: string, transform: StoredGroupTransform) => void
  toggleGroupHidden: (groupId: string) => void
  resetItem: (kind: 'occluder' | 'group', id: string) => void
  resetScene: () => void
  select: (sel: Selection) => void
  deselect: () => void
  setGizmoMode: (mode: 'translate' | 'rotate') => void
  undo: () => void
  redo: () => void
  commit: () => void
  discard: () => void
  /** Low-level escape hatch */
  dispatch: (a: EditorAction) => void
}

export function useBigScreenEditor(opts: UseBigScreenEditorOptions): BigScreenEditorApi {
  const { sceneId, channel, onCommit, onCommitError } = opts

  const [state, dispatch] = useReducer(
    editorReducer,
    undefined as unknown as EditorState,
    () => initialEditorState(buildInitialDraft(sceneId)),
  )

  // sceneId 變化 → load-scene
  const lastSceneIdRef = useRef(sceneId)
  useEffect(() => {
    if (lastSceneIdRef.current !== sceneId) {
      lastSceneIdRef.current = sceneId
      dispatch({ type: 'load-scene', draft: buildInitialDraft(sceneId) })
    }
  }, [sceneId])

  // Commit 副作用:寫 localStorage、廣播、回呼 onCommit。
  // 用 ref 抓最新 state.draft,避免 commit 時抓到 stale 值。
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  })

  const doCommit = useCallback(() => {
    const cur = stateRef.current
    const baseline = cur.baselineGroupTransforms
    try {
      // 寫 occluders
      const allOcc = JSON.parse(localStorage.getItem(OCCLUDERS_KEY) || '{}') as Record<string, SceneOccluderInstance[]>
      allOcc[cur.draft.sceneId] = cur.draft.occluders
      localStorage.setItem(OCCLUDERS_KEY, JSON.stringify(allOcc))
      // 寫 group transforms
      const allGT = JSON.parse(localStorage.getItem(GROUP_TRANSFORMS_KEY) || '{}') as Record<string, Record<string, StoredGroupTransform>>
      allGT[cur.draft.sceneId] = cur.draft.groupTransforms
      localStorage.setItem(GROUP_TRANSFORMS_KEY, JSON.stringify(allGT))
      // 寫 group hidden
      const allGH = JSON.parse(localStorage.getItem(GROUP_HIDDEN_KEY) || '{}') as Record<string, Record<string, true>>
      allGH[cur.draft.sceneId] = cur.draft.groupHidden
      localStorage.setItem(GROUP_HIDDEN_KEY, JSON.stringify(allGH))
    } catch (err) {
      onCommitError?.(err)
      return // 不更新 reducer,dirty 保留
    }

    // 廣播 occluders
    channel?.postMessage({ type: 'occluders-set', occluders: cur.draft.occluders })

    // 廣播變動的 group(對比 baseline)
    const allGroupIds = new Set([
      ...Object.keys(cur.draft.groupTransforms),
      ...Object.keys(baseline),
    ])
    for (const groupId of allGroupIds) {
      const nextT = cur.draft.groupTransforms[groupId]
      const baseT = baseline[groupId]
      const changed = !nextT || !baseT
        ? nextT !== baseT
        : (nextT.pos[0] !== baseT.pos[0] || nextT.pos[1] !== baseT.pos[1] || nextT.pos[2] !== baseT.pos[2]
          || nextT.rot[0] !== baseT.rot[0] || nextT.rot[1] !== baseT.rot[1] || nextT.rot[2] !== baseT.rot[2])
      if (changed && nextT) {
        channel?.postMessage({ type: 'group-transform', groupId, groupTransform: nextT })
      }
      // 若 group 被刪 (nextT 不存在 baseT 有) — 目前 reducer 沒有 'delete-group' action,先不發訊息
    }

    // 廣播 group hidden(整組覆蓋)
    channel?.postMessage({ type: 'group-hidden-set', groupHidden: cur.draft.groupHidden })

    onCommit?.(cur.draft)
    dispatch({ type: 'commit' })
  }, [channel, onCommit, onCommitError])

  // Wrapper API
  const api = useMemo<BigScreenEditorApi>(() => ({
    state,
    addOccluder: (libraryId) => dispatch({ type: 'add-occluder', libraryId, instanceId: crypto.randomUUID() }),
    updateOccluder: (instanceId, patch) => dispatch({ type: 'update-occluder', instanceId, patch }),
    deleteOccluder: (instanceId) => dispatch({ type: 'delete-occluder', instanceId }),
    duplicateOccluder: (instanceId) => dispatch({ type: 'duplicate-occluder', instanceId, newInstanceId: crypto.randomUUID() }),
    updateGroup: (groupId, transform) => dispatch({ type: 'update-group', groupId, transform }),
    toggleGroupHidden: (groupId) => dispatch({ type: 'toggle-group-hidden', groupId }),
    resetItem: (kind, id) => dispatch({ type: 'reset-item', kind, id }),
    resetScene: () => dispatch({ type: 'reset-scene' }),
    select: (sel) => dispatch({ type: 'select', sel }),
    deselect: () => dispatch({ type: 'deselect' }),
    setGizmoMode: (mode) => dispatch({ type: 'gizmo-mode', mode }),
    undo: () => dispatch({ type: 'undo' }),
    redo: () => dispatch({ type: 'redo' }),
    commit: doCommit,
    discard: () => dispatch({ type: 'discard' }),
    dispatch,
  }), [state, doCommit])

  return api
}
