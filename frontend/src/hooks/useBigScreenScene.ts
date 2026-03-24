import { useEffect, useRef, useCallback } from 'react';
import type { RefObject } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRM, VRMUtils } from '@pixiv/three-vrm';
import { solveWithKalidokit, type BoneRotation } from '../utils/kalidokitSolver';

interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

interface PoseFrame {
  type: 'pose';
  landmarks: PoseLandmark[];
  worldLandmarks: PoseLandmark[];
}

/** One avatar slot in the shared scene */
interface AvatarSlot {
  vrm: VRM;
  /** world-space X centre for this avatar */
  baseX: number;
  /** previous rotations for smoothing */
  prevRotations: Record<string, BoneRotation>;
  /** initial hips position for proper reset */
  initialHipsPos: THREE.Vector3;
}

const AVATAR_SPACING = 1.6; // metres between avatar centres
const LERP_SPEED = 14;
const MAX_LERP_T = 0.9;
const SOLVER_SMOOTHING = 0.5;

/** Resolve the X position for avatar at index `i` centred around origin */
function slotX(index: number, total: number): number {
  return (index - (total - 1) / 2) * AVATAR_SPACING;
}

export function useBigScreenScene(canvasRef: RefObject<HTMLCanvasElement | null>) {
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const clockRef = useRef(new THREE.Clock());
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

    const camera = new THREE.PerspectiveCamera(40, canvas.width / canvas.height, 0.1, 50);
    camera.position.set(0, 1.2, 5);
    camera.lookAt(0, 1, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(canvas.width, canvas.height);
    renderer.setPixelRatio(window.devicePixelRatio);
    rendererRef.current = renderer;

    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambient);
    const dir1 = new THREE.DirectionalLight(0xffffff, 0.9);
    dir1.position.set(2, 4, 2);
    scene.add(dir1);
    const dir2 = new THREE.DirectionalLight(0x8888ff, 0.3);
    dir2.position.set(-2, 1, -2);
    scene.add(dir2);

    const grid = new THREE.GridHelper(20, 20, 0x2a2a4a, 0x2a2a4a);
    scene.add(grid);

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
      }
      avatarsRef.current.clear();
      loadingRef.current.clear();
      orderRef.current = [];
      renderer.dispose();
    };
  }, [canvasRef]);

  const reposition = useCallback(() => {
    const order = orderRef.current;
    const total = order.length;
    order.forEach((id, i) => {
      const slot = avatarsRef.current.get(id);
      if (!slot) return;
      const x = slotX(i, total);
      slot.baseX = x;
      slot.vrm.scene.position.x = x;
    });

    if (cameraRef.current) {
      const spread = total > 1 ? AVATAR_SPACING * (total - 1) : 0;
      cameraRef.current.position.set(0, 1.2, Math.max(3, spread / 2 + 3.5));
      cameraRef.current.lookAt(0, 1, 0);
    }
  }, []);

  const ensureAvatar = useCallback(
    (identity: string): Promise<AvatarSlot> => {
      const existing = avatarsRef.current.get(identity);
      if (existing) return Promise.resolve(existing);

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

            VRMUtils.rotateVRM0(vrm);
            scene.add(vrm.scene);

            if (!orderRef.current.includes(identity)) {
              if (identity.startsWith('host-')) {
                orderRef.current.unshift(identity);
              } else {
                orderRef.current.push(identity);
              }
            }

            const hips = vrm.humanoid.getNormalizedBoneNode('hips');
            const initialHipsPos = hips ? hips.position.clone() : new THREE.Vector3();

            const slot: AvatarSlot = {
              vrm,
              baseX: 0,
              prevRotations: {},
              initialHipsPos
            };
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

  const _targetQuat = new THREE.Quaternion();

  const applyPose = useCallback(
    async (identity: string, rawData: unknown) => {
      try {
        const slot = await ensureAvatar(identity);
        const { vrm } = slot;
        const frame = rawData as PoseFrame;
        if (!frame.landmarks || frame.landmarks.length < 33) return;

        const { boneRotations, hipsPosition } = solveWithKalidokit(
          frame.worldLandmarks || frame.landmarks,
          frame.landmarks,
          slot.prevRotations,
          SOLVER_SMOOTHING
        );

        slot.prevRotations = boneRotations;

        const humanoid = vrm.humanoid;
        if (!humanoid) return;

        const delta = clockRef.current.getDelta();
        const t = Math.min(1 - Math.exp(-LERP_SPEED * delta), MAX_LERP_T);

        for (const [boneName, rot] of Object.entries(boneRotations)) {
          const bone = humanoid.getNormalizedBoneNode(boneName as any);
          if (!bone) continue;

          // Mirror horizontal axes (Y-Yaw and Z-Roll) for visual mirroring (左右同向)
          _targetQuat.set(rot.x, -rot.y, rot.z, rot.w);
          bone.quaternion.slerp(_targetQuat, t);

          // Apply Hips position
          if (boneName === 'hips' && hipsPosition) {
            bone.position.x = THREE.MathUtils.lerp(bone.position.x, -hipsPosition.x, t);
            bone.position.y = THREE.MathUtils.lerp(bone.position.y, hipsPosition.y, t);
            bone.position.z = THREE.MathUtils.lerp(bone.position.z, -hipsPosition.z, t);
          }
        }
      } catch (err) {
        console.warn(`[BigScreen] pose apply error for ${identity}:`, err);
      }
    },
    [ensureAvatar],
  );

  const removeAvatar = useCallback(
    (identity: string) => {
      const slot = avatarsRef.current.get(identity);
      if (!slot) return;
      sceneRef.current?.remove(slot.vrm.scene);
      avatarsRef.current.delete(identity);
      orderRef.current = orderRef.current.filter((id) => id !== identity);
      reposition();
    },
    [reposition],
  );

  return { applyPose, removeAvatar };
}

