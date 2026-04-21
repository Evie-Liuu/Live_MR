// frontend/src/utils/propInteraction.ts
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

// Module-scope reusable vectors — avoids per-frame allocation.
const _bonePos = new THREE.Vector3();   // used by attachPropToHand
const _ndcPos = new THREE.Vector3();   // used by projectToUV
const _offsetVec = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Fresnel rim-glow shader patch
// ---------------------------------------------------------------------------

/** Per-material uniforms injected by ensureFresnelPatch(). */
interface FresnelUniforms {
  uRimEnabled: { value: number };
  uTime:       { value: number };
}

/**
 * Cache of patched uniforms, keyed by material instance.
 * WeakMap ensures GC can collect materials that are no longer live.
 */
const _fresnelUniformsMap = new WeakMap<THREE.Material, FresnelUniforms>();

/**
 * Attach a Fresnel rim-glow `onBeforeCompile` hook to a MeshStandardMaterial
 * the first time it is seen.  Subsequent calls return the cached uniforms.
 *
 * Implementation notes:
 *  - `vNormal`       (view-space) and `vViewPosition` (view-space direction
 *    toward camera) are always present in the MeshStandard/Physical shader.
 *  - Fresnel term:   `rim = pow(1 - dot(N, V), exponent)`
 *  - We inject into `#include <output_fragment>` so the rim is added on top
 *    of the fully-resolved PBR colour without touching the lighting model.
 *  - `customProgramCacheKey` is set per-material so Three.js does not share
 *    the compiled program with un-patched material instances.
 */
function ensureFresnelPatch(mat: THREE.MeshStandardMaterial): FresnelUniforms {
  const cached = _fresnelUniformsMap.get(mat);
  if (cached) return cached;

  const uniforms: FresnelUniforms = {
    uRimEnabled: { value: 0 },
    uTime:       { value: 0 },
  };

  mat.onBeforeCompile = (shader) => {
    // Expose uniforms to the shader.
    shader.uniforms.uRimEnabled = uniforms.uRimEnabled;
    shader.uniforms.uTime       = uniforms.uTime;

    // Declare uniforms at the top of the fragment shader.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      /* glsl */`
#include <common>
uniform float uRimEnabled;
uniform float uTime;
`,
    );

    // Inject rim contribution after the final colour resolve.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <output_fragment>',
      /* glsl */`
#include <output_fragment>
if (uRimEnabled > 0.5) {
  // vNormal and vViewPosition are both in view-space.
  vec3  N   = normalize(vNormal);
  vec3  V   = normalize(vViewPosition);   // points toward camera
  float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.5);
  float pulse = 0.55 + 0.45 * sin(uTime * 3.0);
  // Cyan-white electric edge: tweak RGB to taste.
  gl_FragColor.rgb += vec3(0.15, 0.85, 1.0) * rim * 2.0 * pulse;
}
`,
    );
  };

  // Unique cache key so Three.js compiles a dedicated program for this material.
  mat.customProgramCacheKey = () => `fresnel_rim_${mat.uuid}`;

  // Trigger recompilation if the material was already compiled previously.
  mat.needsUpdate = true;

  _fresnelUniformsMap.set(mat, uniforms);
  return uniforms;
}

// ---------------------------------------------------------------------------

/**
 * Toggle a Fresnel rim-glow effect on all MeshStandard/Physical meshes inside
 * a GLB group.  Call every RAF frame with the current elapsed time (seconds).
 *
 * The first call for each material compiles an `onBeforeCompile` hook that
 * injects the rim into the existing PBR shader output — the original lighting,
 * textures, and emissive map are preserved unchanged.
 *
 * MeshPhysicalMaterial extends MeshStandardMaterial, so `isMeshStandardMaterial`
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
      // const u = ensureFresnelPatch(m);
      // u.uRimEnabled.value = enabled ? 1 : 0;
      // u.uTime.value       = elapsedTime;
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
