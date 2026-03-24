/**
 * vrmLoader.ts
 *
 * Shared VRM loading utility.
 * Wraps GLTFLoader + VRMLoaderPlugin into a single promise-based API.
 * Handles VRM0/VRM1 rotation normalisation and initial scene transform.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRM, VRMUtils } from '@pixiv/three-vrm';
import type { AvatarSpawnConfig } from '../types/vrm';

export interface LoadVrmOptions {
  /** URL or path to the .vrm file */
  url: string;
  /** THREE.Scene to add the VRM into */
  scene: THREE.Scene;
  /** Optional initial transform applied to vrm.scene after load */
  spawn?: AvatarSpawnConfig;
  /** Progress callback (0–1) */
  onProgress?: (progress: number) => void;
}

export interface LoadedVrm {
  vrm: VRM;
  /** Initial (pre-pose) hips world position – used for position resets */
  initialHipsPos: THREE.Vector3;
}

/**
 * Load a VRM file, add it to the scene, and return a LoadedVrm descriptor.
 */
export function loadVrm({
  url,
  scene,
  spawn,
  onProgress,
}: LoadVrmOptions): Promise<LoadedVrm> {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    loader.load(
      url,
      (gltf) => {
        const vrm = gltf.userData.vrm as VRM | undefined;
        if (!vrm) {
          reject(new Error(`[VRMLoader] No VRM data found in: ${url}`));
          return;
        }

        // Normalise VRM0 rotation so model faces +Z
        VRMUtils.rotateVRM0(vrm);

        // Apply spawn transform
        if (spawn) {
          if (spawn.position) {
            vrm.scene.position.set(...spawn.position);
          }
          if (spawn.rotation) {
            vrm.scene.rotation.set(...spawn.rotation);
          }
          if (spawn.scale != null) {
            vrm.scene.scale.setScalar(spawn.scale);
          }
        }

        scene.add(vrm.scene);

        // Capture initial hips position (before any pose is applied)
        const hipsNode = vrm.humanoid.getNormalizedBoneNode('hips');
        const initialHipsPos = hipsNode
          ? hipsNode.position.clone()
          : new THREE.Vector3();

        resolve({ vrm, initialHipsPos });
      },
      (evt) => {
        if (onProgress && evt.lengthComputable) {
          onProgress(evt.loaded / evt.total);
        }
      },
      (err) => {
        console.error(`[VRMLoader] Failed to load "${url}":`, err);
        reject(err);
      },
    );
  });
}
