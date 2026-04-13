import type { SceneConfig, ThemeConfig } from '../types/vrm';

// ─────────────────────────────────────────────────────────────────────────────
// Teaching Hierarchy
//   Theme (主題)  →  Scene (場景)  →  Module (教學功能層)  →  TaskItem (實際任務)
//
// THEMES drives the HostSession picker UI.
// SCENE_PRESETS is the flat map consumed by BigScreen / Three.js rendering;
//   it is auto-generated from THEMES so you only need to edit THEMES.
// ─────────────────────────────────────────────────────────────────────────────

export const THEMES: ThemeConfig[] = [
  // ── 服飾店 ──────────────────────────────────────────────────────────────
  {
    id: 'clothingStore',
    label: '服飾店',
    icon: '👗',
    scenes: [
      // ── Scene 1：收銀台 ───────────────────────────────────────────────
      {
        id: 'clothingStore_cashier',
        label: '收銀台',
        icon: '🏪',
        allowedVrmIds: [
          'default',
          'student_male',
          'student_female',
          'teenager_male',
          'teenager_female',
          'clothingStoreStaff_female',
          'clothingStoreStaff_male',
        ],
        slots: [
          {
            id: 'cashier',
            label: '收銀員',
            icon: '🏪',
            position: [1.2, 0, -1.5],
            // rotation: [0, -Math.PI / 3, 0],
            defaultVrmId: 'clothingStoreStaff_female',
          },
          {
            id: 'customer',
            label: '顧客',
            icon: '🛍️',
            position: [-1.2, 0, -1.5],
            // rotation: [0, Math.PI / 3, 0],
            defaultVrmId: 'default',
          },
        ],
        modules: [
          {
            id: 'ask_price',
            label: 'Ask for a Price',
            icon: '💰',
            tasks: [
              { id: 'ask_price_1', label: 'Ask for the price of a blue T-shirt.' },
              { id: 'ask_price_2', label: 'Ask how much the black jacket costs.' },
              { id: 'ask_price_3', label: 'Ask if there is a discount on jeans.' },
            ],
          },
          {
            id: 'ask_size',
            label: 'Ask about Sizes',
            icon: '📏',
            tasks: [
              { id: 'ask_size_1', label: 'Ask if the dress comes in size S.' },
              { id: 'ask_size_2', label: 'Ask the staff to help you find a larger pair of trousers.' },
              { id: 'ask_size_3', label: 'Ask whether the shoes are available in EU 42.' },
            ],
          },
          {
            id: 'make_complaint',
            label: 'Make a Complaint',
            icon: '😠',
            tasks: [
              { id: 'make_complaint_1', label: 'Complain that the zipper on your new jacket is broken.' },
              { id: 'make_complaint_2', label: 'Say that the colour faded after one wash.' },
              { id: 'make_complaint_3', label: 'Ask for a refund for a defective item.' },
            ],
          },
          {
            id: 'ask_recommendation',
            label: 'Ask for a Recommendation',
            icon: '🌟',
            tasks: [
              { id: 'ask_rec_1', label: 'Ask the staff what is popular this season.' },
              { id: 'ask_rec_2', label: 'Ask for a recommendation for a casual outfit.' },
              { id: 'ask_rec_3', label: 'Ask which colour looks best for a formal occasion.' },
            ],
          },
        ],
      },

      // ── Scene 2：試衣間 ───────────────────────────────────────────────
      {
        id: 'clothingStore_fitting',
        label: '試衣間',
        icon: '🪞',
        allowedVrmIds: [
          'default',
          'student_male',
          'student_female',
          'teenager_male',
          'teenager_female',
          'clothingStoreStaff_female',
          'clothingStoreStaff_male',
        ],
        slots: [
          {
            id: 'staff',
            label: '店員',
            icon: '🧑‍💼',
            position: [1.2, 0, -1.5],
            // rotation: [0, -Math.PI / 3, 0],
            defaultVrmId: 'clothingStoreStaff_female',
          },
          {
            id: 'shopper',
            label: '試穿顧客',
            icon: '👕',
            position: [-1.2, 0, -1.5],
            // rotation: [0, Math.PI / 3, 0],
            defaultVrmId: 'default',
          },
        ],
        modules: [
          {
            id: 'try_on',
            label: 'Try On Items',
            icon: '👗',
            tasks: [
              { id: 'try_on_1', label: 'Ask if you can try on the red dress.' },
              { id: 'try_on_2', label: 'Tell the staff the item does not fit.' },
              { id: 'try_on_3', label: 'Ask for a different colour to try.' },
            ],
          },
          {
            id: 'return_exchange',
            label: 'Return or Exchange',
            icon: '🔄',
            tasks: [
              { id: 'return_exchange_1', label: 'Ask how to return an item bought online.' },
              { id: 'return_exchange_2', label: 'Request an exchange for the same item in a different size.' },
              { id: 'return_exchange_3', label: 'Explain that you have the receipt and want a refund.' },
            ],
          },
        ],
      },
    ],
  },

  // ─── 更多主題可繼續在此新增 ──────────────────────────────────────────────
];

// ─────────────────────────────────────────────────────────────────────────────
// Auto-generate flat SCENE_PRESETS from THEMES
// BigScreen / Three.js only needs SceneConfig; we keep the
// camera / lights / background shared per Theme here, then override
// scene-variant-specific fields (slots, allowedVrmIds, modules).
// ─────────────────────────────────────────────────────────────────────────────

/** Camera / lights / background shared by ALL scenes in the 服飾店 theme */
const CLOTHING_STORE_BASE: Omit<SceneConfig, 'id' | 'label' | 'slots' | 'allowedVrmIds' | 'modules'> = {
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
  avatarDefaults: { position: [0, 0, -1.5], scale: 1.5 },
  avatarSpacing: 1.6,
};

/** Map of SceneVariant ID → partial base config for base lookup */
const SCENE_BASE_MAP: Record<string, Omit<SceneConfig, 'id' | 'label' | 'slots' | 'allowedVrmIds' | 'modules'>> = {
  clothingStore: CLOTHING_STORE_BASE,
};

function buildScenePresets(): Record<string, SceneConfig> {
  const presets: Record<string, SceneConfig> = {};
  for (const theme of THEMES) {
    // Use theme id prefix to find the matching base config
    const base = SCENE_BASE_MAP[theme.id] ?? CLOTHING_STORE_BASE;
    for (const variant of theme.scenes) {
      presets[variant.id] = {
        ...base,
        id: variant.id,
        label: `${theme.label} · ${variant.label}`,
        slots: variant.slots,
        allowedVrmIds: variant.allowedVrmIds,
        modules: variant.modules,
      };
    }
  }
  return presets;
}

export const SCENE_PRESETS: Record<string, SceneConfig> = buildScenePresets();

/** Default scene used on first load (first scene of first theme) */
export const DEFAULT_SCENE_ID: string = THEMES[0].scenes[0].id;
