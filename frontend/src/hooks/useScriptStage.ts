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
import { loadStaticProps, disposeStaticProps, loadTaskProps, disposeTaskProps } from '../utils/propLoader.ts';
import { loadOccluderGlb, disposeOccluder } from '../utils/occluderLoader.ts';
import { OCCLUDER_LIBRARY_BY_ID } from '../config/sceneOccluders.ts';
import { attachPropToHand, returnPropToDisplay, rotatePropToward } from '../utils/propInteraction.ts';
import { hiddenMembers, readSavedSceneLayout, resolveGroupPlacements, type GroupTransform } from '../utils/savedSceneLayout.ts';
import { createAvatarAnimator, type AvatarAnimator } from '../utils/scriptedAvatar.ts';
import { VRMLookAtQuaternionProxy, createVRMAnimationClip, type VRMAnimation } from '@pixiv/three-vrm-animation';
import { GESTURES, type GestureId } from '../config/gestures.ts';
import { loadIdleAnimation } from '../utils/idleAvatar.ts';
import { DEFAULT_BODY_TYPE, loadAnimation, type BodyType } from '../utils/animationLibrary.ts';

interface StageAvatar {
  slotId: string;
  vrm: VRM;
  animator: AvatarAnimator;
  /** 決定動作檔版本（大人先找 <名稱>.adult.vrma） */
  bodyType: BodyType;
  /** 每個角色各自轉換的動作 clip（VRM0 / VRM1 轉換結果不同，不能共用） */
  clips: Map<GestureId, THREE.AnimationClip>;
}

export interface ScriptStage {
  /** 所有角色載入完成 */
  ready: boolean;
  /** 0~1 載入進度 */
  progress: number;
  error: string | null;
  /** 設定目前說話的角色（null = 沒人說話） */
  setSpeaker: (slotId: string | null) => void;
  /** 讓角色做一次動作；動作檔還沒載入或載入失敗時略過 */
  playGesture: (slotId: string, gesture: GestureId) => void;
  /**
   * 角色把展示物件拿到手上（例如遞收據）；有動作時用動作裡伸出去的那隻手。
   * slotId 為 null 時放回原位
   */
  holdProp: (slotId: string | null, propId?: string, gesture?: GestureId) => void;
}

type HandBone = 'leftHand' | 'rightHand';

interface HeldProp {
  slotId: string;
  propId: string;
  hand: HandBone;
  /** 已經到手上（之後直接貼住手，不再慢慢飛過去） */
  inHand: boolean;
}

/** 動作裡手臂轉動幅度較大的那隻手；沒有手臂動作時用右手 */
function activeHand(clip: THREE.AnimationClip, vrm: VRM): HandBone {
  const swing = (side: 'left' | 'right') => {
    let total = 0;
    for (const bone of [`${side}UpperArm`, `${side}LowerArm`] as const) {
      const node = vrm.humanoid.getNormalizedBoneNode(bone);
      const track = node && clip.tracks.find(t => t.name === `${node.name}.quaternion`);
      if (!track) continue;
      const v = track.values;
      let max = 0;
      for (let i = 4; i < v.length; i += 4) {
        const dot = Math.abs(v[0] * v[i] + v[1] * v[i + 1] + v[2] * v[i + 2] + v[3] * v[i + 3]);
        max = Math.max(max, 2 * Math.acos(Math.min(1, dot)));
      }
      total += max;
    }
    return total;
  };
  return swing('left') > swing('right') ? 'leftHand' : 'rightHand';
}

type GestureLibrary = Map<GestureId, VRMAnimation>;

/** 動作檔與場景無關，每種體型整個 app 共用一份 */
const gestureLibraries = new Map<BodyType, Promise<GestureLibrary>>();

function loadGestureLibrary(bodyType: BodyType): Promise<GestureLibrary> {
  let lib = gestureLibraries.get(bodyType);
  if (!lib) {
    lib = (async () => {
      const map: GestureLibrary = new Map();
      await Promise.all(GESTURES.map(async g => {
        const anim = await loadAnimation(g.url, bodyType);
        if (anim) map.set(g.id, anim);
      }));
      return map;
    })();
    gestureLibraries.set(bodyType, lib);
  }
  return lib;
}

/** 與大螢幕編輯模式相同：沒有姿勢驅動時把腳貼地 */
const FLOOR_Y = -0.5;

export function useScriptStage(canvasRef: RefObject<HTMLCanvasElement | null>, sceneId: string): ScriptStage {
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const speakerRef = useRef<string | null>(null);
  /** 最後一個說話的角色：句與句之間（speaker＝null）視線維持朝向他，等下一位開口才轉 */
  const lastSpeakerRef = useRef<string | null>(null);
  const setSpeaker = useCallback((slotId: string | null) => {
    speakerRef.current = slotId;
    if (slotId) lastSpeakerRef.current = slotId;
  }, []);
  const avatarsRef = useRef<StageAvatar[]>([]);
  const librariesRef = useRef(new Map<BodyType, GestureLibrary>());
  const clipFor = useCallback((avatar: StageAvatar, gestureId: GestureId) => {
    const anim = librariesRef.current.get(avatar.bodyType)?.get(gestureId);
    if (!anim) return null;
    let clip = avatar.clips.get(gestureId);
    if (!clip) {
      clip = createVRMAnimationClip(anim, avatar.vrm);
      avatar.clips.set(gestureId, clip);
    }
    return clip;
  }, []);
  const playGesture = useCallback((slotId: string, gestureId: GestureId) => {
    const avatar = avatarsRef.current.find(a => a.slotId === slotId);
    const clip = avatar && clipFor(avatar, gestureId);
    if (avatar && clip) avatar.animator.playGesture(clip);
  }, [clipFor]);
  const heldRef = useRef<HeldProp | null>(null);
  const holdProp = useCallback((slotId: string | null, propId?: string, gesture?: GestureId) => {
    const avatar = slotId ? avatarsRef.current.find(a => a.slotId === slotId) : undefined;
    if (!avatar || !propId) { heldRef.current = null; return; }
    const prev = heldRef.current;
    if (prev?.slotId === avatar.slotId && prev.propId === propId && !gesture) return;
    const clip = gesture ? clipFor(avatar, gesture) : null;
    const hand = clip ? activeHand(clip, avatar.vrm) : prev?.slotId === avatar.slotId && prev.propId === propId ? prev.hand : 'rightHand';
    const inHand = prev?.slotId === avatar.slotId && prev.propId === propId && prev.hand === hand && prev.inHand;
    heldRef.current = { slotId: avatar.slotId, propId, hand, inHand };
  }, [clipFor]);

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

    // 物件擺放跟上課的大螢幕一致：讀編輯模式存下來的群組移動、隱藏與遮罩物件
    const layout = readSavedSceneLayout(sceneId);
    const placements = resolveGroupPlacements(preset, layout.groupTransforms, FLOOR_Y);
    const hidden = hiddenMembers(preset, layout.groupHidden);
    const place = (obj: THREE.Object3D, key: string) => {
      const p = placements.get(key);
      if (p) { obj.position.set(...p.pos); obj.rotation.set(...p.rot); }
      if (hidden.has(key)) obj.visible = false;
    };

    // 靜態道具（收銀台、衣架）與展示物件（衣服等）；缺檔由 propLoader 吞掉
    let staticPool: Map<string, THREE.Group> | null = null;
    let taskPool: Map<string, THREE.Group> | null = null;
    loadStaticProps(preset.propSystem?.staticProps ?? [], scene)
      .then(pool => {
        if (disposed) { disposeStaticProps(pool, scene); return; }
        staticPool = pool;
        for (const [id, obj] of pool) place(obj, `staticProp:${id}`);
      })
      .catch(err => console.warn('[ScriptStage] static props load error:', err));
    loadTaskProps(preset.propSystem?.taskProps ?? {}, scene)
      .then(pool => {
        if (disposed) { disposeTaskProps(pool, scene); return; }
        taskPool = pool;
        for (const [id, obj] of pool) place(obj, `taskProp:${id}`);
      })
      .catch(err => console.warn('[ScriptStage] task props load error:', err));

    // 遮罩物件（老師在編輯模式加的）
    const occluders: THREE.Group[] = [];
    for (const inst of layout.occluders) {
      const lib = OCCLUDER_LIBRARY_BY_ID[inst.libraryId];
      if (!lib) continue;
      void loadOccluderGlb(lib.glbUrl, scene).then(group => {
        if (!group) return;
        if (disposed) { disposeOccluder(group, scene); return; }
        group.position.set(...inst.position);
        group.rotation.set(...inst.rotation);
        group.scale.setScalar(inst.scale);
        occluders.push(group);
      });
    }

    // 角色：每個 slot 載入預設模型
    const slots = preset.slots ?? [];
    const avatars: StageAvatar[] = [];
    avatarsRef.current = avatars;
    // 場景裡有哪些體型就載哪幾套動作
    const libraries = librariesRef.current;
    const bodyTypes = new Set(slots.map(s => VRM_SOURCES[s.defaultVrmId ?? DEFAULT_VRM_SOURCE_ID]?.bodyType ?? DEFAULT_BODY_TYPE));
    for (const bt of bodyTypes) void loadGestureLibrary(bt).then(lib => { if (!disposed) libraries.set(bt, lib); });
    const slotProgress = new Array(slots.length).fill(0);
    const reportProgress = () => setProgress(slots.length ? slotProgress.reduce((a, b) => a + b, 0) / slots.length : 1);
    Promise.all(slots.map(async (slot, i) => {
      const vrmId = slot.defaultVrmId ?? DEFAULT_VRM_SOURCE_ID;
      const source = VRM_SOURCES[vrmId] ?? VRM_SOURCES[DEFAULT_VRM_SOURCE_ID];
      const url = source.url;
      const bodyType = source.bodyType ?? DEFAULT_BODY_TYPE;
      const placed: GroupTransform | undefined = placements.get(`slot:${slot.id}`);
      const [{ vrm }, idleAnim] = await Promise.all([
        loadVrm({
          url,
          scene,
          spawn: {
            position: placed?.pos ?? [slot.position[0], FLOOR_Y, slot.position[2]],
            rotation: placed?.rot ?? slot.rotation,
            scale: preset.avatarDefaults?.scale,
          },
          onProgress: p => { slotProgress[i] = p; reportProgress(); },
        }),
        loadIdleAnimation(bodyType),
      ]);
      if (disposed) { scene.remove(vrm.scene); VRMUtils.deepDispose(vrm.scene); return; }
      slotProgress[i] = 1;
      reportProgress();
      if (hidden.has(`slot:${slot.id}`)) vrm.scene.visible = false;
      // createVRMAnimationClip 需要視線代理物件，先建好避免它每次自動建立並印警告
      if (vrm.lookAt) {
        const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
        proxy.name = 'VRMLookAtQuaternionProxy';
        vrm.scene.add(proxy);
      }
      const animator = createAvatarAnimator(vrm, i * 2.3 + 0.7);
      if (idleAnim) animator.setIdle(createVRMAnimationClip(idleAnim, vrm));
      avatars.push({ slotId: slot.id, vrm, animator, bodyType, clips: new Map() });
    }))
      .then(() => { if (!disposed) setReady(true); })
      .catch(err => {
        console.error('[ScriptStage] avatar load failed:', err);
        if (!disposed) setError('角色模型載入失敗');
      });

    // 渲染迴圈：說話者看向其他角色的中心，聽者看向說話者；
    // 講完不復原，視線停在原處，等下一位說話者開口才轉向
    // 展示物件：被拿著的貼到手上，其餘回到擺放位置
    const taskPropCfg = preset.propSystem?.taskProps ?? {};
    const displayOf = (id: string): GroupTransform => placements.get(`taskProp:${id}`)
      ?? { pos: taskPropCfg[id].displayPos, rot: taskPropCfg[id].rotation ?? [0, 0, 0] };
    const displayPos = new THREE.Vector3();
    const updateProps = (delta: number) => {
      if (!taskPool) return;
      const held = heldRef.current;
      for (const [id, obj] of taskPool) {
        const cfg = taskPropCfg[id];
        const holder = held?.propId === id ? avatars.find(a => a.slotId === held.slotId) : undefined;
        if (held && holder) {
          // attachPropToHand 用真人的左右（鏡像）：VRM 左手＝真人右手
          attachPropToHand(obj, holder.vrm, held.hand === 'leftHand' ? 'right' : 'left', held.inHand, cfg?.heldSideOffset, cfg?.heldOffset, cfg?.heldFingerReach);
          if (!held.inHand) {
            holder.vrm.humanoid.getNormalizedBoneNode(held.hand)?.getWorldPosition(displayPos);
            if (obj.position.distanceTo(displayPos) < 0.25) held.inHand = true;
          }
          if (cfg?.heldRotation) rotatePropToward(obj, cfg.heldRotation, delta * 8);
          continue;
        }
        const home = displayOf(id);
        displayPos.set(...home.pos);
        if (obj.position.distanceToSquared(displayPos) > 1e-8) returnPropToDisplay(obj, displayPos, delta);
        if (cfg?.heldRotation) rotatePropToward(obj, home.rot, delta * 8);
      }
    };

    const timer = new THREE.Timer();
    const headPos = new THREE.Vector3();
    const listenerCenter = new THREE.Vector3();
    let raf = 0;
    const animate = (timestamp: number) => {
      raf = requestAnimationFrame(animate);
      timer.update(timestamp);
      // 動作 / 嘴型用實際經過時間，低幀率時才不會變成慢動作而跟語音對不上；
      // 彈簧骨（頭髮）物理在大 delta 下會爆衝，維持 0.1 秒上限
      const rawDelta = Math.min(timer.getDelta(), 1);
      const physicsDelta = Math.min(rawDelta, 0.1);
      const elapsed = timer.getElapsed();
      const speaker = avatars.find(a => a.slotId === speakerRef.current) ?? null;
      // 視線焦點：正在說話的人；沒人說話時沿用最後一位說話者
      const focus = speaker ?? avatars.find(a => a.slotId === lastSpeakerRef.current) ?? null;
      const focusHead = focus ? focus.animator.headWorldPosition(new THREE.Vector3()) : null;

      for (const a of avatars) {
        const speaking = a === speaker;
        let lookTarget: THREE.Vector3 | null = null;
        if (a === focus) {
          const others = avatars.filter(o => o !== a);
          if (others.length) {
            listenerCenter.set(0, 0, 0);
            for (const o of others) listenerCenter.add(o.animator.headWorldPosition(headPos));
            lookTarget = listenerCenter.divideScalar(others.length).clone();
          }
        } else if (focusHead) {
          lookTarget = focusHead;
        }
        a.animator.update(rawDelta, elapsed, { speaking, lookTarget });
        a.vrm.update(physicsDelta);
      }
      updateProps(rawDelta);
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      avatarsRef.current = [];
      cancelAnimationFrame(raf);
      observer.disconnect();
      for (const a of avatars) { scene.remove(a.vrm.scene); VRMUtils.deepDispose(a.vrm.scene); }
      if (staticPool) disposeStaticProps(staticPool, scene);
      if (taskPool) disposeTaskProps(taskPool, scene);
      for (const g of occluders) disposeOccluder(g, scene);
      (shadowFloor.material as THREE.Material).dispose();
      shadowFloor.geometry.dispose();
      renderer.dispose();
    };
  }, [canvasRef, sceneId]);

  // 模擬器開著時場景不會變（編輯器被蓋住），所以不處理 sceneId 中途變更時的狀態重設
  return { ready, progress, error: SCENE_PRESETS[sceneId] ? error : '找不到此任務的場景', setSpeaker, playGesture, holdProp };
}
