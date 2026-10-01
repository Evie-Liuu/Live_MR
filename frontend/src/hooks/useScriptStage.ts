/**
 * useScriptStage.ts
 *
 * 劇本模擬器的 3D 舞台：依場景設定擺好角色（每個 slot 一個預設模型），
 * 由劇本決定誰在說話，角色動作由 scriptedAvatar 的程式動畫驅動。
 *
 * 刻意不重用 useBigScreenScene：那是上課大螢幕的核心、API 以 MediaPipe 姿勢為中心，
 * 這裡只共用底層的 loadVrm / applyLights / propLoader，避免影響上課流程。
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { VRMUtils, type VRM } from '@pixiv/three-vrm';
import { SCENE_PRESETS } from '../config/scenes.ts';
import { VRM_SOURCES, DEFAULT_VRM_SOURCE_ID } from '../config/vrmSources.ts';
import { applyLights } from '../utils/threeScene.ts';
import { loadVrm } from '../utils/vrmLoader.ts';
import { loadStaticProps, disposeStaticProps } from '../utils/propLoader.ts';
import { createAvatarAnimator, type AvatarAnimator } from '../utils/scriptedAvatar.ts';

interface StageAvatar {
  slotId: string;
  vrm: VRM;
  animator: AvatarAnimator;
}

export interface ScriptStage {
  /** 所有角色載入完成 */
  ready: boolean;
  /** 0~1 載入進度 */
  progress: number;
  error: string | null;
  /** 設定目前說話的角色（null = 沒人說話） */
  setSpeaker: (slotId: string | null) => void;
}

/** 與大螢幕編輯模式相同：沒有姿勢驅動時把腳貼地 */
const FLOOR_Y = -0.5;

export function useScriptStage(canvasRef: RefObject<HTMLCanvasElement | null>, sceneId: string): ScriptStage {
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const speakerRef = useRef<string | null>(null);
  const setSpeaker = useCallback((slotId: string | null) => { speakerRef.current = slotId; }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const preset = SCENE_PRESETS[sceneId];
    if (!canvas || !preset) return;

    let disposed = false;
    const scene = new THREE.Scene();
    const { fov, position, lookAt, near = 0.1, far = 50 } = preset.camera;
    const camera = new THREE.PerspectiveCamera(fov, 16 / 9, near, far);
    camera.position.set(...position);
    camera.lookAt(...lookAt);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    applyLights(scene, preset);

    const shadowFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 24),
      new THREE.ShadowMaterial({ opacity: 0.35, transparent: true }),
    );
    shadowFloor.rotation.x = -Math.PI / 2;
    shadowFloor.receiveShadow = true;
    scene.add(shadowFloor);

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    // 靜態道具（收銀台等）；缺檔由 propLoader 吞掉
    let propPool: Map<string, THREE.Group> | null = null;
    loadStaticProps(preset.propSystem?.staticProps ?? [], scene)
      .then(pool => { if (disposed) disposeStaticProps(pool, scene); else propPool = pool; })
      .catch(err => console.warn('[ScriptStage] static props load error:', err));

    // 角色：每個 slot 載入預設模型
    const slots = preset.slots ?? [];
    const avatars: StageAvatar[] = [];
    const slotProgress = new Array(slots.length).fill(0);
    const reportProgress = () => setProgress(slots.length ? slotProgress.reduce((a, b) => a + b, 0) / slots.length : 1);
    Promise.all(slots.map(async (slot, i) => {
      const vrmId = slot.defaultVrmId ?? DEFAULT_VRM_SOURCE_ID;
      const url = (VRM_SOURCES[vrmId] ?? VRM_SOURCES[DEFAULT_VRM_SOURCE_ID]).url;
      const { vrm } = await loadVrm({
        url,
        scene,
        spawn: {
          position: [slot.position[0], FLOOR_Y, slot.position[2]],
          rotation: slot.rotation,
          scale: preset.avatarDefaults?.scale,
        },
        onProgress: p => { slotProgress[i] = p; reportProgress(); },
      });
      if (disposed) { scene.remove(vrm.scene); VRMUtils.deepDispose(vrm.scene); return; }
      slotProgress[i] = 1;
      reportProgress();
      avatars.push({ slotId: slot.id, vrm, animator: createAvatarAnimator(vrm, i * 2.3 + 0.7) });
    }))
      .then(() => { if (!disposed) setReady(true); })
      .catch(err => {
        console.error('[ScriptStage] avatar load failed:', err);
        if (!disposed) setError('角色模型載入失敗');
      });

    // 渲染迴圈：說話者看向其他角色的中心，聽者看向說話者
    const timer = new THREE.Timer();
    const headPos = new THREE.Vector3();
    const listenerCenter = new THREE.Vector3();
    let raf = 0;
    const animate = (timestamp: number) => {
      raf = requestAnimationFrame(animate);
      timer.update(timestamp);
      const delta = Math.min(timer.getDelta(), 0.1);
      const elapsed = timer.getElapsed();
      const speaker = avatars.find(a => a.slotId === speakerRef.current) ?? null;
      const speakerHead = speaker ? speaker.animator.headWorldPosition(new THREE.Vector3()) : null;

      for (const a of avatars) {
        const speaking = a === speaker;
        let lookTarget: THREE.Vector3 | null = null;
        if (speaking) {
          const others = avatars.filter(o => o !== a);
          if (others.length) {
            listenerCenter.set(0, 0, 0);
            for (const o of others) listenerCenter.add(o.animator.headWorldPosition(headPos));
            lookTarget = listenerCenter.divideScalar(others.length).clone();
          }
        } else if (speakerHead) {
          lookTarget = speakerHead;
        }
        a.animator.update(delta, elapsed, { speaking, lookTarget });
        a.vrm.update(delta);
      }
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      for (const a of avatars) { scene.remove(a.vrm.scene); VRMUtils.deepDispose(a.vrm.scene); }
      if (propPool) disposeStaticProps(propPool, scene);
      (shadowFloor.material as THREE.Material).dispose();
      shadowFloor.geometry.dispose();
      renderer.dispose();
    };
  }, [canvasRef, sceneId]);

  // 模擬器開著時場景不會變（編輯器被蓋住），所以不處理 sceneId 中途變更時的狀態重設
  return { ready, progress, error: SCENE_PRESETS[sceneId] ? error : '找不到此任務的場景', setSpeaker };
}
