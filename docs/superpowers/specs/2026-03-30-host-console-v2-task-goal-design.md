# Host Console v2 + Scene Task Goal Selection

**Date:** 2026-03-30
**Branch:** feature/scene-slot-assignment
**Approach:** Method B — render restructure within HostSession.tsx, no new component files

---

## Overview

Two coordinated changes:

1. **Console layout v2** — align `HostSession.tsx` render structure and CSS with the approved `test/console-detail-v2.html` mockup.
2. **Scene task goal selection** — each scene defines a fixed task list; the host selects a task in the console; the BigScreen displays it as a fixed top-right overlay card.

---

## Data Layer

### `vrm.ts` — `SceneConfig`
Add optional field:
```ts
tasks?: string[];
```
Array of task strings for this scene. If absent or empty, the task selector is hidden.

### `scenes.ts` — `clothingStore`
Add:
```ts
tasks: [
  'Ask for a Price',
  'Ask about Sizes',
  'Make a Complaint',
  'Ask for a Recommendation',
],
```

### `BigScreen.tsx` — `BigScreenMsg`
Add union member:
```ts
| { type: 'task-change'; task: string | null }
```

### `sessionStorage`
New key: `bigscreen-task` (string or absent). Written by HostSession on task change, read by BigScreen on open.

---

## HostSession.tsx Changes

### State
```ts
const [selectedTask, setSelectedTask] = useState<string | null>(
  () => sessionStorage.getItem('bigscreen-task') ?? null,
);
```
Reset `selectedTask` to `null` when scene changes (inside `handleSceneChange`).

### Broadcast helper
```ts
const broadcastTaskChange = useCallback((task: string | null) => {
  if (task) sessionStorage.setItem('bigscreen-task', task);
  else sessionStorage.removeItem('bigscreen-task');
  channelRef.current?.postMessage({ type: 'task-change', task });
}, []);
```
Also write to `sessionStorage` inside `openBigScreen`.

### Header Bar
Keep: title · room badge · student count · scene select · face toggle · open bigscreen button.
Remove: teacher VRM select (moved to teacher card in participant grid).

### Left Column — Slot Panel
- Each slot block gets a colored left border (slot index 0 → `#44aaff`, index 1 → `#ff8844`, further slots cycle or use accent).
- Add position hint line under slot label: e.g. `位置：右側 (x=1.2)`.
- Assigned/unassigned badge uses green/gray distinction.

### Right Column — three stacked sections

#### 1. Task Goal Selector (new)
- Shown only when `currentScenePreset.tasks` is non-empty.
- Section header: `🎯 場景任務目標`
- Rendered as pill buttons (one per task + a `✕ 無任務` clear button).
- Selected pill is highlighted (`background: var(--accent-light)`).
- On click: call `broadcastTaskChange(task)` and `setSelectedTask(task)`.
- Clear button: `broadcastTaskChange(null)`.

#### 2. Participant Grid
- Teacher card is always shown first (uses `connectedRoom?.localParticipant.identity`).
- Teacher card has a `老師` tab label (top-left tab, distinct background).
- Teacher card includes the VRM selector (replaces header bar's teacher VRM select).
- Student cards unchanged except slot badge logic (existing).
- Unassigned students dimmed to 0.5 opacity when scene has slots.

#### 3. BigScreen Preview
No changes — keep existing mini preview markup.

---

## BigScreen.tsx Changes

### State
```ts
const [currentTask, setCurrentTask] = useState<string | null>(
  () => sessionStorage.getItem('bigscreen-task') ?? null,
);
```

### BroadcastChannel handler
```ts
case 'task-change':
  setCurrentTask(msg.task);
  break;
```

### Task overlay render
Rendered when `currentTask` is not null:
```tsx
{currentTask && (
  <div className="bigscreen-task-overlay">
    <div className="bigscreen-task-label">🎯 任務目標</div>
    <div className="bigscreen-task-text">{currentTask}</div>
  </div>
)}
```

CSS:
```css
.bigscreen-task-overlay {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 2;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  padding: 8px 18px;
  pointer-events: none;
  text-align: right;
}
.bigscreen-task-label {
  color: rgba(255, 255, 255, 0.55);
  font-size: 11px;
  margin-bottom: 2px;
}
.bigscreen-task-text {
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.3px;
}
```

---

## CSS Changes (App.css)

### Slot panel additions
```css
.slot-block { border-left: 3px solid var(--slot-color, #44aaff); }
.slot-block-position-hint { color: #445; font-size: 10px; }
.slot-status.assigned { background: #1a2e1a; color: #7f7; }
.slot-status.unassigned { background: #1a1a1a; color: #555; }
```

### Task selector
```css
.task-selector { ... }         /* section wrapper */
.task-pill { ... }             /* individual pill button */
.task-pill.active { ... }      /* selected state */
.task-pill-clear { ... }       /* ✕ clear button */
```

### Teacher card
```css
.teacher-card-tab { ... }      /* 老師 label tab at top-left */
```

---

## Files to Change

| File | Change |
|------|--------|
| `frontend/src/types/vrm.ts` | Add `tasks?: string[]` to `SceneConfig` |
| `frontend/src/config/scenes.ts` | Add `tasks` to `clothingStore` |
| `frontend/src/components/BigScreen.tsx` | Add `task-change` msg type + state + overlay render |
| `frontend/src/components/HostSession.tsx` | Restructure render: header cleanup, slot colors, task selector, teacher card with VRM |
| `frontend/src/App.css` | Add slot/task/teacher-card CSS classes |

---

## Out of Scope

- BigScreen preview section in HostSession — no changes
- `useBigScreenScene.ts` — no changes
- Multi-scene task management (only clothingStore gets tasks for now)
- Task display animation / entrance effect on BigScreen
