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
  // ── 0. Clothing Store (dark, grid floor) ──────────────────────────────
  clothingStore: {
    id: 'clothingStore',
    label: '服飾店',
    camera: {
      fov: 40,
      position: [0, 1.5, 5],
      lookAt: [0, 1.5, 0],
      near: 0.1,
      far: 50,
    },
    lights: [
      { type: 'ambient', color: 0xffffff, intensity: 0.7 },
      { type: 'directional', color: 0xffffff, intensity: 0.9, position: [2, 4, 2] },
      { type: 'directional', color: 0x8888ff, intensity: 0.3, position: [-2, 1, -2] },
    ],
    backgroundType: 'image',
    backgroundValue: '/images/clothingStore.png',
    grid: { size: 20, divisions: 20, color: 0x2a2a4a },
    allowedVrmIds: ['default', 'student_male', 'student_female', 'teenager_male', 'teenager_female'],
    avatarDefaults: { position: [0, 0, -1.5], scale: 1.5 },
    avatarSpacing: 1.6,
    slots: [
      {
        id: 'cashier',
        label: '收銀員',
        icon: '🏪',
        position: [1.2, 0, -1.5],
        rotation: [0, -0.3, 0],
        defaultVrmId: 'student_female',
      },
      {
        id: 'customer',
        label: '顧客',
        icon: '🛍️',
        position: [-1.2, 0, -1.5],
        rotation: [0, 0.3, 0],
        defaultVrmId: 'student_male',
      },
    ],
    tasks: [
      'Ask for a Price',
      'Ask about Sizes',
      'Make a Complaint',
      'Ask for a Recommendation',
    ],
  },

} as const;

/** Default scene used on first load */
export const DEFAULT_SCENE_ID = 'clothingStore';
