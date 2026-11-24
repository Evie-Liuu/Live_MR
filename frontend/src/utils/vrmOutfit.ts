// frontend/src/utils/vrmOutfit.ts
//
// 角色模型內建的換裝部件：模型裡的物件依 [層級]_[部位]_[款式]_[初始狀態] 命名，
// 例如 Outfit_Bottom_Skirt_hide（外層、下身、短裙、一開始隱藏）、Base_Bottom_Pants_show（基本、下身、長褲、一開始顯示）。
// 載入時依初始狀態顯示或隱藏；換穿某部位的某款式時，同部位只顯示那個款式、其他款式都隱藏，脫下就回到初始狀態。
// 名稱比對不分大小寫；Blender 重複名稱的 .001 / _1 尾碼會忽略（一個款式可以由好幾個物件組成）。

import type * as THREE from 'three';

export interface OutfitPartNode {
  layer: string;
  /** 部位，例如 Top / Bottom / Head / Feet（小寫存放） */
  part: string;
  /** 款式，例如 Skirt / Jeans / Hat（小寫存放） */
  style: string;
  initialVisible: boolean;
  object: THREE.Object3D;
}

/** 換穿的款式：部位＋款式（對應 TaskPropConfig.outfit） */
export interface OutfitStyle {
  part: string;
  style: string;
}

// GLTFLoader 會把名稱裡的 . : 等字元拿掉，所以 .001 會變成 001
const OUTFIT_NAME = /^([a-z0-9]+)_([a-z0-9]+)_([a-z0-9]+)_(hide|show)(?:[_.]?\d+)?$/i;

export function parseOutfitName(name: string): Omit<OutfitPartNode, 'object'> | null {
  const m = OUTFIT_NAME.exec(name);
  if (!m) return null;
  return { layer: m[1].toLowerCase(), part: m[2].toLowerCase(), style: m[3].toLowerCase(), initialVisible: m[4].toLowerCase() === 'show' };
}

const cache = new WeakMap<THREE.Object3D, OutfitPartNode[]>();

/** 模型裡所有符合命名的換裝部件（結果快取在 root 上） */
export function collectOutfitParts(root: THREE.Object3D): OutfitPartNode[] {
  const cached = cache.get(root);
  if (cached) return cached;
  const parts: OutfitPartNode[] = [];
  root.traverse(obj => {
    const parsed = parseOutfitName(obj.name);
    if (parsed) parts.push({ ...parsed, object: obj });
  });
  cache.set(root, parts);
  return parts;
}

/** 這個模型有沒有這個部位的這個款式 */
export function hasOutfitStyle(root: THREE.Object3D, { part, style }: OutfitStyle): boolean {
  const p = part.toLowerCase(), s = style.toLowerCase();
  return collectOutfitParts(root).some(n => n.part === p && n.style === s);
}

/**
 * 依目前穿著的款式設定各部件顯示與否：有穿的部位只顯示那個款式，沒穿的部位回到初始狀態。
 * 傳空陣列就是全部回到初始狀態（載入時呼叫）。模型沒有的款式會被略過，不影響該部位。
 */
export function applyOutfit(root: THREE.Object3D, worn: readonly OutfitStyle[]): void {
  const parts = collectOutfitParts(root);
  if (!parts.length) return;
  const wornByPart = new Map<string, string>();
  for (const w of worn) {
    if (hasOutfitStyle(root, w)) wornByPart.set(w.part.toLowerCase(), w.style.toLowerCase());
  }
  for (const n of parts) {
    const style = wornByPart.get(n.part);
    n.object.visible = style === undefined ? n.initialVisible : n.style === style;
  }
}

/**
 * 試穿時佔用的部位，用來判斷同一人換穿時要換掉哪一件：有 outfit 用它的部位；
 * 只有 bodyHold 的，戴在頭上算 head，其餘都算 body（彼此互換）。
 */
export function wearPartOf(cfg: { outfit?: OutfitStyle; bodyHold?: { anchor: string } } | undefined): string {
  if (cfg?.outfit) return cfg.outfit.part.toLowerCase();
  return cfg?.bodyHold?.anchor === 'head' ? 'head' : 'body';
}
