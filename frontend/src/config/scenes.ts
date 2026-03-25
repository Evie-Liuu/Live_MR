import type { SceneConfig } from '../types/vrm';

/**
 * Scene presets for the BigScreen / VRM avatar wall.
 *
 * Each preset controls:
 *  - camera FOV, position, look-at
 *  - lighting setup
 *  - scene background color (or transparent)
 *  - optional floor grid
 *  - avatar spawn defaults (position offset, scale)
 *  - avatar spacing (metres)
 *
 * Add new presets here; the BigScreen scene selector will automatically pick
 * them up.  No other files need editing.
 */
export const SCENE_PRESETS: Record<string, SceneConfig> = {
  // ── 1. Classroom Studio (dark, grid floor) ──────────────────────────────
  classroom: {
    id: 'classroom',
    label: '教室舞台',
    camera: {
      fov: 40,
      position: [0, 1.5, 5],
      lookAt: [0, 1.5, -100],
      near: 0.1,
      far: 50,
    },
    lights: [
      { type: 'ambient', color: 0xffffff, intensity: 0.7 },
      { type: 'directional', color: 0xffffff, intensity: 0.9, position: [2, 4, 2] },
      { type: 'directional', color: 0x8888ff, intensity: 0.3, position: [-2, 1, -2] },
    ],
    // background: 0x1a1a2e,
    backgroundImage: '/images/clothingStore.png',
    grid: { size: 20, divisions: 20, color: 0x2a2a4a },
    avatarDefaults: { position: [0, 0, -1.5], scale: 1.5 },
    avatarSpacing: 1.6,
  },

  // ── 2. Stage Spotlight (darker bg, strong front light) ──────────────────
  stage: {
    id: 'stage',
    label: '舞台聚光',
    camera: {
      fov: 35,
      position: [0, 1.4, 6],
      lookAt: [0, 1.1, 0],
      near: 0.1,
      far: 50,
    },
    lights: [
      { type: 'ambient', color: 0x111122, intensity: 0.4 },
      { type: 'directional', color: 0xffffff, intensity: 1.4, position: [0, 5, 3] },
      { type: 'directional', color: 0x4466ff, intensity: 0.5, position: [-3, 2, -1] },
    ],
    background: 0x0a0a0f,
    grid: false,
    avatarDefaults: { position: [0, 0, 0], scale: 1 },
    avatarSpacing: 1.8,
  },

  // ── 3. Outdoor (bright, no background – transparent canvas) ─────────────
  outdoor: {
    id: 'outdoor',
    label: '戶外明亮',
    camera: {
      fov: 45,
      position: [0, 1.3, 4.5],
      lookAt: [0, 1, 0],
      near: 0.1,
      far: 100,
    },
    lights: [
      { type: 'ambient', color: 0xffeedd, intensity: 1.0 },
      { type: 'directional', color: 0xffffff, intensity: 1.2, position: [5, 8, 3] },
      { type: 'directional', color: 0xaaddff, intensity: 0.4, position: [-3, 3, -5] },
    ],
    // No background → renderer alpha:true + transparent
    background: undefined,
    grid: false,
    avatarDefaults: { position: [0, 0, 0], scale: 1 },
    avatarSpacing: 1.6,
  },

  // ── 4. Studio (single-avatar close-up for solo sessions) ────────────────
  studio: {
    id: 'studio',
    label: '工作室特寫',
    camera: {
      fov: 30,
      position: [0, 1.3, 2.5],
      lookAt: [0, 1, 0],
      near: 0.1,
      far: 20,
    },
    lights: [
      { type: 'ambient', color: 0xffffff, intensity: 0.6 },
      { type: 'directional', color: 0xffffff, intensity: 0.8, position: [1, 2, 1] },
    ],
    background: 0x111118,
    grid: false,
    avatarDefaults: { position: [0, 0, 0], scale: 1 },
    avatarSpacing: 1.4,
  },
} as const;

/** Default scene used on first load */
export const DEFAULT_SCENE_ID = 'classroom';
