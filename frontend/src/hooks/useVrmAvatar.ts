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

/** How fast bones follow the target rotation (higher = snappier) */
const LERP_SPEED = 14;
/** Upper clamp so a large delta spike doesn't teleport the bones */
const MAX_LERP_T = 0.9;
/** Smoothing for Kalidokit solver internally */
const SOLVER_SMOOTHING = 0.5;

export function useVrmAvatar(canvasRef: RefObject<HTMLCanvasElement | null>) {
  const vrmRef = useRef<VRM | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const clockRef = useRef(new THREE.Clock()); // Use THREE.Clock for delta
  const rafRef = useRef<number>(0);
  
  // Track previous state for smoothing
  const prevRotationsRef = useRef<Record<string, BoneRotation>>({});
  const initialHipsPosRef = useRef<THREE.Vector3 | null>(null);

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
          VRMUtils.rotateVRM0(vrm);
          scene.add(vrm.scene);
          vrmRef.current = vrm;
          
          // Store initial hips position
          const hips = vrm.humanoid.getNormalizedBoneNode('hips');
          if (hips) initialHipsPosRef.current = hips.position.clone();
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

  // Reusable THREE objects
  const _targetQuat = new THREE.Quaternion();

  const applyPose = useCallback((rawData: unknown) => {
    const vrm = vrmRef.current;
    if (!vrm) return;

    const frame = rawData as PoseFrame;
    if (!frame.landmarks || frame.landmarks.length < 33) return;
    
    // Fallback to landmarks if worldLandmarks is missing
    const worldLms = frame.worldLandmarks || frame.landmarks;
    const normLms = frame.landmarks;

    try {
      const { boneRotations, hipsPosition } = solveWithKalidokit(
        worldLms,
        normLms,
        prevRotationsRef.current,
        SOLVER_SMOOTHING
      );

      prevRotationsRef.current = boneRotations;

      const humanoid = vrm.humanoid;
      if (!humanoid) return;

      const delta = clockRef.current.getDelta();
      const t = Math.min(1 - Math.exp(-LERP_SPEED * delta), MAX_LERP_T);

      // Apply body bone rotations with mirroring
      for (const [boneName, rot] of Object.entries(boneRotations)) {
        const bone = humanoid.getNormalizedBoneNode(boneName as any);
        if (!bone) continue;

        // Mirror horizontal axes (Y-Yaw and Z-Roll) for visual mirroring (左右同向)
        _targetQuat.set(rot.x, -rot.y, rot.z, rot.w);
        bone.quaternion.slerp(_targetQuat, t);

        // Apply Hips position
        if (boneName === 'hips' && hipsPosition) {
          // Mirror X for Hips movement too
          bone.position.x = THREE.MathUtils.lerp(bone.position.x, -hipsPosition.x, t);
          bone.position.y = THREE.MathUtils.lerp(bone.position.y, hipsPosition.y, t);
          bone.position.z = THREE.MathUtils.lerp(bone.position.z, -hipsPosition.z, t);
        }
      }
    } catch (err) {
      console.warn('Pose apply error:', err);
    }
  }, []);

  return { applyPose };
}

