// frontend/src/utils/threeScene.ts
import * as THREE from 'three';
import type { SceneConfig } from '../types/vrm';

/** Apply lighting from a SceneConfig to a THREE.Scene */
export function applyLights(scene: THREE.Scene, config: SceneConfig): void {
  for (const light of config.lights) {
    if (light.type === 'ambient') {
      scene.add(new THREE.AmbientLight(light.color ?? 0xffffff, light.intensity));
    } else if (light.type === 'directional') {
      const l = new THREE.DirectionalLight(light.color ?? 0xffffff, light.intensity);
      if (light.position) l.position.set(...light.position);
      scene.add(l);
    }
  }
}

/** Add a floor grid from a SceneConfig to a THREE.Scene */
export function applyGrid(scene: THREE.Scene, config: SceneConfig): void {
  if (!config.grid) return;
  const { size, divisions, color } =
    config.grid === true
      ? { size: 20, divisions: 20, color: 0x2a2a4a }
      : { size: config.grid.size, divisions: config.grid.divisions, color: config.grid.color ?? 0x2a2a4a };
  const grid = new THREE.GridHelper(size, divisions, color, color);
  scene.add(grid);
}
