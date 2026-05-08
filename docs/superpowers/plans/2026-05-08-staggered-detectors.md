# Staggered Detectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce per-tick GPU load by running Face and Hand detection at 15 FPS (alternating) instead of 30 FPS, while keeping Pose at 30 FPS.

**Architecture:** A single integer counter `detectionFrame` is incremented every 33ms throttle tick. Even ticks run Face, odd ticks run Hand. When a detector is skipped its frame fields are left undefined — `encodePoseFrame()` already handles undefined gracefully (hasFace/hasHand=false → smaller packet), and VRM SLERP maintains visual continuity.

**Tech Stack:** TypeScript, React hook, MediaPipe Tasks Vision API, requestAnimationFrame loop

---

## File Map

| File | Action |
|------|--------|
| `frontend/src/hooks/usePoseDetection.ts` | Modify — 4 targeted edits |

No new files. No other files touched.

---

### Task 1: Implement staggered detector counter

**Files:**
- Modify: `frontend/src/hooks/usePoseDetection.ts`

The file lives in the worktree at:
`C:\Project\Live_MR\.worktrees\perf\staggered-detectors\frontend\src\hooks\usePoseDetection.ts`

All commands should be run from:
`C:\Project\Live_MR\.worktrees\perf\staggered-detectors\frontend`

---

- [ ] **Step 1: Read the target file to confirm line numbers**

Open `frontend/src/hooks/usePoseDetection.ts` and locate these four anchor points:

```
line ~146:  let lastDetectTime = 0;
line ~154:  if (now - lastDetectTime >= DETECT_INTERVAL_MS) {
line ~155:      lastDetectTime = now;
line ~189:  if (faceEnabledRef.current && faceRef.current) {
line ~220:  if (handEnabledRef.current && handRef.current) {
```

Confirm they exist before making any edits.

---

- [ ] **Step 2: Add `detectionFrame` counter declaration (Edit 1)**

Find this line (around line 146):
```typescript
        let lastDetectTime = 0;
```

Replace with:
```typescript
        let lastDetectTime = 0;
        let detectionFrame = 0;
```

---

- [ ] **Step 3: Capture `tick` at the top of the throttle block (Edit 2)**

Find this block (around line 154–155):
```typescript
          if (now - lastDetectTime >= DETECT_INTERVAL_MS) {
            lastDetectTime = now;
```

Replace with:
```typescript
          if (now - lastDetectTime >= DETECT_INTERVAL_MS) {
            lastDetectTime = now;
            const tick = detectionFrame++;
```

---

- [ ] **Step 4: Gate Face detection on even ticks (Edit 3)**

Find this line (around line 189):
```typescript
                  if (faceEnabledRef.current && faceRef.current) {
```

Replace with:
```typescript
                  if (faceEnabledRef.current && faceRef.current && tick % 2 === 0) {
```

---

- [ ] **Step 5: Gate Hand detection on odd ticks (Edit 4)**

Find this line (around line 220):
```typescript
                  if (handEnabledRef.current && handRef.current) {
```

Replace with:
```typescript
                  if (handEnabledRef.current && handRef.current && tick % 2 === 1) {
```

---

- [ ] **Step 6: Verify TypeScript compiles**

Run from `frontend/`:
```powershell
npx tsc --noEmit
```

Expected: no errors, no output. If you see `tick` is not defined — confirm Edit 2 (Step 3) is inside the `if (now - lastDetectTime >= DETECT_INTERVAL_MS)` block, not outside it.

---

- [ ] **Step 7: Manual browser verification**

Start dev server:
```powershell
npm run dev
```

Open the HostSession page with face and hand enabled. Open DevTools → Performance tab, record 5 seconds.

Confirm:
- Skeleton (pose) tracks at ~30 FPS
- Face blendshapes update visibly (lips/eyes react) — may feel slightly smoother than before
- Hand tracking still responsive
- Main thread frame budget stays under 33ms (no red bars in Performance timeline)

If the browser console shows `tick is not defined` — Edit 2 was not saved correctly.

---

- [ ] **Step 8: Commit**

```powershell
git add frontend/src/hooks/usePoseDetection.ts
git commit -m "perf: stagger face/hand detection to 15 FPS, pose stays 30 FPS"
```
