import { useEffect, useRef, useCallback } from 'react';
import type { RefObject } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { Pose as KPose } from 'kalidokit';

interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

interface PoseData {
  landmarks?: PoseLandmark[];
  worldLandmarks?: PoseLandmark[];
}

/** One avatar slot in the shared scene */
interface AvatarSlot {
  vrm: VRM;
  /** world-space X centre for this avatar */
  baseX: number;
}

const AVATAR_SPACING = 1.6; // metres between avatar centres

/** Resolve the X position for avatar at index `i` centred around origin */
function slotX(index: number, total: number): number {
  return (index - (total - 1) / 2) * AVATAR_SPACING;
}

/**
 * Manages a single Three.js scene containing multiple VRM avatars.
 * Avatars are created/removed by `identity` key and re-centred on the x-axis
 * whenever the set changes.
 */
export function useBigScreenScene(canvasRef: RefObject<HTMLCanvasElement | null>) {
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const clockRef = useRef(new THREE.Timer());
  const rafRef = useRef<number>(0);

  /** identity → avatar slot */
  const avatarsRef = useRef<Map<string, AvatarSlot>>(new Map());
  /** Ordered list of identities (determines x-position) */
  const orderRef = useRef<string[]>([]);
  /** In-flight VRM load promises to prevent duplicate loads */
  const loadingRef = useRef<Map<string, Promise<AvatarSlot>>>(new Map());

  // ─── Scene initialisation ───────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    sceneRef.current = scene;

    // Wide camera to frame multiple avatars
    const camera = new THREE.PerspectiveCamera(40, canvas.width / canvas.height, 0.1, 50);
    camera.position.set(0, 1.2, 5);
    camera.lookAt(0, 1, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(canvas.width, canvas.height);
    renderer.setPixelRatio(window.devicePixelRatio);
    rendererRef.current = renderer;

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambient);
    const dir1 = new THREE.DirectionalLight(0xffffff, 0.9);
    dir1.position.set(2, 4, 2);
    scene.add(dir1);
    const dir2 = new THREE.DirectionalLight(0x8888ff, 0.3);
    dir2.position.set(-2, 1, -2);
    scene.add(dir2);

    // Grid floor
    const grid = new THREE.GridHelper(20, 20, 0x2a2a4a, 0x2a2a4a);
    scene.add(grid);

    // Render loop
    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);
      const delta = clockRef.current.getDelta();
      for (const slot of avatarsRef.current.values()) {
        slot.vrm.update(delta);
      }
      if (cameraRef.current) {
        renderer.render(scene, cameraRef.current);
      }
    };
    rafRef.current = requestAnimationFrame(animate);

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (!canvas) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      renderer.setSize(w, h, false);
      if (cameraRef.current) {
        cameraRef.current.aspect = w / h;
        cameraRef.current.updateProjectionMatrix();
      }
    });
    ro.observe(canvas);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafRef.current);
      for (const slot of avatarsRef.current.values()) {
        scene.remove(slot.vrm.scene);
        slot.vrm.scene.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.geometry?.dispose();
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (const mat of mats) mat?.dispose();
          }
        });
      }
      avatarsRef.current.clear();
      loadingRef.current.clear();
      orderRef.current = [];
      renderer.dispose();
    };
  }, [canvasRef]);

  // ─── Helpers ────────────────────────────────────────────────────────────

  /** Reposition all avatars after adding/removing one */
  const reposition = useCallback(() => {
    const order = orderRef.current;
    const total = order.length;
    order.forEach((id, i) => {
      const slot = avatarsRef.current.get(id);
      if (!slot) return;
      const x = slotX(i, total);
      slot.baseX = x;
      slot.vrm.scene.position.x = x;
      slot.vrm.scene.position.y = 0;
      slot.vrm.scene.position.z = 0;
    });

    // Adjust camera distance based on number of avatars
    if (cameraRef.current) {
      const spread = total > 1 ? AVATAR_SPACING * (total - 1) : 0;
      cameraRef.current.position.set(0, 1.2, Math.max(3, spread / 2 + 3.5));
      cameraRef.current.lookAt(0, 1, 0);
    }
  }, []);

  /** Load (or retrieve) a VRM for a given identity */
  const ensureAvatar = useCallback(
    (identity: string): Promise<AvatarSlot> => {
      const existing = avatarsRef.current.get(identity);
      if (existing) return Promise.resolve(existing);

      // Return in-flight promise if already loading this identity
      const inFlight = loadingRef.current.get(identity);
      if (inFlight) return inFlight;

      const scene = sceneRef.current;
      if (!scene) return Promise.reject(new Error('Scene not ready'));

      const loadPromise = new Promise<AvatarSlot>((resolve, reject) => {
        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));
        loader.load(
          '/default.vrm',
          (gltf) => {
            const vrm = gltf.userData.vrm as VRM | undefined;
            if (!vrm) {
              loadingRef.current.delete(identity);
              reject(new Error('VRM not found in GLTF'));
              return;
            }
            // Mirror the avatar so it faces the camera
            vrm.scene.rotation.y = Math.PI;
            scene.add(vrm.scene);

            // Register in order list if not already present
            if (!orderRef.current.includes(identity)) {
              // Put teacher ('host') first
              if (identity.startsWith('host-')) {
                orderRef.current.unshift(identity);
              } else {
                orderRef.current.push(identity);
              }
            }

            const slot: AvatarSlot = { vrm, baseX: 0 };
            avatarsRef.current.set(identity, slot);
            loadingRef.current.delete(identity);
            reposition();
            resolve(slot);
          },
          undefined,
          (err) => {
            loadingRef.current.delete(identity);
            reject(err);
          },
        );
      });

      loadingRef.current.set(identity, loadPromise);
      return loadPromise;
    },
    [reposition],
  );

  // ─── Public API ─────────────────────────────────────────────────────────

  /** Apply pose data (MediaPipe landmarks) to a specific participant's avatar */
  const applyPose = useCallback(
    async (identity: string, rawData: unknown) => {
      try {
        const slot = await ensureAvatar(identity);
        const { vrm } = slot;
        const data = rawData as PoseData;
        if (!data.landmarks || data.landmarks.length < 33) return;

        const poseRig = KPose.solve(
          data.worldLandmarks ?? data.landmarks,
          data.landmarks,
          { runtime: 'mediapipe', enableLegs: true },
        );
        if (!poseRig) return;

        const humanoid = vrm.humanoid;
        if (!humanoid) return;

        if (poseRig.Spine) {
          const spine = humanoid.getNormalizedBoneNode(VRMHumanBoneName.Spine);
          if (spine) {
            spine.rotation.x = poseRig.Spine.x;
            spine.rotation.y = poseRig.Spine.y;
            spine.rotation.z = poseRig.Spine.z;
          }
        }

        if (poseRig.Hips?.rotation) {
          const hips = humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips);
          if (hips) {
            hips.rotation.x = poseRig.Hips.rotation.x;
            hips.rotation.y = poseRig.Hips.rotation.y;
            hips.rotation.z = poseRig.Hips.rotation.z;
          }
        }

        const boneMap: Array<[string, VRMHumanBoneName]> = [
          ['RightUpperArm', VRMHumanBoneName.RightUpperArm],
          ['RightLowerArm', VRMHumanBoneName.RightLowerArm],
          ['LeftUpperArm', VRMHumanBoneName.LeftUpperArm],
          ['LeftLowerArm', VRMHumanBoneName.LeftLowerArm],
          ['RightUpperLeg', VRMHumanBoneName.RightUpperLeg],
          ['RightLowerLeg', VRMHumanBoneName.RightLowerLeg],
          ['LeftUpperLeg', VRMHumanBoneName.LeftUpperLeg],
          ['LeftLowerLeg', VRMHumanBoneName.LeftLowerLeg],
        ];

        for (const [rigKey, boneName] of boneMap) {
          const rigData = poseRig[rigKey as keyof typeof poseRig] as
            | { x: number; y: number; z: number }
            | undefined;
          if (rigData) {
            const bone = humanoid.getNormalizedBoneNode(boneName);
            if (bone) {
              bone.rotation.x = rigData.x;
              bone.rotation.y = rigData.y;
              bone.rotation.z = rigData.z;
            }
          }
        }
      } catch (err) {
        console.warn(`[BigScreen] pose apply error for ${identity}:`, err);
      }
    },
    [ensureAvatar],
  );

  /** Remove an avatar from the scene */
  const removeAvatar = useCallback(
    (identity: string) => {
      const slot = avatarsRef.current.get(identity);
      if (!slot) return;
      sceneRef.current?.remove(slot.vrm.scene);
      // Dispose GPU resources to prevent memory leaks
      slot.vrm.scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const mat of mats) mat?.dispose();
        }
      });
      avatarsRef.current.delete(identity);
      orderRef.current = orderRef.current.filter((id) => id !== identity);
      reposition();
    },
    [reposition],
  );

  return { applyPose, removeAvatar };
}
