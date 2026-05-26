/**
 * groupTransform.ts
 *
 * 純函式：群組剛體變換。
 *  - computePivot       — 取群組成員 base 座標的 centroid
 *  - rotateByEulerXYZ   — 對單一向量套用 XYZ 順序的 Euler 旋轉
 *  - applyGroupTransform — 已知成員 base、群組 pivot、群組 transform，回傳成員 final pos/rot
 *
 * 三軸對應：rot[0] = Pitch (X), rot[1] = Yaw (Y), rot[2] = Roll (Z)。Euler 順序 'XYZ'。
 * 不依賴 Three.js，便於將來引入 vitest 直接覆蓋。
 */

export type Vec3 = [number, number, number];

/** 取多個 3D 點的算術平均（centroid）。傳空陣列回 [0,0,0]。 */
export function computePivot(positions: Vec3[]): Vec3 {
  if (positions.length === 0) return [0, 0, 0];
  let sx = 0, sy = 0, sz = 0;
  for (const p of positions) {
    sx += p[0]; sy += p[1]; sz += p[2];
  }
  const n = positions.length;
  return [sx / n, sy / n, sz / n];
}

/**
 * 對向量 v 套用 Euler 旋轉 (rx, ry, rz)，順序 X → Y → Z（與 Three.js 'XYZ' 一致）。
 * 數學：v' = Rz · Ry · Rx · v
 */
export function rotateByEulerXYZ(v: Vec3, r: Vec3): Vec3 {
  const [x, y, z] = v;
  const [rx, ry, rz] = r;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);

  // Rx
  let x1 = x;
  let y1 = y * cx - z * sx;
  let z1 = y * sx + z * cx;
  // Ry
  let x2 = x1 * cy + z1 * sy;
  let y2 = y1;
  let z2 = -x1 * sy + z1 * cy;
  // Rz
  const x3 = x2 * cz - y2 * sz;
  const y3 = x2 * sz + y2 * cz;
  const z3 = z2;

  return [x3, y3, z3];
}

/**
 * 把群組變換套到單一成員。
 *
 *  final.pos = pivot + Rxyz(base.pos - pivot, t.rot) + t.pos
 *  final.rot = base.rot + t.rot   （元素相加；Three.js Euler 沒有真正的「加法」但對小角度 / 單軸組合 OK）
 *
 * 對成員旋轉採用直接相加是設計上的取捨：成員預設多半 rot 為 [0,0,0]
 * 或單一 Y 軸（slot 朝向），群組變換大多是 Y 軸轉向場 — 相加足以表達意圖。
 * 若未來需要精準 quaternion 組合，可在此函式內升級而不影響呼叫端。
 */
export function applyGroupTransform(
  base: { pos: Vec3; rot: Vec3 },
  pivot: Vec3,
  transform: { pos: Vec3; rot: Vec3 },
): { pos: Vec3; rot: Vec3 } {
  const rel: Vec3 = [
    base.pos[0] - pivot[0],
    base.pos[1] - pivot[1],
    base.pos[2] - pivot[2],
  ];
  const rotated = rotateByEulerXYZ(rel, transform.rot);
  const finalPos: Vec3 = [
    pivot[0] + rotated[0] + transform.pos[0],
    pivot[1] + rotated[1] + transform.pos[1],
    pivot[2] + rotated[2] + transform.pos[2],
  ];
  const finalRot: Vec3 = [
    base.rot[0] + transform.rot[0],
    base.rot[1] + transform.rot[1],
    base.rot[2] + transform.rot[2],
  ];
  return { pos: finalPos, rot: finalRot };
}

/** 中性變換（無位移、無旋轉）— 供 Reset 使用。 */
export const IDENTITY_TRANSFORM: { pos: Vec3; rot: Vec3 } = {
  pos: [0, 0, 0],
  rot: [0, 0, 0],
};
