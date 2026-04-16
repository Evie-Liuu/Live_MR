# Prop Object Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the current task has a prop (e.g. `ask_price_1` → blue T-shirt), highlight it with an emissive pulse; a fist gesture (hand raised OR hand near prop on screen) locks the prop to the VRM hand bone; open-hand or task change returns it to its display position.

**Architecture:** Pure-function gesture detection on MediaPipe landmarks (image-space, no world-space conversion). Prop UV position projected each frame for proximity check. State machine (`displayed → held → returning`) runs inside the existing RAF loop in `useBigScreenScene.ts` after `vrm.update()`.

**Tech Stack:** Three.js 0.183, `@pixiv/three-vrm` 3.x, MediaPipe HandLandmarker (already wired), TypeScript strict.

---

## Mirror Convention (Critical — Read Before Any Task)

The scene uses a visual mirror flip. Mapping from `PoseFrame` field → VRM bone:

| `PoseFrame` field | Person's hand | VRM humanoid bone |
|---|---|---|
| `rightHandLandmarks` | person's right | `leftHand` |
| `leftHandLandmarks` | person's left | `rightHand` |

`lockHand: 'right'` means person used their right hand → attach to VRM `leftHand` bone.  
`lockHand: 'left'` means person used their left hand → attach to VRM `rightHand` bone.  
This matches the convention in `vrmPoseApplier.ts` (`RIGHT_HAND_BONE_MAP.Wrist = 'leftHand'`).

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `frontend/src/utils/gestureDetector.ts` | Pure functions: detectFist, detectOpenHand, isHandRaised, isHandNearProp |
| Create | `frontend/src/utils/propInteraction.ts` | Three.js helpers: highlightProp, projectToUV, attachPropToHand, returnPropToDisplay |
| Modify | `frontend/src/hooks/useBigScreenScene.ts` | AvatarSlot interaction fields, heldByIdentity ref, RAF state machine |

---

## Task 1: Create `gestureDetector.ts`

**Files:**
- Create: `frontend/src/utils/gestureDetector.ts`

- [ ] **Step 1: Create the file**

```typescript
// frontend/src/utils/gestureDetector.ts
import type { PoseLandmark } from '../types/vrm';

/**
 * Returns true if the hand is in a fist: at least 3 of 4 fingers curled.
 * Expects 21-point MediaPipe HandLandmarker landmarks (image space, y↓).
 * Fingertip curled = tip.y > mcp.y (tip is lower than knuckle in image).
 */
export function detectFist(landmarks: PoseLandmark[]): boolean {
  if (landmarks.length < 21) return false;
  const fingers = [
    { tip: 8,  mcp: 5  }, // index
    { tip: 12, mcp: 9  }, // middle
    { tip: 16, mcp: 13 }, // ring
    { tip: 20, mcp: 17 }, // pinky
  ];
  const curled = fingers.filter(f => landmarks[f.tip].y > landmarks[f.mcp].y).length;
  return curled >= 3;
}

/**
 * Returns true if the hand is open: at least 3 of 4 fingers extended.
 * Finger extended = tip.y < mcp.y.
 */
export function detectOpenHand(landmarks: PoseLandmark[]): boolean {
  if (landmarks.length < 21) return false;
  const fingers = [
    { tip: 8,  mcp: 5  },
    { tip: 12, mcp: 9  },
    { tip: 16, mcp: 13 },
    { tip: 20, mcp: 17 },
  ];
  const extended = fingers.filter(f => landmarks[f.tip].y < landmarks[f.mcp].y).length;
  return extended >= 3;
}

/**
 * Returns true if the hand wrist is above the hip (image-space, y↓).
 * Uses 33-point PoseLandmarker landmarks.
 *   right: wrist=pose[16], hip=pose[24]
 *   left:  wrist=pose[15], hip=pose[23]
 */
export function isHandRaised(
  poseLandmarks: PoseLandmark[],
  hand: 'left' | 'right',
): boolean {
  if (poseLandmarks.length < 25) return false;
  const wristIdx = hand === 'right' ? 16 : 15;
  const hipIdx   = hand === 'right' ? 24 : 23;
  return poseLandmarks[wristIdx].y < poseLandmarks[hipIdx].y;
}

/**
 * Returns true if the wrist UV is within `threshold` distance of the prop UV.
 * Both coordinates are normalised [0,1] screen/image space.
 */
export function isHandNearProp(
  wristUV: { x: number; y: number },
  propUV:  { x: number; y: number },
  threshold = 0.15,
): boolean {
  const dx = wristUV.x - propUV.x;
  const dy = wristUV.y - propUV.y;
  return Math.sqrt(dx * dx + dy * dy) <= threshold;
}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/utils/gestureDetector.ts
git commit -m "feat: add gestureDetector pure functions (fist/openHand/raised/near)"
```

---

## Task 2: Create `propInteraction.ts`

**Files:**
- Create: `frontend/src/utils/propInteraction.ts`

- [ ] **Step 1: Create the file**

```typescript
// frontend/src/utils/propInteraction.ts
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

// Module-scope reusable vectors — avoids per-frame allocation.
const _bonePos = new THREE.Vector3();
const _offsetVec = new THREE.Vector3();

/**
 * Toggle emissive pulsing highlight on all MeshStandardMaterial meshes in a GLB group.
 * Call every RAF frame with current elapsed time (seconds) when enabled.
 *
 * MeshPhysicalMaterial extends MeshStandardMaterial, so isMeshStandardMaterial
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
    }
  });
}

/**
 * Project a world-space position to normalised UV screen space [0,1].
 * x=0 is left, y=0 is top (matches MediaPipe landmark convention).
 */
export function projectToUV(
  worldPos: THREE.Vector3,
  camera: THREE.Camera,
): { x: number; y: number } {
  _bonePos.copy(worldPos).project(camera);
  return {
    x: (_bonePos.x + 1) / 2,
    y: (1 - _bonePos.y) / 2,
  };
}

/**
 * Move a prop group toward the VRM hand bone world position each frame (lerp 0.3).
 *
 * Mirror convention (matches vrmPoseApplier.ts):
 *   person 'right' hand → VRM 'leftHand' bone
 *   person 'left'  hand → VRM 'rightHand' bone
 *
 * `offset` shifts the prop from the bone origin (default: slightly in front of palm).
 */
export function attachPropToHand(
  group: THREE.Group,
  vrm: VRM,
  hand: 'left' | 'right',
  offset: [number, number, number] = [0, 0.1, 0.05],
): void {
  // Mirror: person's right → VRM leftHand; person's left → VRM rightHand
  const boneName = hand === 'right' ? 'leftHand' : 'rightHand';
  const boneNode = vrm.humanoid.getNormalizedBoneNode(boneName);
  if (!boneNode) return;
  boneNode.getWorldPosition(_bonePos);
  _offsetVec.set(...offset);
  _bonePos.add(_offsetVec);
  group.position.lerp(_bonePos, 0.3);
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
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/utils/propInteraction.ts
git commit -m "feat: add propInteraction helpers (highlight/projectToUV/attachToHand/return)"
```

---

## Task 3: Extend `AvatarSlot` and add hook-level refs

**Files:**
- Modify: `frontend/src/hooks/useBigScreenScene.ts` (lines 38–52 interface block + useRef declarations)

- [ ] **Step 1: Extend the `AvatarSlot` interface**

Find the existing `AvatarSlot` interface (around line 38). Add the `interaction` field at the end:

```typescript
interface AvatarSlot {
  vrm: VRM;
  baseX: number;
  poseState: PoseApplyState;
  initialHipsPos: THREE.Vector3;
  pendingPose: import('../types/vrm').PoseFrame | null;
  lastFrame: import('../types/vrm').PoseFrame | null;
  lastPoseAt: number;
  avgPoseIntervalMs: number;
  /** Object interaction state machine */
  interaction: {
    propState: 'displayed' | 'held' | 'returning';
    lockHand: 'left' | 'right' | null;
    /** Last task ID seen — detects task changes */
    lastTaskId: string | undefined;
    /** performance.now() when hand landmarks were last seen (grace period) */
    handLostAt: number;
  };
}
```

- [ ] **Step 2: Add module-level reusable Vector3 for returning state**

After the `BASE_LERP_SPEED` / `BASE_INTERVAL_MS` constants (around line 55), add:

```typescript
/** Reusable Vector3 for prop returning target — avoids per-frame allocation */
const _displayPosVec = new THREE.Vector3();
```

- [ ] **Step 3: Add `elapsedRef` and `heldByIdentityRef` inside the hook**

After the `presetRef` declaration (around line 109), add:

```typescript
/** Accumulated elapsed time (seconds) — drives emissive pulse sin() */
const elapsedRef = useRef(0);
/** taskId → identity currently holding it. Prevents two slots grabbing the same prop. */
const heldByIdentityRef = useRef<Map<string, string>>(new Map());
```

- [ ] **Step 4: Initialise `interaction` when creating an `AvatarSlot`**

In `ensureAvatar`'s `.then()` block, find where the `slot: AvatarSlot` object literal is built (around line 338). Add the `interaction` field:

```typescript
const slot: AvatarSlot = {
  vrm,
  baseX: spawn?.position?.[0] ?? 0,
  poseState: createPoseApplyState(),
  initialHipsPos,
  pendingPose: null,
  lastFrame: null,
  lastPoseAt: 0,
  avgPoseIntervalMs: BASE_INTERVAL_MS,
  interaction: {
    propState: 'displayed',
    lockHand: null,
    lastTaskId: undefined,
    handLostAt: 0,
  },
};
```

- [ ] **Step 5: Clear `heldByIdentityRef` on scene teardown**

In the `useEffect` cleanup return (around line 232), after `taskPropPoolRef` dispose, add:

```typescript
heldByIdentityRef.current.clear();
```

- [ ] **Step 6: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/useBigScreenScene.ts
git commit -m "feat: extend AvatarSlot with interaction state fields"
```

---

## Task 4: Integrate state machine into the RAF loop

**Files:**
- Modify: `frontend/src/hooks/useBigScreenScene.ts` (animate function + imports)

- [ ] **Step 1: Add imports at the top of `useBigScreenScene.ts`**

After the existing imports, add:

```typescript
import {
  highlightProp,
  projectToUV,
  attachPropToHand,
  returnPropToDisplay,
} from '../utils/propInteraction';
import {
  detectFist,
  detectOpenHand,
  isHandRaised,
  isHandNearProp,
} from '../utils/gestureDetector';
```

- [ ] **Step 2: Accumulate elapsed time in the animate function**

Find the `animate` function. After `timerRef.current.update(timestamp)` and `const delta = timerRef.current.getDelta()`, add:

```typescript
elapsedRef.current += delta;
```

- [ ] **Step 3: Change the RAF loop to iterate with identity key**

Find:
```typescript
for (const slot of avatarsRef.current.values()) {
```

Replace with:
```typescript
for (const [identity, slot] of avatarsRef.current.entries()) {
```

- [ ] **Step 4: Insert the full interaction state machine after `slot.vrm.update(delta)`**

Find the line `slot.vrm.update(delta);` inside the RAF loop. Immediately after it, add the following block:

```typescript
// ── Prop interaction state machine ────────────────────────────────────
{
  const taskId = currentTaskIdRef.current;
  const prop   = taskId ? taskPropPoolRef.current.get(taskId) : undefined;
  const ia     = slot.interaction;

  // ── Task change detection ──────────────────────────────────────────
  if (ia.lastTaskId !== taskId) {
    // Release any held/returning state for the OLD task prop
    if (ia.lastTaskId) {
      const oldProp = taskPropPoolRef.current.get(ia.lastTaskId);
      if (oldProp) highlightProp(oldProp, false);
      if (heldByIdentityRef.current.get(ia.lastTaskId) === identity) {
        heldByIdentityRef.current.delete(ia.lastTaskId);
      }
    }
    ia.propState = 'displayed';
    ia.lockHand  = null;
    ia.handLostAt = 0;
    ia.lastTaskId = taskId;
  }

  if (!prop) continue; // no prop for this task — skip

  // ── Hand landmarks from last known frame ───────────────────────────
  const frame      = slot.lastFrame;
  const rightHand  = frame?.rightHandLandmarks;
  const leftHand   = frame?.leftHandLandmarks;
  const pose       = frame?.landmarks;

  // ── displayed: highlight + grab detection ─────────────────────────
  if (ia.propState === 'displayed') {
    highlightProp(prop, true, elapsedRef.current);

    if (cameraRef.current) {
      const propUV = projectToUV(prop.position, cameraRef.current);

      for (const hand of ['right', 'left'] as const) {
        const hLandmarks = hand === 'right' ? rightHand : leftHand;
        if (!hLandmarks || hLandmarks.length < 21) continue;
        if (!pose || pose.length < 25) continue;
        // Prevent a second slot from grabbing a prop already held
        if (heldByIdentityRef.current.has(taskId)) continue;

        const wristUV = { x: hLandmarks[0].x, y: hLandmarks[0].y };
        const fist    = detectFist(hLandmarks);
        const raised  = isHandRaised(pose, hand);
        const near    = isHandNearProp(wristUV, propUV);

        if (fist && (raised || near)) {
          ia.propState  = 'held';
          ia.lockHand   = hand;
          ia.handLostAt = 0;
          heldByIdentityRef.current.set(taskId, identity);
          highlightProp(prop, false);
          break;
        }
      }
    }

  // ── held: follow hand bone, detect release ─────────────────────────
  } else if (ia.propState === 'held' && ia.lockHand) {
    attachPropToHand(prop, slot.vrm, ia.lockHand);

    const hLandmarks = ia.lockHand === 'right' ? rightHand : leftHand;

    if (!hLandmarks || hLandmarks.length < 21) {
      // Grace period: 500 ms before forcing a release on landmark loss
      const now = performance.now();
      if (ia.handLostAt === 0) ia.handLostAt = now;
      if (now - ia.handLostAt > 500) {
        heldByIdentityRef.current.delete(taskId);
        ia.propState  = 'returning';
        ia.lockHand   = null;
      }
    } else {
      ia.handLostAt = 0;
      if (detectOpenHand(hLandmarks)) {
        heldByIdentityRef.current.delete(taskId);
        ia.propState = 'returning';
        ia.lockHand  = null;
      }
    }

  // ── returning: lerp back to displayPos ────────────────────────────
  } else if (ia.propState === 'returning') {
    const dpCfg = presetRef.current.propSystem?.taskProps?.[taskId]?.displayPos;
    if (dpCfg) {
      _displayPosVec.set(...dpCfg);
      const arrived = returnPropToDisplay(prop, _displayPosVec, delta);
      if (arrived) {
        ia.propState = 'displayed';
      }
    } else {
      // No displayPos in config — snap back to identity and consider arrived
      ia.propState = 'displayed';
    }
  }
}
// ── End prop interaction ───────────────────────────────────────────────
```

- [ ] **Step 5: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useBigScreenScene.ts
git commit -m "feat: integrate prop interaction state machine into RAF loop"
```

---

## Task 5: Manual Browser Verification

**Pre-condition:** Scene `clothingStore_cashier` loaded, task `ask_price_1` (blue T-shirt) or `ask_price_2` (black jacket) active, VRM avatar visible near the rack.

- [ ] **Step 1: Start dev server**

```bash
cd frontend && npm run dev
```

- [ ] **Step 2: Open BigScreen and verify highlight**

Navigate to `/?screen=bigscreen`.  
Set the active task to `ask_price_1`.  
**Expected:** The blue T-shirt GLB on the rack pulses with a warm yellow emissive glow. No other props glow.

- [ ] **Step 3: Trigger grab with raised fist**

Raise your right hand above your hip and close your fist.  
**Expected:** The T-shirt prop detaches from the rack and follows your VRM avatar's left hand bone (mirror). Glow stops while held.

- [ ] **Step 4: Release with open hand**

Open your fist (extend fingers).  
**Expected:** Prop lerps smoothly back to `displayPos: [-3.5, 2.22, -3]` and resumes pulsing.

- [ ] **Step 5: Trigger grab by reaching toward rack**

Move hand toward the rack (screen-space proximity ≤ 0.15 UV), close fist.  
**Expected:** Same grab behaviour as Step 3.

- [ ] **Step 6: Verify task switch releases prop**

While holding the prop, switch active task to `ask_price_2` (black jacket).  
**Expected:** T-shirt returns to its display position; black jacket prop starts pulsing.

- [ ] **Step 7: Verify no prop when task has no config entry**

Switch task to `ask_price_3` (no taskProps entry in config).  
**Expected:** No prop visible, no highlight, no interaction.

- [ ] **Step 8: Final commit if adjustments were needed**

```bash
git add -p  # stage only intentional adjustments
git commit -m "fix: adjust prop interaction thresholds/offsets from manual test"
```
