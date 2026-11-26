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
import { anchorBonePosition, placePropOnBody, readBodyFrame, type BodyFrame } from '../utils/bodyHold.ts';
import type { WornProp } from '../utils/scriptPlayback.ts';
import { applyOutfit, hasOutfitStyle } from '../utils/vrmOutfit.ts';
import { loadCurtain, type Curtain } from '../utils/curtainAnimation.ts';
import { hiddenMembers, readSavedSceneLayout, resolveGroupPlacements, slotFloorY, type GroupTransform } from '../utils/savedSceneLayout.ts';
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
  /**
   * 讓角色做一次動作；動作檔還沒載入或載入失敗時略過。
   * pointAt：展示物件 id，動作期間上半身轉向它、手對準它（指向這件衣服）
   */
  playGesture: (slotId: string, gesture: GestureId, pointAt?: string) => void;
  /**
   * 角色把展示物件拿到手上（例如遞收據）；有動作時用動作裡伸出去的那隻手。
   * slotId 為 null 時放回原位
   */
  holdProp: (slotId: string | null, propId?: string, gesture?: GestureId) => void;
  /** 目前誰穿著（比在身上、戴著）哪些道具；不在清單裡的放回原位（正拿在手上的除外） */
  /** instant：直接換好、不拉簾子（跳句、回到第一句時用） */
  setWorn: (worn: readonly WornProp[], opts?: { instant?: boolean }) => void;
  /**
   * 等 setWorn 指定的穿著真的換好：有試衣間簾子時等「拉上 → 換裝 → 拉開」做完；
   * 不需要換裝（或模型沒有內建衣服）就在下一格畫面完成
   */
  waitOutfitSettled: () => Promise<void>;
}

type HandBone = 'leftHand' | 'rightHand';

interface HeldProp {
  slotId: string;
  propId: string;
  hand: HandBone;
  /** 已經到手上（之後直接貼住手，不再慢慢飛過去） */
  inHand: boolean;
}

/** 試穿時改過大小的道具慢慢轉回原本大小 */
function restoreScale(obj: THREE.Object3D, scale: number | undefined, delta: number) {
  const base = scale ?? 1;
  if (obj.scale.x !== base) obj.scale.setScalar(THREE.MathUtils.lerp(obj.scale.x, base, Math.min(1, delta * 8)));
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
  /** 展示物件目前的中心點（世界座標）；場景還沒載入或沒有這個物件時回傳 null */
  const propCenterRef = useRef<(propId: string) => THREE.Vector3 | null>(() => null);
  const playGesture = useCallback((slotId: string, gestureId: GestureId, pointAt?: string) => {
    const avatar = avatarsRef.current.find(a => a.slotId === slotId);
    const clip = avatar && clipFor(avatar, gestureId);
    if (avatar && clip) avatar.animator.playGesture(clip, pointAt ? propCenterRef.current(pointAt) : null);
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
  const wornRef = useRef<readonly WornProp[]>([]);
  /** 等換裝完成的人；渲染迴圈發現穿著已經換好、簾子拉開（或沒有簾子）時通知 */
  const outfitWaitersRef = useRef<(() => void)[]>([]);
  const waitOutfitSettled = useCallback(() => new Promise<void>(resolve => { outfitWaitersRef.current.push(resolve); }), []);
  const instantWornRef = useRef(false);
  const setWorn = useCallback((worn: readonly WornProp[], opts?: { instant?: boolean }) => {
    wornRef.current = worn;
    instantWornRef.current = opts?.instant === true;
  }, []);

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
    let curtain: Curtain | null = null;
    let taskPool: Map<string, THREE.Group> | null = null;
    loadStaticProps(preset.propSystem?.staticProps ?? [], scene)
      .then(pool => {
        if (disposed) { disposeStaticProps(pool, scene); return; }
        staticPool = pool;
        for (const [id, obj] of pool) place(obj, `staticProp:${id}`);
        // 試衣間的簾子（編輯模式藏起來的就不用）
        const room = (preset.propSystem?.staticProps ?? [])
          .find(p => p.fittingRoom && pool.has(p.id) && !hidden.has(`staticProp:${p.id}`));
        if (room?.fittingRoom) {
          void loadCurtain(pool.get(room.id)!, room.fittingRoom.openAnimationUrl, room.fittingRoom.speed).then(c => {
            if (disposed) c?.dispose();
            else curtain = c;
          });
        }
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
            position: placed?.pos ?? [slot.position[0], slotFloorY(slot, FLOOR_Y), slot.position[2]],
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
    const anchorPos = new THREE.Vector3();
    const bodyFrame: BodyFrame = { left: new THREE.Vector3(), forward: new THREE.Vector3(), sizeFactor: 1 };
    const propBox = new THREE.Box3();
    propCenterRef.current = (propId) => {
      const obj = taskPool?.get(propId);
      if (obj) {
        // 模型的原點不一定在中間（衣服常在衣架掛鉤），取外框中心
        propBox.setFromObject(obj);
        return propBox.isEmpty() ? obj.getWorldPosition(new THREE.Vector3()) : propBox.getCenter(new THREE.Vector3());
      }
      return taskPropCfg[propId] ? new THREE.Vector3(...displayOf(propId).pos) : null;
    };
    // 模型內建的衣服（見 utils/vrmOutfit.ts）：實際要換的衣服（角色載入了、模型有這個款式）變了才換；
    // 有試衣間簾子就先拉上、拉上後才換、換好再拉開，換裝過程中仍維持舊的穿著
    const outfitOf = (w: WornProp) => {
      const outfit = taskPropCfg[w.propId]?.outfit;
      const avatar = outfit && avatars.find(a => a.slotId === w.slotId);
      return outfit && avatar && hasOutfitStyle(avatar.vrm.scene, outfit) ? outfit : null;
    };
    const outfitKey = (worn: readonly WornProp[]) => worn
      .flatMap(w => { const o = outfitOf(w); return o ? [`${w.slotId}:${o.part}:${o.style}`.toLowerCase()] : []; })
      .sort().join('|');
    let appliedWorn: readonly WornProp[] = [];
    let appliedKey = '';
    const applyWorn = (worn: readonly WornProp[]) => {
      appliedWorn = worn;
      appliedKey = outfitKey(worn);
      for (const a of avatars) {
        applyOutfit(a.vrm.scene, worn.filter(w => w.slotId === a.slotId).flatMap(w => outfitOf(w) ?? []));
      }
    };
    const updateOutfits = (delta: number) => {
      curtain?.update(delta);
      const worn = wornRef.current;
      if (outfitKey(worn) === appliedKey) {
        appliedWorn = worn;
        // 跳句時簾子若還在動（上一句換裝到一半），直接停在拉開的樣子
        if (instantWornRef.current && curtain && curtain.state !== 'open') curtain.snapOpen();
        else if (curtain?.state === 'closed') curtain.open();
        if ((!curtain || curtain.state === 'open') && outfitWaitersRef.current.length) {
          const waiters = outfitWaitersRef.current;
          outfitWaitersRef.current = [];
          for (const w of waiters) w();
        }
        return;
      }
      if (instantWornRef.current) {
        // 跳句：直接換好，簾子停在拉開的樣子
        applyWorn(worn);
        curtain?.snapOpen();
      } else if (!curtain) applyWorn(worn);
      else if (curtain.state === 'closed') { applyWorn(worn); curtain.open(); }
      else curtain.close();
    };
    const updateProps = (delta: number) => {
      updateOutfits(delta);
      if (!taskPool) return;
      const held = heldRef.current;
      for (const [id, obj] of taskPool) {
        const cfg = taskPropCfg[id];
        // 穿在模型身上（顯示內建的衣服）時展示的道具藏起來，留在原位；脫下就出現
        const wornAsOutfit = appliedWorn.find(w => w.propId === id && outfitOf(w));
        obj.visible = !wornAsOutfit && !hidden.has(`taskProp:${id}`);
        if (wornAsOutfit && held?.propId !== id) continue;
        const holder = held?.propId === id ? avatars.find(a => a.slotId === held.slotId) : undefined;
        if (held && holder) {
          // attachPropToHand 用真人的左右（鏡像）：VRM 左手＝真人右手
          attachPropToHand(obj, holder.vrm, held.hand === 'leftHand' ? 'right' : 'left', held.inHand, cfg?.heldSideOffset, cfg?.heldOffset, cfg?.heldFingerReach);
          if (!held.inHand) {
            holder.vrm.humanoid.getNormalizedBoneNode(held.hand)?.getWorldPosition(displayPos);
            if (obj.position.distanceTo(displayPos) < 0.25) held.inHand = true;
          }
          if (cfg?.heldRotation) rotatePropToward(obj, cfg.heldRotation, delta * 8);
          else if (cfg?.bodyHold) rotatePropToward(obj, displayOf(id).rot, delta * 8);
          restoreScale(obj, cfg?.scale, delta);
          continue;
        }
        // 試穿中：比在身上或戴著（位置與大小依角色骨架算，見 utils/bodyHold.ts）
        // 模型有這件衣服的話等簾子拉上再換（上面處理），這裡只處理比在身上的
        const wearer = cfg?.bodyHold && wornRef.current.find(w => w.propId === id && !outfitOf(w));
        const wearerAvatar = wearer ? avatars.find(a => a.slotId === wearer.slotId) : undefined;
        if (cfg?.bodyHold && wearerAvatar
          && readBodyFrame(wearerAvatar.vrm, bodyFrame) && anchorBonePosition(wearerAvatar.vrm, cfg.bodyHold.anchor, anchorPos)) {
          placePropOnBody(obj, anchorPos, bodyFrame, cfg.bodyHold, cfg.scale ?? 1, delta * 8);
          continue;
        }
        const home = displayOf(id);
        displayPos.set(...home.pos);
        if (obj.position.distanceToSquared(displayPos) > 1e-8) returnPropToDisplay(obj, displayPos, delta);
        if (cfg?.heldRotation || cfg?.bodyHold) rotatePropToward(obj, home.rot, delta * 8);
        restoreScale(obj, cfg?.scale, delta);
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
      propCenterRef.current = () => null;
      cancelAnimationFrame(raf);
      observer.disconnect();
      curtain?.dispose();
      // 舞台關掉時不要讓等換裝的人一直等
      const waiters = outfitWaitersRef.current;
      outfitWaitersRef.current = [];
      for (const w of waiters) w();
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
  return { ready, progress, error: SCENE_PRESETS[sceneId] ? error : '找不到此任務的場景', setSpeaker, playGesture, holdProp, setWorn, waitOutfitSettled };
}
