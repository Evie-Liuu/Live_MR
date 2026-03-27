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

/**
 * Configure spring bone parameters for better hair physics.
 * - Increases stiffness for faster return to rest position
 * - Adds damping to reduce oscillation
 * - Sets hit radius to prevent clipping through the model
 */
function configureSpringBones(vrm: VRM): void {
  const springBoneManager = vrm.springBoneManager;
  if (!springBoneManager) return;

  // Gather all available collider groups to maximize collision coverage
  const allColliderGroups = springBoneManager.colliderGroups;

  // Iterate through all spring bone joints
  springBoneManager.joints.forEach((joint: any) => {
    // Identify hair bones by checking the bone name
    const boneName = joint.bone ? joint.bone.name.toLowerCase() : '';
    const isHair = boneName.includes('hair');

    if (isHair && joint.settings) {
      // Snappy return: Increase stiffness (typical Snappy setup uses 4.0-10.0)
      joint.settings.stiffness = 8.0;

      // Stabilize: Drag force (damping) to prevent jittering
      joint.settings.dragForce = 0.5;

      // Minimize sagging: Reduce gravity power to help hair return to rest position faster
      joint.settings.gravityPower = 0.1;

      // Prevent clipping: Increase collision radius (standard is around 0.02)
      // Thicker hair volume helps prevent it from dipping into the mesh
      joint.settings.hitRadius = 0.06;

      // Assign all collider groups to hair to ensure it collides with head, torso, etc.
      if (allColliderGroups && allColliderGroups.length > 0) {
        joint.colliderGroups = allColliderGroups;
      }
    }
  });

  // Re-initialise and update to apply changes properly
  springBoneManager.setInitState();
}

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

        // Configure spring bones for better hair physics
        configureSpringBones(vrm);

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
