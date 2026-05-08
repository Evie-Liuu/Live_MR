# Host Console v2 + Scene Task Goal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the host console to match the v2 mockup layout and add a per-scene task goal selector that broadcasts to a BigScreen top-right overlay card.

**Architecture:** Four coordinated changes — data types, BigScreen overlay, HostSession state helpers, HostSession render + CSS. Each task is independently type-checkable. No new files; all changes are within existing files.

**Tech Stack:** React 19, TypeScript 5.9, Vite, BroadcastChannel API, CSS custom properties

---

## File Map

| File | What changes |
|------|--------------|
| `frontend/src/types/vrm.ts` | Add `tasks?: string[]` to `SceneConfig` |
| `frontend/src/config/scenes.ts` | Add `tasks` array to `clothingStore` |
| `frontend/src/components/BigScreen.tsx` | Add `task-change` to `BigScreenMsg`, `currentTask` state, overlay render |
| `frontend/src/components/HostSession.tsx` | `selectedTask` state, `broadcastTaskChange`, header cleanup, slot colors, task pills, teacher card |
| `frontend/src/App.css` | Add all missing slot/task/teacher-card/layout CSS classes |

---

### Task 1: Data layer — add `tasks` to `SceneConfig` and `clothingStore`

**Files:**
- Modify: `frontend/src/types/vrm.ts`
- Modify: `frontend/src/config/scenes.ts`

- [ ] **Step 1: Add `tasks` field to `SceneConfig` in `vrm.ts`**

  In `frontend/src/types/vrm.ts`, inside the `SceneConfig` interface (after the `slots?` line), add:

  ```ts
  /** Optional list of task goal strings for this scene. Host picks one; BigScreen shows it. */
  tasks?: string[];
  ```

- [ ] **Step 2: Add tasks to `clothingStore` in `scenes.ts`**

  In `frontend/src/config/scenes.ts`, inside the `clothingStore` object (after the `slots` array closing bracket), add:

  ```ts
  tasks: [
    'Ask for a Price',
    'Ask about Sizes',
    'Make a Complaint',
    'Ask for a Recommendation',
  ],
  ```

- [ ] **Step 3: Type-check**

  ```bash
  cd frontend && npx tsc -b --noEmit
  ```
  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/src/types/vrm.ts frontend/src/config/scenes.ts
  git commit -m "feat: add tasks field to SceneConfig and clothingStore"
  ```

---

### Task 2: BigScreen — task-change message + overlay card

**Files:**
- Modify: `frontend/src/components/BigScreen.tsx`
- Modify: `frontend/src/App.css`

- [ ] **Step 1: Add `task-change` to `BigScreenMsg` type**

  In `BigScreen.tsx`, update the `BigScreenMsg` interface:

  Replace:
  ```ts
  export interface BigScreenMsg {
    type: 'pose' | 'leave' | 'scene-change' | 'vrm-change' | 'vrm-identity-change' | 'slot-assign';
    identity?: string;
    poseData?: unknown;
    /** For 'scene-change': new scene preset ID */
    sceneId?: string;
    /** For 'vrm-change': new VRM source ID (global fallback for new avatars) */
    vrmSourceId?: string;
    /** For 'vrm-identity-change': swap the VRM for a specific participant */
    vrmUrl?: string;
    /** For 'slot-assign': which slot to assign/clear */
    slotId?: string;
  }
  ```

  With:
  ```ts
  export interface BigScreenMsg {
    type: 'pose' | 'leave' | 'scene-change' | 'vrm-change' | 'vrm-identity-change' | 'slot-assign' | 'task-change';
    identity?: string;
    poseData?: unknown;
    /** For 'scene-change': new scene preset ID */
    sceneId?: string;
    /** For 'vrm-change': new VRM source ID (global fallback for new avatars) */
    vrmSourceId?: string;
    /** For 'vrm-identity-change': swap the VRM for a specific participant */
    vrmUrl?: string;
    /** For 'slot-assign': which slot to assign/clear */
    slotId?: string;
    /** For 'task-change': task string, or null to clear */
    task?: string | null;
  }
  ```

- [ ] **Step 2: Add `currentTask` state to `BigScreen`**

  In `BigScreen.tsx`, inside the `BigScreen` function body, after the `slotAssignmentsRef` declaration (around line 103), add:

  ```ts
  const [currentTask, setCurrentTask] = useState<string | null>(
    () => sessionStorage.getItem('bigscreen-task') ?? null,
  );
  ```

- [ ] **Step 3: Handle `task-change` in the BroadcastChannel handler**

  In `BigScreen.tsx`, inside the `channel.onmessage` handler, after the last `else if` block (after the `vrm-identity-change` handler, before the closing `}`), add:

  ```ts
  } else if (msg.type === 'task-change') {
    setCurrentTask(msg.task ?? null);
  }
  ```

- [ ] **Step 4: Render the task overlay card**

  In `BigScreen.tsx`, inside the `return` JSX, after the `bigscreen-overlay` div (the title bar), add:

  ```tsx
  {currentTask && (
    <div className="bigscreen-task-overlay">
      <div className="bigscreen-task-label">🎯 任務目標</div>
      <div className="bigscreen-task-text">{currentTask}</div>
    </div>
  )}
  ```

- [ ] **Step 5: Add task overlay CSS to `App.css`**

  At the end of `frontend/src/App.css`, append:

  ```css
  /* ===== BigScreen – Task Goal Overlay ===== */
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

- [ ] **Step 6: Type-check**

  ```bash
  cd frontend && npx tsc -b --noEmit
  ```
  Expected: no errors.

- [ ] **Step 7: Commit**

  ```bash
  git add frontend/src/components/BigScreen.tsx frontend/src/App.css
  git commit -m "feat: BigScreen task-change message and top-right task overlay"
  ```

---

### Task 3: HostSession — selectedTask state and broadcast helpers

**Files:**
- Modify: `frontend/src/components/HostSession.tsx`

- [ ] **Step 1: Add `selectedTask` state**

  In `HostSession.tsx`, after the `slotAssignments` state declaration (around line 80), add:

  ```ts
  // Selected scene task goal
  const [selectedTask, setSelectedTask] = useState<string | null>(
    () => sessionStorage.getItem('bigscreen-task') ?? null,
  );
  ```

- [ ] **Step 2: Add `broadcastTaskChange` callback**

  In `HostSession.tsx`, after the `broadcastSceneChange` callback (around line 87), add:

  ```ts
  const broadcastTaskChange = useCallback((task: string | null) => {
    if (task) sessionStorage.setItem('bigscreen-task', task);
    else sessionStorage.removeItem('bigscreen-task');
    const msg: BigScreenMsg = { type: 'task-change', task };
    channelRef.current?.postMessage(msg);
  }, []);
  ```

- [ ] **Step 3: Reset task on scene change**

  In `HostSession.tsx`, inside `handleSceneChange`, after the line `setSlotAssignments({})` (around line 112), add:

  ```ts
  // Clear task goal — it is scene-specific
  setSelectedTask(null);
  sessionStorage.removeItem('bigscreen-task');
  const taskClearMsg: BigScreenMsg = { type: 'task-change', task: null };
  channelRef.current?.postMessage(taskClearMsg);
  ```

- [ ] **Step 4: Write task to sessionStorage in `openBigScreen`**

  In `HostSession.tsx`, inside the `openBigScreen` callback, inside the `try` block (after `sessionStorage.setItem('bigscreen-slotAssignments', ...)`), add:

  ```ts
  if (selectedTask) sessionStorage.setItem('bigscreen-task', selectedTask);
  else sessionStorage.removeItem('bigscreen-task');
  ```

  Also add `selectedTask` to the `useCallback` dependency array of `openBigScreen`:
  Change: `[selectedSceneId, selectedVrmSourceId, teacherVrmSourceId, slotAssignments]`
  To: `[selectedSceneId, selectedVrmSourceId, teacherVrmSourceId, slotAssignments, selectedTask]`

- [ ] **Step 5: Type-check**

  ```bash
  cd frontend && npx tsc -b --noEmit
  ```
  Expected: no errors.

- [ ] **Step 6: Commit**

  ```bash
  git add frontend/src/components/HostSession.tsx
  git commit -m "feat: HostSession selectedTask state and broadcastTaskChange helper"
  ```

---

### Task 4: HostSession render restructure + all CSS

**Files:**
- Modify: `frontend/src/components/HostSession.tsx`
- Modify: `frontend/src/App.css`

This task restructures the entire render section of `HostSession` and adds all missing CSS.

#### 4A — Define slot color constant

- [ ] **Step 1: Add `SLOT_COLORS` constant**

  In `HostSession.tsx`, just before the `return` statement (after the `hasSlots` derived value), add:

  ```ts
  const SLOT_COLORS = ['#44aaff', '#ff8844', '#aa88ff', '#44ff88'];
  ```

#### 4B — Header bar: remove teacher VRM selector

- [ ] **Step 2: Remove the teacher VRM label + select from the header**

  In `HostSession.tsx`, find and remove these two elements from the `session-header` div (they will reappear in the teacher card in 4E):

  ```tsx
  {/* ── 角色模型選擇器（老師本人） ── */}
  <label htmlFor="vrm-teacher-select" className="control-label">🎓 老師角色：</label>
  <select
    id="vrm-teacher-select"
    className="control-select"
    value={teacherVrmSourceId}
    onChange={(e) => handleTeacherVrmChange(e.target.value)}
  >
    {allowedVrms.map((s) => (
      <option key={s.id} value={s.id}>
        {s.label}
      </option>
    ))}
  </select>
  ```

#### 4C — Slot panel: colored borders and position hints

- [ ] **Step 3: Update slot panel mapping to pass slot index and apply color**

  In `HostSession.tsx`, find the `currentScenePreset.slots!.map((sceneSlot) => {` line and change it to:

  ```tsx
  {currentScenePreset.slots!.map((sceneSlot, slotIndex) => {
  ```

  Then find the outer `<div key={sceneSlot.id} className="slot-block">` and change it to:

  ```tsx
  <div
    key={sceneSlot.id}
    className="slot-block"
    style={{ '--slot-color': SLOT_COLORS[slotIndex % SLOT_COLORS.length] } as React.CSSProperties}
  >
  ```

- [ ] **Step 4: Add position hint and update slot title structure**

  Find the `slot-block-title` div:

  ```tsx
  <div className="slot-block-title">
    {sceneSlot.icon && <span>{sceneSlot.icon}</span>}
    <span>{sceneSlot.label}</span>
    <span className={`slot-status ${assignedIdentity ? 'assigned' : 'unassigned'}`}>
      {assignedIdentity ? '已指派' : '未指派'}
    </span>
  </div>
  ```

  Replace with:

  ```tsx
  <div className="slot-block-title">
    {sceneSlot.icon && <span style={{ fontSize: '18px' }}>{sceneSlot.icon}</span>}
    <div>
      <div style={{ color: SLOT_COLORS[slotIndex % SLOT_COLORS.length], fontSize: '12px', fontWeight: 700 }}>
        {sceneSlot.label}
      </div>
      <div className="slot-block-position-hint">
        位置：{sceneSlot.position[0] >= 0 ? '右側' : '左側'} (x={sceneSlot.position[0]})
      </div>
    </div>
    <span className={`slot-status ${assignedIdentity ? 'assigned' : 'unassigned'}`}>
      {assignedIdentity ? '● 已指派' : '未指派'}
    </span>
  </div>
  ```

#### 4D — Right column: wrap in `host-right-col` and add task selector

- [ ] **Step 5: Replace the entire outer layout block**

  In `HostSession.tsx`, find the entire block starting with `<div className={hasSlots ? 'host-main-two-col' : undefined}>` and ending with its closing `</div>` (the last line before the closing `</div>` of `host-session`).

  Replace the entire block with:

  ```tsx
  <div className={hasSlots ? 'host-main-two-col' : undefined}>
    {/* ── Slot Panel (only shown when scene has slots) ── */}
    {hasSlots && (
      <div className="slot-panel">
        <div className="slot-panel-header">🎭 場景角色 SLOTS</div>
        {currentScenePreset.slots!.map((sceneSlot, slotIndex) => {
          const assignedIdentity = slotAssignments[sceneSlot.id];
          const assignedVrmId = assignedIdentity
            ? (studentRoles[assignedIdentity] ?? sceneSlot.defaultVrmId ?? selectedVrmSourceId)
            : (sceneSlot.defaultVrmId ?? selectedVrmSourceId);
          return (
            <div
              key={sceneSlot.id}
              className="slot-block"
              style={{ '--slot-color': SLOT_COLORS[slotIndex % SLOT_COLORS.length] } as React.CSSProperties}
            >
              <div className="slot-block-title">
                {sceneSlot.icon && <span style={{ fontSize: '18px' }}>{sceneSlot.icon}</span>}
                <div>
                  <div style={{ color: SLOT_COLORS[slotIndex % SLOT_COLORS.length], fontSize: '12px', fontWeight: 700 }}>
                    {sceneSlot.label}
                  </div>
                  <div className="slot-block-position-hint">
                    位置：{sceneSlot.position[0] >= 0 ? '右側' : '左側'} (x={sceneSlot.position[0]})
                  </div>
                </div>
                <span className={`slot-status ${assignedIdentity ? 'assigned' : 'unassigned'}`}>
                  {assignedIdentity ? '● 已指派' : '未指派'}
                </span>
              </div>
              <label className="slot-field-label">指派給</label>
              <select
                className="control-select slot-select"
                value={assignedIdentity ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  handleSlotAssign(sceneSlot.id, val === '' ? null : val);
                }}
              >
                <option value="">─ 移除指派</option>
                {allParticipantOptions.map(opt => (
                  <option key={opt.identity} value={opt.identity}>{opt.label}</option>
                ))}
              </select>
              <label className="slot-field-label">角色模型</label>
              <select
                className="control-select slot-select"
                value={assignedVrmId}
                disabled={!assignedIdentity}
                onChange={(e) => {
                  if (assignedIdentity) handleStudentRoleChange(assignedIdentity, e.target.value);
                }}
              >
                {allowedVrms.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id === sceneSlot.defaultVrmId ? `★ ${s.label}` : s.label}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
        <div className="slot-panel-footer">未指派者不出現在大屏</div>
      </div>
    )}

    {/* ── Right Column (task selector + participant grid) ── */}
    <div className="host-right-col">
      {currentScenePreset.tasks && currentScenePreset.tasks.length > 0 && (
        <div className="task-selector">
          <div className="task-selector-header">🎯 場景任務目標</div>
          <div className="task-pills">
            {currentScenePreset.tasks.map((task) => (
              <button
                key={task}
                className={`task-pill${selectedTask === task ? ' active' : ''}`}
                onClick={() => { setSelectedTask(task); broadcastTaskChange(task); }}
              >
                {task}
              </button>
            ))}
            {selectedTask && (
              <button
                className="task-pill-clear"
                onClick={() => { setSelectedTask(null); broadcastTaskChange(null); }}
              >
                ✕ 無任務
              </button>
            )}
          </div>
        </div>
      )}

      <div className="student-grid">
        {/* teacher card and student tiles go here — added in Step 7 */}
      </div>
    </div>
  </div>
  ```

#### 4E — Teacher card in participant grid

- [ ] **Step 6: Fill `student-grid` with teacher card + student tiles**

  Replace the placeholder comment `{/* teacher card and student tiles go here — added in Step 7 */}` inside `student-grid` with:

  ```tsx
  {/* ── Teacher card ── */}
  {connectedRoom && (() => {
    const teacherIdentityLocal = connectedRoom.localParticipant.identity;
    const teacherSlotId = identityToSlotId[teacherIdentityLocal];
    const teacherSlot = teacherSlotId
      ? currentScenePreset.slots?.find((s) => s.id === teacherSlotId)
      : undefined;
    return (
      <div
        className="student-container teacher-card"
        style={{ position: 'relative', opacity: hasSlots && !teacherSlot ? 0.5 : 1 }}
      >
        <div className="teacher-card-tab">老師</div>
        {teacherSlot && (
          <div style={{ position: 'absolute', top: '6px', right: '6px', background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: '11px', padding: '2px 5px', borderRadius: '4px' }}>
            {teacherSlot.icon} {teacherSlot.label}
          </div>
        )}
        {!teacherSlot && hasSlots && (
          <div style={{ position: 'absolute', top: '6px', right: '6px', background: 'rgba(0,0,0,0.5)', color: '#aaa', fontSize: '11px', padding: '2px 5px', borderRadius: '4px' }}>
            未指派
          </div>
        )}
        <div className="teacher-card-video">📹 自身影像</div>
        <div className="student-name">
          {connectedRoom.localParticipant.name || teacherIdentityLocal}
        </div>
        <div style={{ padding: '4px 8px 6px' }}>
          <select
            className="control-select"
            value={teacherVrmSourceId}
            onChange={(e) => handleTeacherVrmChange(e.target.value)}
            style={{ width: '100%', fontSize: '11px' }}
          >
            {allowedVrms.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>
    );
  })()}
  ```

#### 4F — All CSS for new and missing classes

- [ ] **Step 7: Append all new CSS to `App.css`**

  At the end of `frontend/src/App.css`, append:

  ```css
  /* ===== Host Session – layout ===== */
  .host-main-two-col {
    display: flex;
    gap: 16px;
    align-items: flex-start;
  }

  .host-right-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }

  /* ===== Host Session – slot panel ===== */
  .slot-panel {
    width: 280px;
    min-width: 280px;
    background: #0e0e22;
    border-right: 1px solid var(--border);
    padding: 14px;
    border-radius: 8px;
  }

  .slot-panel-header {
    color: #7788ff;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1.5px;
    margin-bottom: 12px;
    text-transform: uppercase;
  }

  .slot-panel-footer {
    color: #334;
    font-size: 10px;
    text-align: center;
    padding-top: 6px;
  }

  .slot-block {
    background: #1a1a3a;
    border-radius: 8px;
    border-left: 3px solid var(--slot-color, #44aaff);
    padding: 10px 12px;
    margin-bottom: 10px;
  }

  .slot-block-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .slot-block-position-hint {
    color: #445;
    font-size: 10px;
    margin-top: 2px;
  }

  .slot-status {
    margin-left: auto;
    font-size: 9px;
    padding: 2px 6px;
    border-radius: 10px;
    white-space: nowrap;
  }

  .slot-status.assigned {
    background: #1a2e1a;
    color: #7f7;
  }

  .slot-status.unassigned {
    background: #1a1a1a;
    color: #555;
  }

  .slot-field-label {
    display: block;
    color: #666;
    font-size: 10px;
    margin-bottom: 3px;
    margin-top: 6px;
  }

  .slot-select {
    width: 100%;
  }

  /* ===== Host Session – task goal selector ===== */
  .task-selector {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 14px;
  }

  .task-selector-header {
    color: #7788ff;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    margin-bottom: 8px;
  }

  .task-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .task-pill {
    background: var(--accent);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 20px;
    padding: 4px 12px;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .task-pill:hover {
    border-color: var(--accent-light);
    color: var(--text-h);
  }

  .task-pill.active {
    background: var(--accent-light);
    color: #fff;
    border-color: var(--accent-light);
  }

  .task-pill-clear {
    background: transparent;
    color: var(--danger);
    border: 1px solid var(--danger);
    border-radius: 20px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
    opacity: 0.8;
    transition: opacity 0.15s;
  }

  .task-pill-clear:hover {
    opacity: 1;
  }

  /* ===== Host Session – teacher card ===== */
  .teacher-card {
    border-color: #3a2a5a !important;
    background: #1e1a2e !important;
  }

  .teacher-card-tab {
    position: absolute;
    top: -1px;
    left: 10px;
    background: #3a2a5a;
    color: #ddf;
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 1px;
    padding: 1px 6px;
    border-radius: 0 0 4px 4px;
    text-transform: uppercase;
  }

  .teacher-card-video {
    width: 100%;
    aspect-ratio: 4 / 3;
    background: #0e0818;
    border: 1px solid #2a1a4a;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #446;
    font-size: 11px;
    margin-top: 10px;
    margin-bottom: 6px;
  }

  /* ===== Host Session – control button ===== */
  .control-btn {
    background: var(--bg-card);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 4px 12px;
    font-size: 12px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .control-btn.active {
    background: #2a1a1a;
    border-color: var(--danger);
    color: var(--danger);
  }
  ```

- [ ] **Step 8: Type-check**

  ```bash
  cd frontend && npx tsc -b --noEmit
  ```
  Expected: no errors.

- [ ] **Step 9: Build check**

  ```bash
  cd frontend && npm run build
  ```
  Expected: build completes with no TypeScript errors. Vite warnings about bundle size are acceptable.

- [ ] **Step 10: Commit**

  ```bash
  git add frontend/src/components/HostSession.tsx frontend/src/App.css
  git commit -m "feat: host console v2 layout — slot colors, task selector, teacher card"
  ```

---

## Manual Verification Checklist

After all tasks are committed, start dev server (`cd frontend && npm run dev`) and verify:

- [ ] **Header**: No teacher VRM selector in the header bar; only scene select, face toggle, open bigscreen remain
- [ ] **Slot panel**: Each slot block has a colored left border (`#44aaff` for cashier, `#ff8844` for customer); position hints show correctly (`右側 (x=1.2)`)
- [ ] **Task selector**: Shows below the header for clothingStore scene; 4 pill buttons rendered; clicking a pill highlights it; "✕ 無任務" appears after selection; selecting again clears
- [ ] **Teacher card**: Appears as first card in participant grid with `老師` tab; VRM selector inside card works; slot badge shows when teacher assigned to a slot
- [ ] **BigScreen overlay**: After opening BigScreen and selecting a task, top-right corner shows `🎯 任務目標` + task text; clearing task removes the overlay; switching scenes clears the overlay
- [ ] **Scene change**: Switching scene resets selected task to none; BigScreen clears task overlay
