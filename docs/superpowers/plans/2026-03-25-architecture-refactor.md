# Architecture Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除重複代碼、解耦核心邏輯、提升類型安全，讓每個模組職責單一、邊界清晰。

**Architecture:** 分五個獨立階段逐步重構：(1) 抽取共享常數 → (2) 抽取 Three.js 共用工具 → (3) 解耦 `usePoseDetection` 與 LiveKit → (4) 拆解 HostSession 大型元件 → (5) 修復類型安全與代碼品質。每個階段都能獨立測試並提交。

**Tech Stack:** React 19, TypeScript 5.9, Three.js 0.183, LiveKit Client 2.x, MediaPipe, Kalidokit, Vite 8, Vitest 3 (backend)

---

## 問題清單（對應到各 Task）

| # | 問題 | 嚴重度 | Task |
|---|------|--------|------|
| 1 | `LIVEKIT_URL` 常數在 `HostSession.tsx` 和 `StudentSession.tsx` 重複定義 | 中 | 1 |
| 2 | `CHANNEL_NAME` 常數在 `HostSession.tsx` 和 `BigScreen.tsx` 重複定義 | 中 | 1 |
| 3 | `applyLights()` 函數在 `useVrmAvatar.ts` 和 `useBigScreenScene.ts` 邏輯等效（實作細節略有差異） | 高 | 2 |
| 4 | `applyGrid()` 只在 `useBigScreenScene.ts` 使用，可同步移到共用工具 | 低 | 2 |
| 5 | `PoseFrame` 類型在 `hooks/usePoseDetection.ts` 和 `types/vrm.ts` 各自定義 | 高 | 3 |
| 6 | `usePoseDetection` 直接依賴 `MutableRefObject<Room>` —— 緊耦合 LiveKit | 高 | 3 |
| 7 | `HostSession` 為了讓老師使用 `usePoseDetection` 造出假 Room 物件 proxy | 高 | 3 |
| 8 | `HostSession.tsx` 427 行：含內嵌 `LocalVideo`、LiveKit 連線、BroadcastChannel | 高 | 4 |
| 9 | `LocalVideo` 內嵌於 `HostSession.tsx`，無法獨立測試 | 中 | 4 |
| 10 | `any` 類型：`StudentSession.tsx:18`、`StudentTile.tsx:9`、`routes.ts:12` | 中 | 5 |
| 11 | `useBigScreenScene.ts` 有除錯用 `console.log`（lines 168-169）及大量死碼 | 低 | 5 |
| 12 | `BigScreen.tsx` canvas 用 `window.innerWidth/Height` 固定尺寸，不會自適應 | 低 | 5 |

---

## 檔案變更地圖

| 動作 | 路徑 | 說明 |
|------|------|------|
| 新增 | `frontend/src/config/constants.ts` | `LIVEKIT_URL`, `CHANNEL_NAME` 等共享常數 |
| 新增 | `frontend/src/utils/threeScene.ts` | 共用 Three.js 工具：`applyLights`, `applyGrid` |
| 新增 | `frontend/src/components/LocalVideo.tsx` | 從 HostSession 抽出的老師自拍元件 |
| 修改 | `frontend/src/hooks/usePoseDetection.ts` | 移除 Room 依賴，改用 `onPublish` callback；改用共享 `PoseFrame` 類型 |
| 修改 | `frontend/src/hooks/useVrmAvatar.ts` | 移除內部 `applyLights`，改用 `threeScene.ts` |
| 修改 | `frontend/src/hooks/useBigScreenScene.ts` | 移除內部 `applyLights/applyGrid`，改用 `threeScene.ts`；移除死碼 |
| 修改 | `frontend/src/components/HostSession.tsx` | 移除內嵌 `LocalVideo`；移除 Room proxy；使用常數；解耦 |
| 修改 | `frontend/src/components/StudentSession.tsx` | 移除 `any`；使用共享 `PoseFrame` 類型；使用常數 |
| 修改 | `frontend/src/components/StudentTile.tsx` | 移除 `any`；使用共享 `PoseFrame` 類型 |
| 修改 | `frontend/src/components/BigScreen.tsx` | 修復 canvas 尺寸自適應 |
| 修改 | `backend/src/routes.ts` | 移除 `any` 類型 |

---

## Task 1：抽取共享常數

**Files:**
- 新增: `frontend/src/config/constants.ts`
- 修改: `frontend/src/components/HostSession.tsx:106-107`
- 修改: `frontend/src/components/StudentSession.tsx:12`
- 修改: `frontend/src/components/BigScreen.tsx:16`

- [ ] **Step 1: 新增 constants.ts**

```typescript
// frontend/src/config/constants.ts

/** LiveKit server WebSocket URL — set VITE_LIVEKIT_URL in .env to override */
export const LIVEKIT_URL =
  (import.meta.env.VITE_LIVEKIT_URL as string | undefined) ?? 'ws://localhost:7880';

/** BroadcastChannel name for HostSession ↔ BigScreen pose relay */
export const BIGSCREEN_CHANNEL_NAME = 'live-mr-bigscreen';
```

- [ ] **Step 2: 更新 HostSession.tsx — 改用匯入常數**

在 `frontend/src/components/HostSession.tsx` 中：

移除舊定義：
```typescript
// 刪除這兩行 (line 106-107)
const LIVEKIT_URL = (import.meta.env.VITE_LIVEKIT_URL as string) || 'ws://localhost:7880';
const CHANNEL_NAME = 'live-mr-bigscreen';
```

在 import 區域加入：
```typescript
import { LIVEKIT_URL, BIGSCREEN_CHANNEL_NAME } from '../config/constants.ts';
```

將檔案中所有 `CHANNEL_NAME` 改為 `BIGSCREEN_CHANNEL_NAME`（共 2 處：定義行 + `new BroadcastChannel(CHANNEL_NAME)` 呼叫）。

- [ ] **Step 3: 更新 StudentSession.tsx — 改用匯入常數**

移除：
```typescript
// 刪除 line 12
const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL as string || 'ws://localhost:7880';
```

加入 import：
```typescript
import { LIVEKIT_URL } from '../config/constants.ts';
```

- [ ] **Step 4: 更新 BigScreen.tsx — 改用匯入常數**

移除：
```typescript
// 刪除 line 16
const CHANNEL_NAME = 'live-mr-bigscreen';
```

加入 import：
```typescript
import { BIGSCREEN_CHANNEL_NAME } from '../config/constants.ts';
```

將 `CHANNEL_NAME` 改為 `BIGSCREEN_CHANNEL_NAME`（共 2 處）。

- [ ] **Step 5: 手動驗證 TypeScript 編譯無錯誤**

```bash
cd /c/Project/Live_MR/frontend && npx tsc --noEmit
```

Expected: 無錯誤輸出。

- [ ] **Step 6: Commit**

```bash
cd /c/Project/Live_MR
git add frontend/src/config/constants.ts \
        frontend/src/components/HostSession.tsx \
        frontend/src/components/StudentSession.tsx \
        frontend/src/components/BigScreen.tsx
git commit -m "refactor: extract LIVEKIT_URL and BIGSCREEN_CHANNEL_NAME to constants.ts"
```

---

## Task 2：抽取共用 Three.js 工具函數

**Files:**
- 新增: `frontend/src/utils/threeScene.ts`
- 修改: `frontend/src/hooks/useVrmAvatar.ts:36-47`（移除 `applyLights`，改 import）
- 修改: `frontend/src/hooks/useBigScreenScene.ts:46-68`（移除 `applyLights`/`applyGrid`，改 import）

- [ ] **Step 1: 新增 threeScene.ts**

```typescript
// frontend/src/utils/threeScene.ts
import * as THREE from 'three';
import type { SceneConfig } from '../types/vrm';

/** Apply lighting from a SceneConfig to a THREE.Scene */
export function applyLights(scene: THREE.Scene, config: SceneConfig): void {
  for (const light of config.lights) {
    if (light.type === 'ambient') {
      scene.add(new THREE.AmbientLight(light.color ?? 0xffffff, light.intensity));
    } else if (light.type === 'directional') {
      const l = new THREE.DirectionalLight(light.color ?? 0xffffff, light.intensity);
      if (light.position) l.position.set(...light.position);
      scene.add(l);
    }
  }
}

/** Add a floor grid from a SceneConfig to a THREE.Scene */
export function applyGrid(scene: THREE.Scene, config: SceneConfig): void {
  if (!config.grid) return;
  const { size, divisions, color } =
    config.grid === true
      ? { size: 20, divisions: 20, color: 0x2a2a4a }
      : { size: config.grid.size, divisions: config.grid.divisions, color: config.grid.color ?? 0x2a2a4a };
  const grid = new THREE.GridHelper(size, divisions, color, color);
  scene.add(grid);
}
```

- [ ] **Step 2: 更新 useVrmAvatar.ts — 移除內部 applyLights，改用匯入**

刪除 `useVrmAvatar.ts` 中 lines 36-47 的 `applyLights` 函數定義：
```typescript
// 刪除這整段（lines 36-47）
function applyLights(scene: THREE.Scene, config: SceneConfig): void {
  for (const light of config.lights) {
    ...
  }
}
```

在 import 區域加入：
```typescript
import { applyLights } from '../utils/threeScene';
```

同時移除已不需要的 `SceneConfig` import（若 `SceneConfig` 只用在此函數）——確認 `SceneConfig` 仍在其他地方被引用（它還用在 `preset` 的型別推斷），故保留。

- [ ] **Step 3: 更新 useBigScreenScene.ts — 移除內部函數，改用匯入**

刪除 lines 46-68 的兩個函數：
```typescript
// 刪除 applyLights 函數（lines 46-57）
function applyLights(scene: THREE.Scene, config: SceneConfig): void { ... }

// 刪除 applyGrid 函數（lines 59-68）
function applyGrid(scene: THREE.Scene, config: SceneConfig): void { ... }
```

在 import 區域加入：
```typescript
import { applyLights, applyGrid } from '../utils/threeScene';
```

- [ ] **Step 4: 驗證編譯**

```bash
cd /c/Project/Live_MR/frontend && npx tsc --noEmit
```

Expected: 無錯誤。

- [ ] **Step 5: Commit**

```bash
cd /c/Project/Live_MR
git add frontend/src/utils/threeScene.ts \
        frontend/src/hooks/useVrmAvatar.ts \
        frontend/src/hooks/useBigScreenScene.ts
git commit -m "refactor: extract applyLights/applyGrid to shared threeScene.ts util"
```

---

## Task 3：解耦 usePoseDetection 與 LiveKit Room

**背景：** 現在 `usePoseDetection` 直接呼叫 `room.localParticipant.publishData`，導致：
- 老師使用時必須造一個假 Room proxy 物件（`HostSession.tsx:174-200`）
- 無法在非 LiveKit 情境下使用（如未來離線模式）

**解法：** 將 Room 依賴替換為 `onPublish: (data: Uint8Array) => void` callback。

**Files:**
- 修改: `frontend/src/hooks/usePoseDetection.ts`（重寫 signature）
- 修改: `frontend/src/components/StudentSession.tsx`（更新呼叫方式）
- 修改: `frontend/src/components/HostSession.tsx`（移除 proxy，更新呼叫方式）

- [ ] **Step 1: 重寫 usePoseDetection.ts**

```typescript
// frontend/src/hooks/usePoseDetection.ts
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { PoseLandmark, PoseFrame } from '../types/vrm';

// Re-export PoseFrame as a convenience (callers can import from here or from '../types/vrm')
export type { PoseFrame };

const WASM_PATH = '/mediapipe-wasm';
const MODEL_PATH = '/mediapipe-models/pose_landmarker_heavy.task';
const encoder = new TextEncoder();

export function usePoseDetection(
  videoRef: RefObject<HTMLVideoElement | null>,
  /**
   * Called with the encoded PoseFrame bytes each detected frame.
   * Pass `null` to skip publishing (pose-only mode without network).
   */
  onPublish: ((data: Uint8Array) => void) | null,
  onLandmarksUpdate?: (landmarks: PoseLandmark[]) => void,
) {
  const poseRef = useRef<PoseLandmarker | null>(null);
  const rafRef = useRef<number>(0);
  // Keep a stable ref to the latest onPublish so the loop closure doesn't go stale
  const onPublishRef = useRef(onPublish);
  onPublishRef.current = onPublish;

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
        const commonOptions = {
          runningMode: 'VIDEO' as const,
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        };

        let poseLandmarker: PoseLandmarker | null = null;
        try {
          poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
            ...commonOptions,
          });
        } catch {
          console.warn('[PoseDetection] GPU delegate failed, falling back to CPU');
          poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
            ...commonOptions,
          });
        }

        if (cancelled) { poseLandmarker.close(); return; }
        poseRef.current = poseLandmarker;

        const loop = () => {
          if (cancelled) return;
          const video = videoRef.current;
          const pose = poseRef.current;

          if (video && video.readyState >= 2 && pose) {
            try {
              const result = pose.detectForVideo(video, performance.now());

              if (result.landmarks && result.landmarks.length > 0) {
                const frame: PoseFrame = {
                  type: 'pose',
                  landmarks: result.landmarks[0].map((l) => ({
                    x: l.x, y: l.y, z: l.z,
                    visibility: l.visibility ?? 0,
                  })),
                  worldLandmarks:
                    result.worldLandmarks && result.worldLandmarks.length > 0
                      ? result.worldLandmarks[0].map((l) => ({
                          x: l.x, y: l.y, z: l.z,
                          visibility: l.visibility ?? 0,
                        }))
                      : [],
                };

                onLandmarksUpdate?.(frame.landmarks);
                onPublishRef.current?.(encoder.encode(JSON.stringify(frame)));
              }
            } catch {
              // ignore per-frame errors
            }
          }

          if (!cancelled) rafRef.current = requestAnimationFrame(loop);
        };

        rafRef.current = requestAnimationFrame(loop);
      } catch (err) {
        console.error('[PoseDetection] Failed to initialize PoseLandmarker:', err);
      }
    };

    init();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      poseRef.current?.close();
    };
  }, [videoRef]);
}
```

> **注意**：`onPublish` 和 `onLandmarksUpdate` 故意不加入 `useEffect` dependency array。它們透過 ref 保持最新，避免每次 render 重啟 MediaPipe。

- [ ] **Step 2: 更新 StudentSession.tsx — 改用 onPublish callback**

在 `StudentSession.tsx` 中，將：
```typescript
const [landmarks, setLandmarks] = useState<any[] | null>(null);
...
usePoseDetection(videoRef, roomRef, (lms) => {
  ...
  setLandmarks(lms);
});
```

替換為（**注意：** `StudentSession.tsx` 目前未 import `PoseLandmark`，需手動新增這個 import）：
```typescript
import { useState, useEffect, useRef, useCallback } from 'react';
import type { PoseLandmark } from '../types/vrm';  // 新增此行
...
const [landmarks, setLandmarks] = useState<PoseLandmark[] | null>(null);
...
// 從 roomRef 建立 onPublish callback
// eslint-disable-next-line react-hooks/exhaustive-deps — roomRef 是穩定的 useRef，空 deps 正確
const publishPose = useCallback(
  (data: Uint8Array) => {
    const room = roomRef.current;
    if (room?.state === 'connected') {
      room.localParticipant.publishData(data, { reliable: false });
    }
  },
  [],
);

usePoseDetection(videoRef, publishPose, (lms) => {
  if (videoRef.current) {
    setVideoSize({
      width: videoRef.current.clientWidth,
      height: videoRef.current.clientHeight,
    });
  }
  setLandmarks(lms);
});
```

同時確認 `useCallback` 已在 import 中。移除 `roomRef` 從 `usePoseDetection` 的傳入（第二個參數改為 `publishPose`）。

- [ ] **Step 3: 更新 HostSession.tsx — 移除 proxy hack，改用 onPublish callback**

**3a. 移除舊的 proxy 定義（lines 174-200，含尾端的 `usePoseDetection` 呼叫）：**

整段刪除（注意：range 到 200 才包含舊的 `usePoseDetection(teacherVideoRef, teacherPoseInterceptRef)` 呼叫）：
```typescript
// 刪除 lines 174-200
const teacherPoseInterceptRef = useRef<Room | null>(null);

useEffect(() => {
  const proxy = {
    localParticipant: {
      publishData: (_data: Uint8Array, _opts: unknown) => { ... },
    },
    state: 'connected',
  } as unknown as Room;
  teacherPoseInterceptRef.current = proxy;
}, [connectedRoom]);

usePoseDetection(teacherVideoRef, teacherPoseInterceptRef);
```

**3b. 在老師 `usePoseDetection` 呼叫改用 onPublish callback：**

在適當位置（`connectedRoom` state 之後）加入。
**重要：** callback 內必須判斷 `connectedRoom` 是否存在，避免 MediaPipe 啟動後、LiveKit 連線前就廣播資料到 BigScreen：

```typescript
// Teacher pose: intercept PoseFrame and relay to BigScreen
// Guard: only broadcast after connectedRoom is available to get the real participant identity
const teacherPublishPose = useCallback(
  (data: Uint8Array) => {
    if (!connectedRoom) return; // 尚未連線，不廣播
    try {
      const text = new TextDecoder().decode(data);
      const parsed = JSON.parse(text) as unknown;
      const identity = connectedRoom.localParticipant.identity;
      poseSnapshotRef.current[identity] = parsed;
      setTeacherPoseData(parsed);
      const msg: BigScreenMsg = { type: 'pose', identity, poseData: parsed };
      channelRef.current?.postMessage(msg);
    } catch { /* ignore */ }
  },
  [connectedRoom],
);

usePoseDetection(teacherVideoRef, teacherPublishPose);
```

移除 `teacherPoseInterceptRef` 的宣告和相關 import（`MutableRefObject` 若不再使用）。

- [ ] **Step 4: 驗證編譯**

```bash
cd /c/Project/Live_MR/frontend && npx tsc --noEmit
```

Expected: 無錯誤。

- [ ] **Step 5: Commit**

```bash
cd /c/Project/Live_MR
git add frontend/src/hooks/usePoseDetection.ts \
        frontend/src/components/StudentSession.tsx \
        frontend/src/components/HostSession.tsx
git commit -m "refactor: decouple usePoseDetection from LiveKit Room via onPublish callback"
```

---

## Task 4：拆解 HostSession 大型元件

**背景：** `HostSession.tsx` 目前有 427 行，包含 `LocalVideo` 內嵌元件、LiveKit 連線邏輯、BroadcastChannel 管理，職責不清。

**解法：** 抽出 `LocalVideo` 為獨立元件。

**Files:**
- 新增: `frontend/src/components/LocalVideo.tsx`
- 修改: `frontend/src/components/HostSession.tsx`（移除內嵌 LocalVideo 定義）

- [ ] **Step 1: 新增 LocalVideo.tsx**

```typescript
// frontend/src/components/LocalVideo.tsx
import { useEffect, useRef, useState } from 'react';
import type { Room } from 'livekit-client';
import { Track } from 'livekit-client';
import PoseDebugOverlay from './PoseDebugOverlay';
import type { PoseFrame } from '../types/vrm';

interface LocalVideoProps {
  room: Room;
  poseData?: unknown;
}

/**
 * Teacher self-view tile: attaches the local camera track to a <video>
 * and overlays the pose debug skeleton if poseData is available.
 */
export default function LocalVideo({ room, poseData }: LocalVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoSize, setVideoSize] = useState({ width: 320, height: 240 });

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const attachCamera = () => {
      const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (camPub?.track) {
        el.srcObject = new MediaStream([camPub.track.mediaStreamTrack]);
      }
    };

    const handleLoadedMetadata = () => {
      setVideoSize({
        width: el.clientWidth || 320,
        height: el.clientHeight || 240,
      });
    };
    el.addEventListener('loadedmetadata', handleLoadedMetadata);

    attachCamera();
    room.localParticipant.on('localTrackPublished', attachCamera);

    return () => {
      room.localParticipant.off('localTrackPublished', attachCamera);
      el.srcObject = null;
      el.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [room]);

  // Keep size in sync with poseData updates
  useEffect(() => {
    const el = videoRef.current;
    if (poseData && el && el.clientWidth > 0) {
      setVideoSize((prev) => {
        if (prev.width !== el.clientWidth || prev.height !== el.clientHeight) {
          return { width: el.clientWidth, height: el.clientHeight };
        }
        return prev;
      });
    }
  }, [poseData]);

  const landmarks = (poseData as PoseFrame | null)?.landmarks;

  return (
    <div className="teacher-tile" style={{ position: 'relative' }}>
      <video ref={videoRef} autoPlay playsInline muted className="tile-video" />
      {landmarks && (
        <PoseDebugOverlay
          landmarks={[landmarks as never]}
          width={videoSize.width}
          height={videoSize.height}
        />
      )}
      <div
        className="teacher-label"
        style={{
          position: 'absolute',
          bottom: 5,
          right: 5,
          background: 'rgba(0,0,0,0.5)',
          color: '#fff',
          padding: '2px 5px',
        }}
      >
        老師 (我)
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 更新 HostSession.tsx — 移除內嵌 LocalVideo，改用 import**

刪除 `HostSession.tsx` 中 lines 17-92 的整個 `LocalVideo` 函數定義。

加入 import：
```typescript
import LocalVideo from './LocalVideo.tsx';
```

確認 render 區域的 `<LocalVideo room={connectedRoom} poseData={teacherPoseData} />` 呼叫不變。

- [ ] **Step 3: 驗證編譯**

```bash
cd /c/Project/Live_MR/frontend && npx tsc --noEmit
```

Expected: 無錯誤。

- [ ] **Step 4: Commit**

```bash
cd /c/Project/Live_MR
git add frontend/src/components/LocalVideo.tsx \
        frontend/src/components/HostSession.tsx
git commit -m "refactor: extract LocalVideo component from HostSession"
```

---

## Task 5：修復類型安全與代碼品質

**Files:**
- 修改: `frontend/src/components/StudentTile.tsx`（移除 `any`）
- 修改: `frontend/src/hooks/useBigScreenScene.ts`（移除 debug log、死碼；修復 renderer 初始尺寸）
- 修改: `frontend/src/components/BigScreen.tsx`（移除 canvas width/height attribute，改由 CSS 控制）
- 修改: `frontend/src/App.css` 或 `index.css`（確認 `.bigscreen-root` / `.bigscreen-canvas` CSS 規則存在）
- 修改: `backend/src/routes.ts`（移除 `any`）

- [ ] **Step 1: 修復 StudentTile.tsx 的 any 類型**

將 `StudentTile.tsx:9` 的 prop 類型：
```typescript
// 舊
poseData: any | null;
```

改為：
```typescript
import type { PoseFrame } from '../types/vrm';
...
poseData: PoseFrame | null;
```

同時將 `landmarks` 的取出：
```typescript
const landmarks = poseData?.landmarks;
```
這行不需要變動（型別推斷會自動正確）。

移除 `poseData: any | null` 這行的 `any`（使用 PoseFrame 後即正確）。

- [ ] **Step 2: 清理 useBigScreenScene.ts 的 console.log 與死碼**

**移除 console.log（lines 168-169）：**
```typescript
// 刪除這兩行
console.log('position', position);
console.log('lookAt', lookAt);
```

**移除注解掉的 camera zoom-out 區塊（lines 259-263）：**
```typescript
// 刪除 reposition() 函數中這段注解死碼
if (cameraRef.current) {
  const spread = total > 1 ? spacing * (total - 1) : 0;
  // cameraRef.current.position.set(0, 1.2, Math.max(3, spread / 2 + 3.5));
  // cameraRef.current.lookAt(0, 1, 0);
}
```
整個 `if (cameraRef.current)` 區塊都可刪除（內容全為注解）。

**移除注解掉的 backgroundImage 舊方式（lines 117-128）：**
```typescript
// 刪除這段注解
// if (preset.backgroundImage) {
//   new THREE.TextureLoader().load(preset.backgroundImage, (tex) => {
//     ...
//   });
// }
```

**修復 `any` 類型轉型（material dispose，lines 228-235）：**
```typescript
// 舊（使用 as any）
const mat = bgMesh.material as any;

// 改為
import type { MeshBasicMaterial } from 'three';
...
const mat = bgMesh.material as MeshBasicMaterial;
```

- [ ] **Step 3: 修復 BigScreen.tsx canvas 自適應尺寸**

**舊做法**（canvas 使用固定 window size，不會自適應）：
```tsx
<canvas
  ref={canvasRef}
  id="bigscreen-canvas"
  className="bigscreen-canvas"
  width={window.innerWidth}
  height={window.innerHeight}
/>
```

**新做法**（移除 width/height attribute，改由 CSS + `useBigScreenScene` 的 ResizeObserver 控制）：
```tsx
<canvas
  ref={canvasRef}
  id="bigscreen-canvas"
  className="bigscreen-canvas"
/>
```

在 `App.css` 或 `index.css` 中確認（或新增）以下規則：
```css
.bigscreen-canvas {
  width: 100%;
  height: 100%;
  display: block;
}
.bigscreen-root {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}
```

**同時修改 `useBigScreenScene.ts` 的 renderer 初始化（lines 173-174）：**

移除 HTML attribute 後，canvas 的 `width`/`height` attribute 會是瀏覽器預設值（300×150）。需改用 `clientWidth/clientHeight` 讓初始 render 正確：

```typescript
// 舊（使用 attribute 尺寸，移除 attribute 後會是 300×150）
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(canvas.width, canvas.height);

// 新（使用 CSS 尺寸）
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
```

> `false` 第三個參數表示不更新 canvas style（已由 CSS 控制）。ResizeObserver（useBigScreenScene.ts lines 195–216）會持續同步後續尺寸變化。

- [ ] **Step 4: 修復 routes.ts 的 any 類型**

將 `backend/src/routes.ts:12`：
```typescript
function notifyRoom(roomId: string, type: string, data: Record<string, any>): void {
```

改為：
```typescript
function notifyRoom(roomId: string, type: string, data: Record<string, unknown>): void {
```

同時修復第 26 行：
```typescript
// 舊
const hostId = `host-${Math.random().toString(36).substring(7)}`
// const hostId = `host`
```
刪除注解掉的 `// const hostId = 'host'` 死碼（僅 1 行）。

- [ ] **Step 5: 驗證 Frontend 編譯**

```bash
cd /c/Project/Live_MR/frontend && npx tsc --noEmit
```

Expected: 無錯誤。

- [ ] **Step 6: 驗證 Backend 測試通過**

```bash
cd /c/Project/Live_MR/backend && npx vitest run
```

Expected: 所有測試 PASS。

- [ ] **Step 7: Commit**

```bash
cd /c/Project/Live_MR
git add frontend/src/components/StudentTile.tsx \
        frontend/src/hooks/useBigScreenScene.ts \
        frontend/src/components/BigScreen.tsx \
        frontend/src/App.css \
        backend/src/routes.ts
git commit -m "fix: remove any types, dead code, debug logs; fix BigScreen canvas sizing"
```

---

## 驗收標準

完成所有 Task 後，檢查以下項目：

- [ ] `npx tsc --noEmit`（frontend）無任何錯誤
- [ ] `npx vitest run`（backend）全部通過
- [ ] 沒有任何 `any` 類型殘留（可執行 `grep -r ": any" frontend/src` 確認）
- [ ] `applyLights` 只在 `threeScene.ts` 定義一次（可執行 `grep -r "applyLights" frontend/src` 確認）
- [ ] `LIVEKIT_URL` 只在 `constants.ts` 定義一次
- [ ] `BIGSCREEN_CHANNEL_NAME` 只在 `constants.ts` 定義一次
- [ ] `usePoseDetection` 不再直接 import `Room` 或 LiveKit 相關型別
- [ ] `HostSession.tsx` 不含任何 proxy Room 物件（`as unknown as Room`）
- [ ] `HostSession.tsx` 不含 `LocalVideo` 函數定義
- [ ] `useBigScreenScene.ts` 不含 `console.log`

---

## 後續建議（本次計劃範圍外）

1. **前端測試設定**：加入 `vitest` + `jsdom` + `@testing-library/react`，為 `RoleSelect`、`StudentJoin` 等純 UI 元件補充煙霧測試。
2. **App.tsx `prompt()` 替換**：`handleStudent` 使用 `window.prompt` 輸入房間 ID，UX 不佳。可在 `RoleSelect` 元件中加入文字輸入表單。
3. **SSE token in query string**：`api.ts:76` 用 query string 傳遞 `hostToken`，安全性較低，可改用 `Authorization` header（需同步修改後端 `routes.ts`）。
4. **BigScreen canvas 初始 flash**：由於 `useBigScreenScene` 在 `canvasRef.current` 就緒後才初始化 renderer，BigScreen 開啟瞬間可能有黑幕閃爍。可加入 loading spinner。
