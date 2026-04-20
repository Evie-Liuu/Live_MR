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
            defaultVrmId: 'student_male',
          },
        ],
        modules: [
          {
            id: 'ask_price',
            label: 'Ask for a Price',
            icon: '💰',
            tasks: [
              { id: 'ask_price_1', label: 'Ask for the price of a blue T-shirt.' },
              { id: 'ask_price_2', label: 'Ask for the price of a black jacket.' },
              { id: 'ask_price_3', label: 'Ask for the price of the red skirt.' },
              { id: 'ask_price_4', label: 'Ask how much the white shirt is.' },
              { id: 'ask_price_5', label: 'Ask how much the pants are.' },
              { id: 'ask_price_6', label: 'Ask for the total price of two items.' },
              { id: 'ask_price_7', label: 'Ask whether this is the final price.' },
              { id: 'ask_price_8', label: 'Ask whether the displayed price is correct.' },
              { id: 'ask_price_9', label: 'Ask how much the item costs after the discount.' },
              { id: 'ask_price_10', label: 'Ask which item is cheaper.' },
            ],
          },
          {
            id: 'ask_size',
            label: 'Ask about Sizes',
            icon: '📏',
            tasks: [
              { id: 'ask_size_1', label: 'Ask for a medium T-shirt.' },
              { id: 'ask_size_2', label: 'Ask whether the jacket comes in large.' },
              { id: 'ask_size_3', label: 'Ask whether there is a small size.' },
              { id: 'ask_size_4', label: 'Ask for a bigger size.' },
              { id: 'ask_size_5', label: 'Ask for a smaller size.' },
              { id: 'ask_size_6', label: 'Ask what size is available.' },
              { id: 'ask_size_7', label: 'Ask whether this item is available in your size.' },
              { id: 'ask_size_8', label: 'Ask whether the pants come in medium.' },
              { id: 'ask_size_9', label: 'Ask whether the dress is available in small.' },
              { id: 'ask_size_10', label: 'Ask for another size to try on.' },
            ],
          },
          {
            id: 'ask_color',
            label: 'Ask for another color',
            icon: '🎨',
            tasks: [
              { id: 'ask_color_1', label: 'Ask whether the T-shirt comes in blue.' },
              { id: 'ask_color_2', label: 'Ask whether the jacket comes in black.' },
              { id: 'ask_color_3', label: 'Ask whether there is a red one.' },
              { id: 'ask_color_4', label: 'Ask for another color.' },
              { id: 'ask_color_5', label: 'Ask whether the shirt is available in white.' },
              { id: 'ask_color_6', label: 'Ask whether the skirt comes in pink.' },
              { id: 'ask_color_7', label: 'Ask whether the store has the same item in another color.' },
              { id: 'ask_color_8', label: 'Ask to see the blue one.' },
              { id: 'ask_color_9', label: 'Ask to compare the black one and the white one.' },
              { id: 'ask_color_10', label: 'Ask whether this item is available in a darker color.' },
            ],
          },
          {
            id: 'ask_sale',
            label: 'Ask whether the item is on sale',
            icon: '🏷️',
            tasks: [
              { id: 'ask_sale_1', label: 'Ask whether this item is on sale.' },
              { id: 'ask_sale_2', label: 'Ask whether the T-shirt has a discount.' },
              { id: 'ask_sale_3', label: 'Ask whether the jacket is cheaper today.' },
              { id: 'ask_sale_4', label: 'Ask whether there is a special offer.' },
              { id: 'ask_sale_5', label: 'Ask whether this is the sale price.' },
              { id: 'ask_sale_6', label: 'Ask whether the red skirt is discounted.' },
              { id: 'ask_sale_7', label: 'Ask whether there is a student discount.' },
              { id: 'ask_sale_8', label: 'Ask whether buying two items gives a discount.' },
              { id: 'ask_sale_9', label: 'Ask whether there is a coupon for this item.' },
              { id: 'ask_sale_10', label: 'Ask whether this is part of the promotion.' },
            ],
          },
          {
            id: 'compare_items',
            label: 'Compare two items',
            icon: '⚖️',
            tasks: [],
          },
          {
            id: 'confirm_availability',
            label: 'Confirm whether the item is available',
            icon: '📦',
            tasks: [
              { id: 'confirm_availability_1', label: 'Ask whether the blue T-shirt is available.' },
              { id: 'confirm_availability_2', label: 'Ask whether the item is still in stock.' },
              { id: 'confirm_availability_3', label: 'Ask whether the jacket is available in medium.' },
              { id: 'confirm_availability_4', label: 'Ask whether the black one is available.' },
              { id: 'confirm_availability_5', label: 'Ask whether there are any more of this item.' },
              { id: 'confirm_availability_6', label: 'Ask whether this dress is still available.' },
              { id: 'confirm_availability_7', label: 'Ask whether the item is sold out.' },
              { id: 'confirm_availability_8', label: 'Ask whether another branch has this item.' },
              { id: 'confirm_availability_9', label: 'Ask whether the store can check the stock.' },
              { id: 'confirm_availability_10', label: 'Ask whether this item will be available later.' },
            ],
          },
        ],
        propSystem: {
          policy: 'auto-swap',
          staticProps: [
            // Placeholder — replace url with actual GLB path when asset is ready
            { id: 'cashier_counter', url: '/models/clothingStore/objects/ClothingStore_Counter.glb', position: [2.5, -0.7, -1], rotation: [0, Math.PI / 30, 0], scale: 1.0 },
            { id: 'rack', url: '/models/clothingStore/objects/Rack.glb', position: [-3, 0, -3], scale: 1.0 },
          ],
          taskProps: {
            // Placeholder entries — replace urls with actual GLB paths when assets are ready
            'ask_price_1': { url: '/models/clothingStore/objects/Tshirt_Blue.glb', displayPos: [-3.5, 2.22, -3], rotation: [0, Math.PI / 2, 0] },
            'ask_price_2': { url: '/models/clothingStore/objects/Jacket_Black.glb', displayPos: [-3, 2.22, -3], rotation: [0, Math.PI / 2, 0] },
            // 'ask_price_3': { url: '/models/clothingStore/objects/Skirt_Red.glb',    displayPos: [-3, 0, -2] },
            'ask_price_4': { url: '/models/clothingStore/objects/Shirt_White.glb', displayPos: [-2.5, 2.22, -3], rotation: [0, Math.PI / 2, 0] },

          },
        },
      },

      // ── Scene 2：試衣間 ───────────────────────────────────────────────
      // {
      //   id: 'clothingStore_fitting',
      //   label: '試衣間',
      //   icon: '🪞',
      //   allowedVrmIds: [
      //     'default',
      //     'student_male',
      //     'student_female',
      //     'clothingStoreStaff_female',
      //     'clothingStoreStaff_male',
      //   ],
      //   slots: [
      //     {
      //       id: 'staff',
      //       label: '店員',
      //       icon: '🧑‍💼',
      //       position: [1.2, 0, -1.5],
      //       // rotation: [0, -Math.PI / 3, 0],
      //       defaultVrmId: 'clothingStoreStaff_female',
      //     },
      //     {
      //       id: 'shopper',
      //       label: '試穿顧客',
      //       icon: '👕',
      //       position: [-1.2, 0, -1.5],
      //       // rotation: [0, Math.PI / 3, 0],
      //       defaultVrmId: 'default',
      //     },
      //   ],
      //   modules: [
      //     {
      //       id: 'try_on',
      //       label: 'Try On Items',
      //       icon: '👗',
      //       tasks: [
      //         { id: 'try_on_1', label: 'Ask if you can try on the red dress.' },
      //         { id: 'try_on_2', label: 'Tell the staff the item does not fit.' },
      //         { id: 'try_on_3', label: 'Ask for a different colour to try.' },
      //       ],
      //     },
      //     {
      //       id: 'return_exchange',
      //       label: 'Return or Exchange',
      //       icon: '🔄',
      //       tasks: [
      //         { id: 'return_exchange_1', label: 'Ask how to return an item bought online.' },
      //         { id: 'return_exchange_2', label: 'Request an exchange for the same item in a different size.' },
      //         { id: 'return_exchange_3', label: 'Explain that you have the receipt and want a refund.' },
      //       ],
      //     },
      //   ],
      // },
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
  avatarDefaults: { position: [0, 0, 0], scale: 1 },
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
        propSystem: variant.propSystem,
      };
    }
  }
  return presets;
}

export const SCENE_PRESETS: Record<string, SceneConfig> = buildScenePresets();

/** Default scene used on first load (first scene of first theme) */
export const DEFAULT_SCENE_ID: string = THEMES[0].scenes[0].id;
