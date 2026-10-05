#!/usr/bin/env node
/**
 * generate-vrma.mjs — 產生劇本模擬器用的基本 VRMA 動作檔（程式產生，無授權問題）
 *
 *   node scripts/generate-vrma.mjs            → 寫入 public/animations/<id>.vrma
 *
 * 之後若取得授權的專業動作檔，直接用同名檔案覆蓋即可，程式不用改（見 src/config/gestures.ts）。
 *
 * 座標慣例（VRMC_vrm_animation / VRM1 normalized）：T-pose、面向 +Z、角色左邊 = +X、上 = +Y。
 * 所有骨頭的靜止旋轉都是單位旋轉，關鍵影格就是 normalized 骨頭的 local 旋轉；VRM0 模型由
 * three-vrm-animation 的 createVRMAnimationClip 自動翻轉。
 *
 * 角度記法 rot(['z', 70], ['y', 60])：依序先繞 z 轉 70°、再繞 y 轉 60°（度）。
 *   左臂沿 +X：z 負 = 放下、z 正 = 抬起、y 負 = 往前
 *   右臂沿 -X：z 正 = 放下、z 負 = 抬起、y 正 = 往前
 *   頭 / 脊椎：x 正 = 往前彎（低頭）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/animations');
const FPS = 30;
const DEG = Math.PI / 180;

// ── 數學工具 ─────────────────────────────────────────────────────────────────

const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

/** 依序套用多個軸角旋轉（度），回傳四元數 */
function rot(...steps) {
  const q = new THREE.Quaternion();
  for (const [axis, deg] of steps) {
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(AXES[axis], deg * DEG));
  }
  return q;
}

const IDENTITY = rot();
/** 與模擬器待機站姿相同：手臂放下 70° */
const L_ARM_IDLE = rot(['z', -70]);
const R_ARM_IDLE = rot(['z', 70]);

const smooth = (u) => u * u * (3 - 2 * u);

/** 依關鍵影格以緩動取樣（四元數用 slerp、數值用線性） */
function sampleKeys(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    const [t0, v0] = keys[i - 1];
    if (t <= t1) {
      const u = smooth((t - t0) / (t1 - t0));
      return typeof v0 === 'number' ? v0 + (v1 - v0) * u : v0.clone().slerp(v1, u);
    }
  }
  return keys[keys.length - 1][1];
}

// ── 骨架（VRM1 T-pose 的大致位置，公尺；只有 hips 高度會影響位移縮放） ─────────

const FINGERS = ['Index', 'Middle', 'Ring', 'Little'];
function sideBones(side, s) {
  const S = side;
  const bones = [
    [`${S}Shoulder`, 'chest', [0.04 * s, 0.17, 0]],
    [`${S}UpperArm`, `${S}Shoulder`, [0.08 * s, 0, 0]],
    [`${S}LowerArm`, `${S}UpperArm`, [0.25 * s, 0, 0]],
    [`${S}Hand`, `${S}LowerArm`, [0.22 * s, 0, 0]],
    [`${S}ThumbMetacarpal`, `${S}Hand`, [0.02 * s, -0.01, 0.02]],
    [`${S}ThumbProximal`, `${S}ThumbMetacarpal`, [0.03 * s, 0, 0.01]],
    [`${S}ThumbDistal`, `${S}ThumbProximal`, [0.03 * s, 0, 0]],
  ];
  FINGERS.forEach((f, i) => {
    bones.push([`${S}${f}Proximal`, `${S}Hand`, [0.08 * s, 0, (0.02 - i * 0.015)]]);
    bones.push([`${S}${f}Intermediate`, `${S}${f}Proximal`, [0.03 * s, 0, 0]]);
    bones.push([`${S}${f}Distal`, `${S}${f}Intermediate`, [0.02 * s, 0, 0]]);
  });
  return bones;
}

const SKELETON = [
  ['hips', null, [0, 1.0, 0]],
  ['spine', 'hips', [0, 0.1, 0]],
  ['chest', 'spine', [0, 0.12, 0]],
  ['neck', 'chest', [0, 0.2, 0]],
  ['head', 'neck', [0, 0.1, 0]],
  ...sideBones('left', 1),
  ...sideBones('right', -1),
];

// ── 動作定義：duration 秒、bones { 骨頭: [[秒, 四元數], ...] }、expressions { 表情: [[秒, 權重], ...] } ──

function curlFingers(side, deg, keysAt, fingers = FINGERS) {
  // 右手手指沿 -X、掌心朝 -Y：繞 z 正轉 = 彎向掌心；左手相反
  const s = side === 'right' ? 1 : -1;
  const out = {};
  for (const f of fingers) {
    for (const seg of ['Proximal', 'Intermediate', 'Distal']) {
      out[`${side}${f}${seg}`] = keysAt.map(([t, w]) => [t, rot(['z', s * deg * w])]);
    }
  }
  return out;
}

const GESTURES = {
  // 揮手：右手舉起、前臂左右擺
  wave: {
    duration: 2.2,
    bones: {
      rightUpperArm: [[0, R_ARM_IDLE], [0.4, rot(['z', -25], ['y', 15])], [1.8, rot(['z', -25], ['y', 15])], [2.2, R_ARM_IDLE]],
      rightLowerArm: [[0, IDENTITY], [0.4, rot(['z', -75])], [0.65, rot(['z', -55])], [0.9, rot(['z', -95])], [1.15, rot(['z', -55])], [1.4, rot(['z', -95])], [1.65, rot(['z', -75])], [2.2, IDENTITY]],
      head: [[0, IDENTITY], [0.4, rot(['z', 5])], [1.8, rot(['z', 5])], [2.2, IDENTITY]],
    },
  },

  // 點頭：兩次點頭，第二次較小
  nod: {
    duration: 1.4,
    bones: {
      neck: [[0, IDENTITY], [0.3, rot(['x', 10])], [0.55, rot(['x', 1])], [0.8, rot(['x', 8])], [1.1, rot(['x', 0])], [1.4, IDENTITY]],
      head: [[0, IDENTITY], [0.3, rot(['x', 8])], [0.55, rot(['x', 1])], [0.8, rot(['x', 6])], [1.1, rot(['x', 0])], [1.4, IDENTITY]],
    },
  },

  // 鞠躬：上身前傾約 35°，停留後回正
  bow: {
    duration: 2.4,
    bones: {
      spine: [[0, IDENTITY], [0.6, rot(['x', 18])], [1.5, rot(['x', 18])], [2.2, IDENTITY], [2.4, IDENTITY]],
      chest: [[0, IDENTITY], [0.6, rot(['x', 10])], [1.5, rot(['x', 10])], [2.2, IDENTITY], [2.4, IDENTITY]],
      neck: [[0, IDENTITY], [0.6, rot(['x', 5])], [1.5, rot(['x', 5])], [2.2, IDENTITY], [2.4, IDENTITY]],
      head: [[0, IDENTITY], [0.6, rot(['x', 5])], [1.5, rot(['x', 5])], [2.2, IDENTITY], [2.4, IDENTITY]],
    },
  },

  // 指向：右手往前斜方伸出、食指伸直其餘手指握起
  point: {
    duration: 2.2,
    bones: {
      rightUpperArm: [[0, R_ARM_IDLE], [0.45, rot(['z', 10], ['y', 60])], [1.7, rot(['z', 10], ['y', 60])], [2.2, R_ARM_IDLE]],
      rightLowerArm: [[0, IDENTITY], [0.45, rot(['y', 8])], [1.7, rot(['y', 8])], [2.2, IDENTITY]],
      ...curlFingers('right', 75, [[0, 0], [0.45, 1], [1.7, 1], [2.2, 0]], ['Middle', 'Ring', 'Little']),
      rightThumbProximal: [[0, IDENTITY], [0.45, rot(['y', -25], ['z', 20])], [1.7, rot(['y', -25], ['z', 20])], [2.2, IDENTITY]],
      head: [[0, IDENTITY], [0.45, rot(['y', -8])], [1.7, rot(['y', -8])], [2.2, IDENTITY]],
    },
  },

  // 遞東西：右手往前下方伸出、掌心朝上，身體微傾
  handOver: {
    duration: 2.6,
    bones: {
      rightUpperArm: [[0, R_ARM_IDLE], [0.5, rot(['z', 25], ['y', 55])], [2.0, rot(['z', 25], ['y', 55])], [2.6, R_ARM_IDLE]],
      rightLowerArm: [[0, IDENTITY], [0.5, rot(['y', 25])], [2.0, rot(['y', 25])], [2.6, IDENTITY]],
      rightHand: [[0, IDENTITY], [0.5, rot(['x', -150])], [2.0, rot(['x', -150])], [2.6, IDENTITY]],
      spine: [[0, IDENTITY], [0.5, rot(['x', 6])], [2.0, rot(['x', 6])], [2.6, IDENTITY]],
      head: [[0, IDENTITY], [0.5, rot(['x', 6])], [2.0, rot(['x', 6])], [2.6, IDENTITY]],
    },
  },

  // 比讚：右手肘在身前、前臂往上舉、握拳豎起拇指
  thumbsUp: {
    duration: 2.2,
    bones: {
      rightUpperArm: [[0, R_ARM_IDLE], [0.45, rot(['z', 35], ['y', 45])], [1.7, rot(['z', 35], ['y', 45])], [2.2, R_ARM_IDLE]],
      rightLowerArm: [[0, IDENTITY], [0.45, rot(['z', -90])], [1.7, rot(['z', -90])], [2.2, IDENTITY]],
      ...curlFingers('right', 85, [[0, 0], [0.45, 1], [1.7, 1], [2.2, 0]]),
    },
    expressions: { happy: [[0, 0], [0.45, 0.6], [1.7, 0.6], [2.2, 0]] },
  },

  // 開心：笑臉＋身體左右輕擺、手臂微抬
  happy: {
    duration: 2.0,
    bones: {
      spine: [[0, IDENTITY], [0.4, rot(['z', 4])], [0.8, rot(['z', -4])], [1.2, rot(['z', 4])], [1.6, rot(['z', 0])], [2.0, IDENTITY]],
      head: [[0, IDENTITY], [0.4, rot(['z', 6])], [1.6, rot(['z', 6])], [2.0, IDENTITY]],
      leftUpperArm: [[0, L_ARM_IDLE], [0.4, rot(['z', -58])], [1.6, rot(['z', -58])], [2.0, L_ARM_IDLE]],
      rightUpperArm: [[0, R_ARM_IDLE], [0.4, rot(['z', 58])], [1.6, rot(['z', 58])], [2.0, R_ARM_IDLE]],
    },
    expressions: { happy: [[0, 0], [0.3, 1], [1.6, 1], [2.0, 0]] },
  },
};

// ── glTF / GLB 寫出 ──────────────────────────────────────────────────────────

function buildVrma(gesture) {
  const nodes = [];
  const nodeIndex = {};
  for (const [name, , translation] of SKELETON) {
    nodeIndex[name] = nodes.length;
    nodes.push({ name, translation });
  }
  for (const [name, parent] of SKELETON) {
    if (!parent) continue;
    const p = nodes[nodeIndex[parent]];
    (p.children ??= []).push(nodeIndex[name]);
  }
  const expressionNodes = {};
  for (const exp of Object.keys(gesture.expressions ?? {})) {
    expressionNodes[exp] = nodes.length;
    nodes.push({ name: `expression_${exp}` });
  }

  const chunks = [];
  let byteLength = 0;
  const bufferViews = [];
  const accessors = [];
  const pushAccessor = (floats, type, minmax) => {
    const buf = Buffer.from(new Float32Array(floats).buffer);
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: buf.length });
    chunks.push(buf);
    byteLength += buf.length;
    const count = floats.length / { SCALAR: 1, VEC3: 3, VEC4: 4 }[type];
    accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count, type, ...minmax });
    return accessors.length - 1;
  };

  const frameCount = Math.round(gesture.duration * FPS) + 1;
  const times = Array.from({ length: frameCount }, (_, i) => Math.min(i / FPS, gesture.duration));
  const timeAccessor = pushAccessor(times, 'SCALAR', { min: [0], max: [gesture.duration] });

  const samplers = [];
  const channels = [];
  for (const [bone, keys] of Object.entries(gesture.bones)) {
    if (nodeIndex[bone] == null) throw new Error(`unknown bone ${bone}`);
    const values = times.flatMap(t => sampleKeys(keys, t).toArray());
    samplers.push({ input: timeAccessor, output: pushAccessor(values, 'VEC4'), interpolation: 'LINEAR' });
    channels.push({ sampler: samplers.length - 1, target: { node: nodeIndex[bone], path: 'rotation' } });
  }
  for (const [exp, keys] of Object.entries(gesture.expressions ?? {})) {
    // 表情權重以 translation.x 表示（VRMC_vrm_animation 規格）
    const values = times.flatMap(t => [sampleKeys(keys, t), 0, 0]);
    samplers.push({ input: timeAccessor, output: pushAccessor(values, 'VEC3'), interpolation: 'LINEAR' });
    channels.push({ sampler: samplers.length - 1, target: { node: expressionNodes[exp], path: 'translation' } });
  }

  const humanBones = Object.fromEntries(SKELETON.map(([name]) => [name, { node: nodeIndex[name] }]));
  const json = {
    asset: { version: '2.0', generator: 'live-mr generate-vrma.mjs' },
    extensionsUsed: ['VRMC_vrm_animation'],
    extensions: {
      VRMC_vrm_animation: {
        specVersion: '1.0',
        humanoid: { humanBones },
        ...(Object.keys(expressionNodes).length
          ? { expressions: { preset: Object.fromEntries(Object.entries(expressionNodes).map(([k, node]) => [k, { node }])) } }
          : {}),
      },
    },
    scene: 0,
    scenes: [{ nodes: [nodeIndex.hips, ...Object.values(expressionNodes)] }],
    nodes,
    animations: [{ name: 'gesture', samplers, channels }],
    buffers: [{ byteLength }],
    bufferViews,
    accessors,
  };
  return toGlb(json, Buffer.concat(chunks));
}

function pad4(buf, fill) {
  const rem = buf.length % 4;
  return rem ? Buffer.concat([buf, Buffer.alloc(4 - rem, fill)]) : buf;
}

function toGlb(json, bin) {
  const jsonChunk = pad4(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const binChunk = pad4(bin, 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const chunkHeader = (len, type) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(len, 0);
    h.writeUInt32LE(type, 4);
    return h;
  };
  return Buffer.concat([
    header,
    chunkHeader(jsonChunk.length, 0x4e4f534a), jsonChunk, // 'JSON'
    chunkHeader(binChunk.length, 0x004e4942), binChunk, // 'BIN\0'
  ]);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const [id, gesture] of Object.entries(GESTURES)) {
  const file = path.join(OUT_DIR, `${id}.vrma`);
  fs.writeFileSync(file, buildVrma(gesture));
  console.log(`wrote ${path.relative(process.cwd(), file)} (${gesture.duration}s)`);
}
