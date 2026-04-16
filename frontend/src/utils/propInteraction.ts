// frontend/src/utils/propInteraction.ts
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

// Module-scope reusable vectors — avoids per-frame allocation.
const _bonePos   = new THREE.Vector3();   // used by attachPropToHand
const _ndcPos    = new THREE.Vector3();   // used by projectToUV
const _offsetVec = new THREE.Vector3();

/**
 * Toggle emissive pulsing highlight on all MeshStandardMaterial meshes in a GLB group.
 * Call every RAF frame with current elapsed time (seconds) when enabled.
 *
 * MeshPhysicalMaterial extends MeshStandardMaterial, so isMeshStandardMaterial
 * covers both types.
 */
export function highlightProp(
  group: THREE.Group,
  enabled: boolean,
  elapsedTime = 0,
): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const m = mat as THREE.MeshStandardMaterial;
      if (!m.isMeshStandardMaterial) continue;
      if (enabled) {
        m.emissive.setRGB(1, 0.8, 0.2);
        m.emissiveIntensity = 0.4 + 0.35 * Math.sin(elapsedTime * 2.5);
      } else {
        m.emissiveIntensity = 0;
      }
    }
  });
}

/**
 * Project a world-space position to normalised UV screen space [0,1].
 * x=0 is left, y=0 is top (matches MediaPipe landmark convention).
 */
export function projectToUV(
  worldPos: THREE.Vector3,
  camera: THREE.Camera,
): { x: number; y: number } {
  _ndcPos.copy(worldPos).project(camera);
  return {
    x: (_ndcPos.x + 1) / 2,
    y: (1 - _ndcPos.y) / 2,
  };
}

/**
 * Move a prop group toward the VRM hand bone world position each frame (lerp 0.3).
 *
 * Mirror convention (matches vrmPoseApplier.ts):
 *   person 'right' hand → VRM 'leftHand' bone
 *   person 'left'  hand → VRM 'rightHand' bone
 *
 * `offset` shifts the prop from the bone origin (default: slightly in front of palm).
 */
export function attachPropToHand(
  group: THREE.Group,
  vrm: VRM,
  hand: 'left' | 'right',
  offset: [number, number, number] = [0, 0.1, 0.05],
): void {
  // Mirror: person's right → VRM leftHand; person's left → VRM rightHand
  const boneName = hand === 'right' ? 'leftHand' : 'rightHand';
  const boneNode = vrm.humanoid.getNormalizedBoneNode(boneName);
  if (!boneNode) return;
  boneNode.getWorldPosition(_bonePos);
  _offsetVec.set(...offset);
  _bonePos.add(_offsetVec);
  group.position.lerp(_bonePos, 0.3);
}

/**
 * Lerp the prop back toward its display position each frame.
 * Returns true when the prop has arrived (distance < 0.02 m).
 */
export function returnPropToDisplay(
  group: THREE.Group,
  displayPos: THREE.Vector3,
  delta: number,
): boolean {
  group.position.lerp(displayPos, delta * 8);
  return group.position.distanceTo(displayPos) < 0.02;
}
