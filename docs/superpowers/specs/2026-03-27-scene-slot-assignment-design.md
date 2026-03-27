# Scene Slot Assignment — Design Spec

**Date:** 2026-03-27
**Status:** Approved

## Overview

Add a "role slot" system to the BigScreen that lets teachers assign participants (including themselves) to named, fixed positions within a scene. Designed for two-person dialogue scenarios (e.g., clothing-store cashier vs. customer) but extensible to any number of slots per scene.

---

## Goals

- Each scene can define named slots with fixed world positions and a suggested default VRM model.
- The teacher assigns any participant (teacher or student) to a slot via the host console.
- Only participants assigned to a slot appear on the BigScreen; unassigned participants are excluded.
- Identity (role slot) and VRM model are separate but related: each slot has a `defaultVrmId` suggestion; the teacher can override the model independently.
- Scenes without slots continue to use the existing auto-spacing layout (fully backwards-compatible).

---

## Data Model

### New type: `SceneSlot` (`types/vrm.ts`)

```ts
export interface SceneSlot {
  id: string;                                    // e.g. 'cashier', 'customer'
  label: string;                                 // display name e.g. '收銀員'
  icon?: string;                                 // optional emoji for console UI e.g. '🏪'
  position: [x: number, y: number, z: number];  // world-space position on BigScreen
  rotation?: [x: number, y: number, z: number]; // euler rotation (radians); y used to face partner
  defaultVrmId?: string;                         // suggested VRM for this slot
}
```

### Updated: `SceneConfig` (`types/vrm.ts`)

Add one optional field:

```ts
slots?: SceneSlot[];
```

Scenes without `slots` are unaffected.

### Example — clothing store scene (`config/scenes.ts`)

```ts
clothingStore: {
  id: 'clothingStore',
  label: '衣服店對話',
  // ... camera, lights, background ...
  slots: [
    {
      id: 'cashier',
      label: '收銀員',
      icon: '🏪',
      position: [1.2, 0, -1.5],
      rotation: [0, -0.3, 0],   // faces left toward customer
      defaultVrmId: 'student_female',
    },
    {
      id: 'customer',
      label: '顧客',
      icon: '🛍',
      position: [-1.2, 0, -1.5],
      rotation: [0, 0.3, 0],    // faces right toward cashier
      defaultVrmId: 'student_male',
    },
  ],
}
```

---

## State & sessionStorage

### New state in `HostSession`

```ts
// slotId → participant identity (LiveKit identity string)
const [slotAssignments, setSlotAssignments] =
  useState<Record<string, string>>(() =>
    JSON.parse(sessionStorage.getItem('bigscreen-slotAssignments') || '{}')
  );
```

### sessionStorage keys

| Key | Content |
|-----|---------|
| `bigscreen-slotAssignments` | `Record<slotId, identity>` — persisted on every change |

### Cleanup on participant disconnect

When a participant disconnects (`handleDisconnected`), remove their identity from `slotAssignments` and update sessionStorage — consistent with the existing `studentRoles` cleanup.

---

## BroadcastChannel Messages

### New message type added to `BigScreenMsg`

```ts
| { type: 'slot-assign'; slotId: string; identity: string | null }
```

`identity: null` means the slot was cleared (remove avatar from BigScreen).

---

## Teacher Console UI

### Layout

Two-column layout within HostSession:

**Left column — Slot Panel (280 px fixed)**
- Header: "🎭 場景角色 SLOTS"
- One block per slot, containing:
  - Slot icon + label + position hint (e.g. "右側")
  - "已指派 / 未指派" status badge
  - **指派給** dropdown: lists all current participants including "老師 (自己)" and "─ 移除指派"
  - **角色模型** dropdown: lists allowed VRMs for this scene, with slot's `defaultVrmId` pre-selected and marked "★"
- Footer note: "未指派者不出現在大屏"

**Right column — Participant Grid**
- Includes the teacher's own video tile (marked with "老師" badge) as the first card
- Followed by student tiles in connection order
- Each tile shows:
  - Video feed
  - Participant name
  - Current VRM model label
  - Slot badge (e.g. "🏪 收銀員") if assigned; greyed-out "未指派" otherwise
- Unassigned tiles rendered at reduced opacity

**Bottom of right column — BigScreen Mini-Preview**
- Small strip showing slot positions left/right with assigned participant names and avatars
- Empty slots shown as dashed outlines

### Assignment flow

1. Teacher selects a participant in a slot's "指派給" dropdown.
2. `setSlotAssignments` updates state + sessionStorage.
3. Slot's `defaultVrmId` is applied as the model unless the teacher has already set a custom model for that participant.
4. `channel.postMessage({ type: 'slot-assign', slotId, identity })` is sent to BigScreen.
5. BigScreen moves the avatar to the slot's fixed position.

### VRM priority (highest to lowest)

1. Teacher's manual override for this participant (`studentRoles[identity]`)
2. Slot's `defaultVrmId`
3. Scene-wide global `vrmSourceId`

---

## BigScreen / `useBigScreenScene` Changes

### New option

```ts
interface UseBigScreenSceneOptions {
  sceneId?: string;
  vrmSourceId?: string;
  slotAssignments?: Record<string, string>;  // slotId → identity
}
```

### Positioning logic

The hook builds a reverse map `identity → slot` from `slotAssignments` and the current scene's `slots[]`.

- **Assigned identity** → `ensureAvatar` uses slot's `position` and `rotation`; skips `slotX()` auto-spacing entirely.
- **Unassigned identity** → `applyPose` returns early without calling `ensureAvatar`; avatar is never loaded.

`reposition()` continues to work for scenes without slots (backwards-compatible).

### `slot-assign` message handling

BigScreen maintains its own `slotAssignmentsRef: Map<slotId, identity>` (updated on every `slot-assign` message received). This allows it to look up the previous occupant when unassigning.

```
identity != null  →  update slotAssignmentsRef; ensureAvatar(identity, slotVrmUrl) at slot position
identity == null  →  look up previous identity from slotAssignmentsRef; removeAvatar(prevIdentity); clear slotAssignmentsRef entry
```

### Scene change handling

When the teacher changes the scene (`scene-change` message), `useBigScreenScene` reinitialises the 3D scene and clears all avatars (existing behaviour). Additionally:
- `HostSession` clears `slotAssignments` state and sessionStorage `bigscreen-slotAssignments` on scene change (slots are scene-specific).
- BigScreen clears its `slotAssignmentsRef` on scene change.

### BigScreen restore on refresh

On mount, BigScreen reads:
1. `bigscreen-slotAssignments` — who is in which slot
2. `bigscreen-snapshot` — last known pose per identity
3. `bigscreen-studentRoles` — VRM overrides

Only identities present in `slotAssignments` are rendered.

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `frontend/src/types/vrm.ts` | Add `SceneSlot` interface; add `slots?` to `SceneConfig` |
| `frontend/src/config/scenes.ts` | Add `clothingStore` scene (and update `classroom` example with slots) |
| `frontend/src/components/HostSession.tsx` | Add `slotAssignments` state; new slot panel UI; teacher tile in grid; handle `handleDisconnected` cleanup |
| `frontend/src/hooks/useBigScreenScene.ts` | Accept `slotAssignments` option; slot-aware `ensureAvatar`; skip unassigned in `applyPose` |
| `frontend/src/components/BigScreen.tsx` | Pass `slotAssignments` to hook; handle `slot-assign` message; restore from sessionStorage |

---

## Out of Scope

- Teacher editing slot definitions at runtime (static config only)
- More than one participant per slot
- Overflow / audience zone for unassigned participants (deferred to future)
- Drag-and-drop assignment UI
