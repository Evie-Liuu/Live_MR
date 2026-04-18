// frontend/src/utils/propInteraction.ts
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

// Module-scope reusable vectors — avoids per-frame allocation.
const _bonePos = new THREE.Vector3();   // used by attachPropToHand
const _ndcPos = new THREE.Vector3();   // used by projectToUV
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
 * Writes result into `out` to avoid per-frame allocation.
 */
export function projectToUV(
  worldPos: THREE.Vector3,
  camera: THREE.Camera,
  out: { x: number; y: number },
): void {
  _ndcPos.copy(worldPos).project(camera);
  out.x = (_ndcPos.x + 1) / 2;
  out.y = (1 - _ndcPos.y) / 2;
}

/**
 * Move a prop group toward the VRM hand bone world position each frame.
 *
 * Mirror convention (matches vrmPoseApplier.ts):
 *   person 'right' hand → VRM 'leftHand' bone
 *   person 'left'  hand → VRM 'rightHand' bone
 *
 * `offset` shifts the prop from the bone origin (default: slightly in front of palm).
 *
 * `held` controls the update strategy:
 *   - false (approaching from hanger): lerp(0.3) — smooth pick-up animation.
 *   - true  (already held in hand)  : copy()     — snap directly, no jitter.
 */
export function attachPropToHand(
  group: THREE.Group,
  vrm: VRM,
  hand: 'left' | 'right',
  held: boolean,
  offset: [number, number, number] = [0, 0.03, 0.15],
): void {
  // Mirror: person's right → VRM leftHand; person's left → VRM rightHand
  const boneName = hand === 'right' ? 'leftHand' : 'rightHand';

  const boneNode = vrm.humanoid.getNormalizedBoneNode(boneName);
  if (!boneNode) return;
  boneNode.getWorldPosition(_bonePos);
  _offsetVec.set(...offset);
  _bonePos.add(_offsetVec);

  if (held) {
    // Already gripped — snap directly to avoid per-frame floating.
    group.position.copy(_bonePos);
  } else {
    // Approaching from hanger — lerp for a smooth pick-up feel.
    group.position.lerp(_bonePos, 0.3);
  }
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
