/**
 * propLoader.ts
 *
 * Loads a plain GLB model (non-VRM) into a Three.js scene.
 * Errors (e.g. missing file) are caught per-asset and logged; they do not
 * propagate so a missing GLB never breaks the scene setup.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { PropConfig, TaskPropConfig } from '../types/vrm';

const loader = new GLTFLoader();

async function loadGlb(
  url: string,
  scene: THREE.Scene,
): Promise<THREE.Group | null> {
  try {
    const gltf = await loader.loadAsync(url);
    gltf.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        (obj as THREE.Mesh).castShadow = true;
        (obj as THREE.Mesh).receiveShadow = true;
      }
    });
    scene.add(gltf.scene);
    return gltf.scene;
  } catch (err) {
    console.warn(`[PropLoader] Failed to load "${url}":`, err);
    return null;
  }
}

function disposeGroup(group: THREE.Group, scene: THREE.Scene): void {
  scene.remove(group);
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) (m as THREE.Material).dispose();
    }
  });
}

/** Load all static props for a scene. Returns a map of prop id → Group (missing assets excluded). */
export async function loadStaticProps(
  staticProps: PropConfig[],
  scene: THREE.Scene,
): Promise<Map<string, THREE.Group>> {
  const pool = new Map<string, THREE.Group>();
  await Promise.all(
    staticProps.map(async (cfg) => {
      const group = await loadGlb(cfg.url, scene);
      if (!group) return;
      group.position.set(...cfg.position);
      if (cfg.rotation) group.rotation.set(...cfg.rotation);
      if (cfg.scale != null) group.scale.setScalar(cfg.scale);
      pool.set(cfg.id, group);
    }),
  );
  return pool;
}

/** Load all task props for a scene. Returns a map of taskId → Group (missing assets excluded). */
export async function loadTaskProps(
  taskProps: Record<string, TaskPropConfig>,
  scene: THREE.Scene,
): Promise<Map<string, THREE.Group>> {
  const pool = new Map<string, THREE.Group>();
  await Promise.all(
    Object.entries(taskProps).map(async ([taskId, cfg]) => {
      const group = await loadGlb(cfg.url, scene);
      if (!group) return;
      group.position.set(...cfg.displayPos);
      if (cfg.rotation) group.rotation.set(...cfg.rotation);
      if (cfg.scale != null) group.scale.setScalar(cfg.scale);
      group.visible = true;
      pool.set(taskId, group);
    }),
  );
  return pool;
}

/** Dispose all groups in a static prop pool. */
export function disposeStaticProps(pool: Map<string, THREE.Group>, scene: THREE.Scene): void {
  for (const group of pool.values()) disposeGroup(group, scene);
  pool.clear();
}

/** Dispose all groups in a task prop pool. */
export function disposeTaskProps(pool: Map<string, THREE.Group>, scene: THREE.Scene): void {
  for (const group of pool.values()) disposeGroup(group, scene);
  pool.clear();
}
