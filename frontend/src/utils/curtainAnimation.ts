// frontend/src/utils/curtainAnimation.ts
//
// 試衣間簾子：綁好骨架的試衣間模型（例如 FittingRoom_Rigged.glb）套上另外存的「打開」動畫 GLB。
// 動畫往前播＝拉開，倒著播＝拉上；場景一開始是拉開的。換裝時先拉上、換好再拉開（見 useScriptStage）。

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type CurtainState = 'open' | 'closed' | 'moving';

export interface Curtain {
  readonly state: CurtainState;
  open(): void;
  close(): void;
  /** 不播動畫，直接停在拉開的樣子 */
  snapOpen(): void;
  update(delta: number): void;
  dispose(): void;
}

const loader = new GLTFLoader();

/** 動畫檔載入失敗或沒有動畫時回 null（換裝就不拉簾子，直接換） */
export async function loadCurtain(target: THREE.Object3D, animationUrl: string, speed = 1): Promise<Curtain | null> {
  let clip: THREE.AnimationClip | undefined;
  try {
    clip = (await loader.loadAsync(animationUrl)).animations[0];
  } catch (err) {
    console.warn(`[Curtain] Failed to load "${animationUrl}":`, err);
    return null;
  }
  if (!clip) {
    console.warn(`[Curtain] No animation in "${animationUrl}"`);
    return null;
  }
  // 簾子是蒙皮網格，骨頭動了外框不會跟著更新，避免被視錐剔除而消失
  target.traverse(obj => { if ((obj as THREE.SkinnedMesh).isSkinnedMesh) obj.frustumCulled = false; });

  const mixer = new THREE.AnimationMixer(target);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  // 一開始拉開：停在最後一格
  action.time = clip.duration;
  action.paused = true;
  mixer.update(0);

  const run = (direction: 1 | -1) => {
    action.timeScale = direction * speed;
    action.paused = false;
  };
  const EPS = 1e-3;

  return {
    get state(): CurtainState {
      if (!action.paused) return 'moving';
      return action.time <= EPS ? 'closed' : 'open';
    },
    open() { if (action.timeScale <= 0 || action.paused) { if (action.time < clip.duration - EPS) run(1); } },
    close() { if (action.timeScale >= 0 || action.paused) { if (action.time > EPS) run(-1); } },
    update(delta) { mixer.update(delta); },
    snapOpen() {
      action.time = clip.duration;
      action.timeScale = speed;
      action.paused = true;
      mixer.update(0);
    },
    dispose() { mixer.stopAllAction(); mixer.uncacheRoot(target); },
  };
}
