import { describe, it, expect, vi } from 'vitest'
import { defaultOccluderTransform } from './occluderDefaults'

vi.mock('../config/sceneOccluders', () => ({
  OCCLUDER_LIBRARY_BY_ID: {
    rack: { id: 'rack', label: '衣架', glbUrl: '/x.glb', defaultScale: 1.5 },
    noScale: { id: 'noScale', label: 'No Scale', glbUrl: '/y.glb' },
  },
}))

describe('defaultOccluderTransform', () => {
  it('returns library defaultScale when present', () => {
    expect(defaultOccluderTransform('rack')).toEqual({
      position: [0, 1, -1],
      rotation: [0, 0, 0],
      scale: 1.5,
    })
  })

  it('falls back to 1 when defaultScale is undefined', () => {
    expect(defaultOccluderTransform('noScale').scale).toBe(1)
  })

  it('falls back to 1 when libraryId is unknown', () => {
    expect(defaultOccluderTransform('missing').scale).toBe(1)
  })
})
