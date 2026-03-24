import { useEffect, useRef, useCallback } from 'react';
import type { RefObject } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRM, VRMHumanBoneName } from '@pixiv/three-vrm';

interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

interface PoseData {
  landmarks?: PoseLandmark[];
}

/** How fast bones follow the target rotation (higher = snappier) */
const LERP_SPEED = 14
/** Upper clamp so a large delta spike doesn't teleport the bones */
const MAX_LERP_T = 0.9

export function useVrmAvatar(canvasRef: RefObject<HTMLCanvasElement | null>) {
  const vrmRef = useRef<VRM | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const clockRef = useRef(new THREE.Timer());
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Scene setup
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(30, canvas.width / canvas.height, 0.1, 20);
    camera.position.set(0, 1.3, 2.5);
    camera.lookAt(0, 1, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(canvas.width, canvas.height);
    renderer.setPixelRatio(window.devicePixelRatio);
    rendererRef.current = renderer;

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(1, 2, 1);
    scene.add(directional);

    // Load VRM
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    loader.load(
      '/default.vrm',
      (gltf) => {
        const vrm = gltf.userData.vrm as VRM | undefined;
        if (vrm) {
          scene.add(vrm.scene);
          // vrm.scene.rotation.y = Math.PI;
          vrmRef.current = vrm;
        }
      },
      undefined,
      (err) => {
        console.warn('Failed to load VRM avatar:', err);
      },
    );

    // Render loop
    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);
      const delta = clockRef.current.getDelta();
      if (vrmRef.current) {
        vrmRef.current.update(delta);
      }
      renderer.render(scene, camera);
    };
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafRef.current);
      renderer.dispose();
      if (vrmRef.current) {
        scene.remove(vrmRef.current.scene);
        vrmRef.current = null;
      }
    };
  }, [canvasRef]);

  // Reusable THREE objects (avoid per-frame allocation)
  const _targetQuat = new THREE.Quaternion()
  const _euler = new THREE.Euler()

  const applyPose = useCallback(async (rawData: unknown) => {
    const vrm = vrmRef.current;
    if (!vrm) return;

    const data = rawData as PoseData;
    if (!data.landmarks || data.landmarks.length < 33) return;

    try {
      const { Pose: KPose } = await import('kalidokit');

      const poseRig = KPose.solve(data.landmarks, data.landmarks, {
        runtime: 'mediapipe',
        enableLegs: true,
      });

      if (!poseRig) return;

      const humanoid = vrm.humanoid;
      if (!humanoid) return;

      // Apply spine rotation
      if (poseRig.Spine) {
        const spine = humanoid.getNormalizedBoneNode(VRMHumanBoneName.Spine);
        if (spine) {
          spine.rotation.x = poseRig.Spine.x;
          spine.rotation.y = poseRig.Spine.y;
          spine.rotation.z = poseRig.Spine.z;
        }
      }

      // Apply hip position/rotation
      if (poseRig.Hips) {
        const hips = humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips);
        if (hips && poseRig.Hips.rotation) {
          hips.rotation.x = poseRig.Hips.rotation.x;
          hips.rotation.y = poseRig.Hips.rotation.y;
          hips.rotation.z = poseRig.Hips.rotation.z;
        }
      }

      // Apply arm rotations
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

      // Frame-rate-independent interpolation factor
      const delta = clockRef.current.getDelta()
      const t = Math.min(1 - Math.exp(-LERP_SPEED * delta), MAX_LERP_T)

      for (const [rigKey, boneName] of boneMap) {
        const rigData = poseRig[rigKey as keyof typeof poseRig] as
          | { x: number; y: number; z: number; w: number }
          | undefined;
        if (rigData) {
          const bone = humanoid.getNormalizedBoneNode(boneName);
          if (bone) {
            bone.rotation.x = rigData.x;
            bone.rotation.y = rigData.y;
            bone.rotation.z = rigData.z;
          }
          // if (!bone) continue
          // _targetQuat.set(rigData.x, -rigData.y, rigData.z, rigData.w)
          // bone.quaternion.slerp(_targetQuat, t)
        }
      }
    } catch (err) {
      console.warn('Pose apply error:', err);
    }
  }, []);

  return { applyPose };
}
