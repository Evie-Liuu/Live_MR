import { describe, it, expect, vi } from 'vitest'
import {
  initialEditorState,
  editorReducer,
  type EditorDraft,
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
