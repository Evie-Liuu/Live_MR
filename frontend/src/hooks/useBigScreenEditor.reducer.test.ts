import { describe, it, expect, vi } from 'vitest'
import {
  initialEditorState,
  editorReducer,
  type EditorDraft,
  COALESCE_WINDOW_MS,
} from './useBigScreenEditor.reducer'

vi.mock('../config/sceneOccluders', () => ({
  OCCLUDER_LIBRARY_BY_ID: {
    rack: { id: 'rack', label: '衣架', glbUrl: '/x.glb', defaultScale: 1 },
  },
}))

const baseDraft: EditorDraft = {
  sceneId: 'scene1',
  occluders: [],
  groupTransforms: {},
}

describe('editorReducer — add-occluder', () => {
  it('appends a new instance with default transform', () => {
    const state = initialEditorState(baseDraft)
    const next = editorReducer(state, {
      type: 'add-occluder',
      libraryId: 'rack',
      instanceId: 'fixed-id-1',
    })
    expect(next.draft.occluders).toHaveLength(1)
    expect(next.draft.occluders[0]).toMatchObject({
      instanceId: 'fixed-id-1',
      libraryId: 'rack',
      position: [0, 1, -1],
      rotation: [0, 0, 0],
      scale: 1,
    })
    expect(next.selection).toEqual({ kind: 'occluder', id: 'fixed-id-1' })
    expect(next.dirty).toBe(true)
  })

  it('does nothing when libraryId is unknown', () => {
    const state = initialEditorState(baseDraft)
    const next = editorReducer(state, {
      type: 'add-occluder',
      libraryId: 'unknown',
      instanceId: 'x',
    })
    expect(next).toBe(state)
  })
})

describe('editorReducer — update-occluder', () => {
  it('merges patch and bumps dirty', () => {
    const seed: EditorDraft = {
      ...baseDraft,
      occluders: [{ instanceId: 'a', libraryId: 'rack', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }],
    }
    const state = initialEditorState(seed)
    const next = editorReducer(state, {
      type: 'update-occluder',
      instanceId: 'a',
      patch: { position: [1, 2, 3] },
    })
    expect(next.draft.occluders[0].position).toEqual([1, 2, 3])
    expect(next.dirty).toBe(true)
  })
})

describe('editorReducer — delete-occluder', () => {
  it('removes instance and clears selection if matched', () => {
    const seed: EditorDraft = {
      ...baseDraft,
      occluders: [{ instanceId: 'a', libraryId: 'rack', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }],
    }
    let state = initialEditorState(seed)
    state = editorReducer(state, { type: 'select', sel: { kind: 'occluder', id: 'a' } })
    const next = editorReducer(state, { type: 'delete-occluder', instanceId: 'a' })
    expect(next.draft.occluders).toHaveLength(0)
    expect(next.selection).toBeNull()
  })
})

describe('editorReducer — duplicate-occluder', () => {
  it('clones with new instanceId and offset position', () => {
    const seed: EditorDraft = {
      ...baseDraft,
      occluders: [{ instanceId: 'a', libraryId: 'rack', position: [1, 1, 1], rotation: [0, 0, 0], scale: 2 }],
    }
    const state = initialEditorState(seed)
    const next = editorReducer(state, { type: 'duplicate-occluder', instanceId: 'a', newInstanceId: 'b' })
    expect(next.draft.occluders).toHaveLength(2)
    expect(next.draft.occluders[1]).toMatchObject({
      instanceId: 'b',
      libraryId: 'rack',
      position: [1.3, 1, 1.3],
      scale: 2,
    })
    expect(next.selection).toEqual({ kind: 'occluder', id: 'b' })
  })

  it('respects MAX_OCCLUDERS_PER_SCENE', () => {
    const seed: EditorDraft = {
      ...baseDraft,
      occluders: Array.from({ length: 10 }, (_, i) => ({
        instanceId: `i${i}`, libraryId: 'rack', position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: 1,
      })),
    }
    const state = initialEditorState(seed)
    const next = editorReducer(state, { type: 'duplicate-occluder', instanceId: 'i0', newInstanceId: 'new' })
    expect(next).toBe(state)
  })
})

describe('editorReducer — update-group + coalesce', () => {
  it('two updates within window collapse to one undo entry', () => {
    let s = initialEditorState({ sceneId: 'x', occluders: [], groupTransforms: {} })
    s = editorReducer(s, { type: 'update-group', groupId: 'g1', transform: { pos: [1, 0, 0], rot: [0, 0, 0] }, ts: 1000 })
    expect(s.past).toHaveLength(1)
    s = editorReducer(s, { type: 'update-group', groupId: 'g1', transform: { pos: [2, 0, 0], rot: [0, 0, 0] }, ts: 1000 + COALESCE_WINDOW_MS - 50 })
    expect(s.past).toHaveLength(1) // coalesced
    expect(s.draft.groupTransforms.g1.pos).toEqual([2, 0, 0])
  })

  it('updates beyond window push new entry', () => {
    let s = initialEditorState({ sceneId: 'x', occluders: [], groupTransforms: {} })
    s = editorReducer(s, { type: 'update-group', groupId: 'g1', transform: { pos: [1, 0, 0], rot: [0, 0, 0] }, ts: 1000 })
    s = editorReducer(s, { type: 'update-group', groupId: 'g1', transform: { pos: [2, 0, 0], rot: [0, 0, 0] }, ts: 1000 + COALESCE_WINDOW_MS + 1 })
    expect(s.past).toHaveLength(2)
  })

  it('different targets do not coalesce', () => {
    let s = initialEditorState({ sceneId: 'x', occluders: [], groupTransforms: {} })
    s = editorReducer(s, { type: 'update-group', groupId: 'g1', transform: { pos: [1, 0, 0], rot: [0, 0, 0] }, ts: 1000 })
    s = editorReducer(s, { type: 'update-group', groupId: 'g2', transform: { pos: [1, 0, 0], rot: [0, 0, 0] }, ts: 1001 })
    expect(s.past).toHaveLength(2)
  })
})

describe('editorReducer — reset-item', () => {
  it('resets occluder to library default', () => {
    let s = initialEditorState({
      sceneId: 'x',
      occluders: [{ instanceId: 'a', libraryId: 'rack', position: [5, 5, 5], rotation: [1, 1, 1], scale: 3 }],
      groupTransforms: {},
    })
    s = editorReducer(s, { type: 'reset-item', kind: 'occluder', id: 'a' })
    expect(s.draft.occluders[0]).toMatchObject({ position: [0, 1, -1], rotation: [0, 0, 0], scale: 1 })
    expect(s.past).toHaveLength(1)
  })

  it('resets group to identity', () => {
    let s = initialEditorState({
      sceneId: 'x',
      occluders: [],
      groupTransforms: { g1: { pos: [3, 3, 3], rot: [1, 1, 1] } },
    })
    s = editorReducer(s, { type: 'reset-item', kind: 'group', id: 'g1' })
    expect(s.draft.groupTransforms.g1).toEqual({ pos: [0, 0, 0], rot: [0, 0, 0] })
  })

  it('no-op on missing id', () => {
    const seed = initialEditorState({ sceneId: 'x', occluders: [], groupTransforms: {} })
    const next = editorReducer(seed, { type: 'reset-item', kind: 'group', id: 'missing' })
    expect(next).toBe(seed)
  })
})

describe('editorReducer — reset-scene', () => {
  it('empties draft and clears selection', () => {
    let s = initialEditorState({
      sceneId: 'x',
      occluders: [{ instanceId: 'a', libraryId: 'rack', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }],
      groupTransforms: { g: { pos: [1, 0, 0], rot: [0, 0, 0] } },
    })
    s = editorReducer(s, { type: 'select', sel: { kind: 'occluder', id: 'a' } })
    s = editorReducer(s, { type: 'reset-scene' })
    expect(s.draft.occluders).toEqual([])
    expect(s.draft.groupTransforms).toEqual({})
    expect(s.selection).toBeNull()
    expect(s.dirty).toBe(true)
  })
})

describe('editorReducer — undo / redo', () => {
  it('undo restores prior state and pushes to future', () => {
    let s = initialEditorState({ sceneId: 'x', occluders: [], groupTransforms: {} })
    s = editorReducer(s, { type: 'add-occluder', libraryId: 'rack', instanceId: 'a' })
    expect(s.draft.occluders).toHaveLength(1)
    s = editorReducer(s, { type: 'undo' })
    expect(s.draft.occluders).toHaveLength(0)
    expect(s.future).toHaveLength(1)
  })

  it('redo replays', () => {
    let s = initialEditorState({ sceneId: 'x', occluders: [], groupTransforms: {} })
    s = editorReducer(s, { type: 'add-occluder', libraryId: 'rack', instanceId: 'a' })
    s = editorReducer(s, { type: 'undo' })
    s = editorReducer(s, { type: 'redo' })
    expect(s.draft.occluders).toHaveLength(1)
    expect(s.future).toHaveLength(0)
  })

  it('new mutation after undo discards future', () => {
    let s = initialEditorState({ sceneId: 'x', occluders: [], groupTransforms: {} })
    s = editorReducer(s, { type: 'add-occluder', libraryId: 'rack', instanceId: 'a' })
    s = editorReducer(s, { type: 'undo' })
    s = editorReducer(s, { type: 'add-occluder', libraryId: 'rack', instanceId: 'b' })
    expect(s.future).toHaveLength(0)
    expect(s.draft.occluders[0].instanceId).toBe('b')
  })

  it('undo on empty past is no-op', () => {
    const seed = initialEditorState({ sceneId: 'x', occluders: [], groupTransforms: {} })
    const next = editorReducer(seed, { type: 'undo' })
    expect(next).toBe(seed)
  })
})

describe('editorReducer — commit / discard', () => {
  it('commit clears history + dirty + updates baseline', () => {
    let s = initialEditorState({ sceneId: 'x', occluders: [], groupTransforms: {} })
    s = editorReducer(s, { type: 'update-group', groupId: 'g', transform: { pos: [1, 0, 0], rot: [0, 0, 0] } })
    s = editorReducer(s, { type: 'commit' })
    expect(s.past).toHaveLength(0)
    expect(s.future).toHaveLength(0)
    expect(s.dirty).toBe(false)
    expect(s.baselineGroupTransforms).toEqual({ g: { pos: [1, 0, 0], rot: [0, 0, 0] } })
  })

  it('discard clears history + dirty, keeps draft', () => {
    let s = initialEditorState({ sceneId: 'x', occluders: [], groupTransforms: {} })
    s = editorReducer(s, { type: 'update-group', groupId: 'g', transform: { pos: [1, 0, 0], rot: [0, 0, 0] } })
    const before = s.draft
    s = editorReducer(s, { type: 'discard' })
    expect(s.dirty).toBe(false)
    expect(s.past).toHaveLength(0)
    expect(s.draft).toBe(before)
  })
})
