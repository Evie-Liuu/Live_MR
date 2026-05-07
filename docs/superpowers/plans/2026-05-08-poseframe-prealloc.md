# PoseFrame 預配置緩衝區 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `usePoseDetection` 的 RAF loop 外預配置 landmark 緩衝區，以 for 迴圈原地更新取代每幀 `.map()`，消除 94% 的短命物件配置。

**Architecture:** 在 `init()` 函式內、loop 啟動前宣告 5 個緩衝區（worldLandmarksBuf、faceLandmarksBuf、leftHandBuf、rightHandBuf、blendshapesBuf）。Loop 內改以 for 迴圈原地寫入；`frame.landmarks`（pose 33點）因存入 React state 須維持每幀建新陣列。

**Tech Stack:** TypeScript、React hooks、MediaPipe Tasks Vision

---

## 修改檔案

- Modify: `frontend/src/hooks/usePoseDetection.ts`（全部改動均在此一檔案）

---

### Task 1：宣告緩衝區 + 替換 worldLandmarks

**Files:**
- Modify: `frontend/src/hooks/usePoseDetection.ts:135`（在 `let lastDetectTime = 0;` 之前新增緩衝區）
- Modify: `frontend/src/hooks/usePoseDetection.ts:160-166`（替換 worldLandmarks `.map()`）

- [ ] **Step 1：在 `let lastDetectTime = 0;` 前插入緩衝區宣告**

在 `frontend/src/hooks/usePoseDetection.ts` 第 135 行（`let lastDetectTime = 0;`）之前插入：

```typescript
        // ── Pre-allocated landmark buffers (avoid per-frame object creation) ──
        const worldLandmarksBuf: PoseLandmark[] =
          Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
        const faceLandmarksBuf: PoseLandmark[] =
          Array.from({ length: 478 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
        const leftHandBuf: PoseLandmark[] =
          Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
        const rightHandBuf: PoseLandmark[] =
          Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
        const blendshapesBuf: FaceBlendshapes = {};

        let lastDetectTime = 0;
```

- [ ] **Step 2：替換 worldLandmarks 的 `.map()`**

將目前 `frame` 物件建立前後的 worldLandmarks 計算（第 160-167 行）改為先算再傳入：

將以下現有程式碼（整個 `const frame: PoseFrame = { ... }` 區塊，含 worldLandmarks inline ternary）：

```typescript
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
```

替換為：

```typescript
                  let worldLandmarks: PoseLandmark[];
                  if (result.worldLandmarks && result.worldLandmarks.length > 0) {
                    const wl = result.worldLandmarks[0];
                    for (let i = 0; i < wl.length; i++) {
                      worldLandmarksBuf[i].x = wl[i].x;
                      worldLandmarksBuf[i].y = wl[i].y;
                      worldLandmarksBuf[i].z = wl[i].z;
                      worldLandmarksBuf[i].visibility = wl[i].visibility ?? 0;
                    }
                    worldLandmarks = worldLandmarksBuf;
                  } else {
                    worldLandmarks = [];
                  }

                  const frame: PoseFrame = {
                    type: 'pose',
                    landmarks: result.landmarks[0].map((l) => ({
                      x: l.x, y: l.y, z: l.z,
                      visibility: l.visibility ?? 0,
                    })),
                    worldLandmarks,
                  };
```

- [ ] **Step 3：TypeScript 快速確認（僅 type-check，不 build）**

```bash
cd frontend && npx tsc --noEmit
```

預期：0 錯誤。若有錯誤，確認 `worldLandmarksBuf` 宣告位置在 loop 函式的 closure 內。

---

### Task 2：替換 faceLandmarks、blendshapes、handLandmarks

**Files:**
- Modify: `frontend/src/hooks/usePoseDetection.ts:177-189`（face）
- Modify: `frontend/src/hooks/usePoseDetection.ts:205-207`（hand）

- [ ] **Step 1：替換 faceLandmarks 的 `.map()`**

找到以下程式碼（face landmarks 區塊，約第 177-179 行）：

```typescript
                        frame.faceLandmarks = faceResult.faceLandmarks[0].map((l) => ({
                          x: l.x, y: l.y, z: l.z, visibility: l.visibility ?? 1,
                        }));
```

替換為：

```typescript
                        const fl = faceResult.faceLandmarks[0];
                        for (let i = 0; i < fl.length; i++) {
                          faceLandmarksBuf[i].x = fl[i].x;
                          faceLandmarksBuf[i].y = fl[i].y;
                          faceLandmarksBuf[i].z = fl[i].z;
                          faceLandmarksBuf[i].visibility = fl[i].visibility ?? 1;
                        }
                        frame.faceLandmarks = faceLandmarksBuf;
```

- [ ] **Step 2：替換 FaceBlendshapes 物件配置**

找到以下程式碼（約第 185-189 行）：

```typescript
                        const bs: FaceBlendshapes = {};
                        for (const cat of faceResult.faceBlendshapes[0].categories) {
                          bs[cat.categoryName] = cat.score;
                        }
                        frame.faceBlendshapes = bs;
```

替換為：

```typescript
                        for (const cat of faceResult.faceBlendshapes[0].categories) {
                          blendshapesBuf[cat.categoryName] = cat.score;
                        }
                        frame.faceBlendshapes = blendshapesBuf;
```

- [ ] **Step 3：替換 hand landmarks 的 `.map()`**

找到以下程式碼（約第 204-214 行）：

```typescript
                          const label = handResult.handedness?.[hi]?.[0]?.categoryName ?? ''
                          const lms = handResult.landmarks[hi].map((l) => ({
                            x: l.x, y: l.y, z: l.z, visibility: 1,
                          }))
                          // MediaPipe 'Left' = camera left = person's Right hand, and vice versa
                          // We store as person's perspective to match solveHand() expectations
                          if (label === 'Left') {
                            frame.rightHandLandmarks = lms   // camera Left = person Right
                          } else if (label === 'Right') {
                            frame.leftHandLandmarks = lms    // camera Right = person Left
                          }
```

替換為：

```typescript
                          const label = handResult.handedness?.[hi]?.[0]?.categoryName ?? ''
                          // MediaPipe 'Left' = camera left = person's Right hand, and vice versa
                          // We store as person's perspective to match solveHand() expectations
                          if (label === 'Left' || label === 'Right') {
                            const handBuf = label === 'Left' ? rightHandBuf : leftHandBuf;
                            const hl = handResult.landmarks[hi];
                            for (let i = 0; i < hl.length; i++) {
                              handBuf[i].x = hl[i].x;
                              handBuf[i].y = hl[i].y;
                              handBuf[i].z = hl[i].z;
                            }
                            if (label === 'Left') {
                              frame.rightHandLandmarks = handBuf;  // camera Left = person Right
                            } else {
                              frame.leftHandLandmarks = handBuf;   // camera Right = person Left
                            }
                          }
```

- [ ] **Step 4：TypeScript 完整確認**

```bash
cd frontend && npx tsc --noEmit
```

預期：0 錯誤。

- [ ] **Step 5：ESLint 確認**

```bash
cd frontend && npx eslint src/hooks/usePoseDetection.ts
```

預期：0 錯誤（warnings 可忽略）。

- [ ] **Step 6：Commit**

```bash
git add frontend/src/hooks/usePoseDetection.ts
git commit -m "perf: 預配置 PoseFrame landmark 緩衝區，消除每幀 .map() 物件配置"
```

---

### Task 3：人工驗證

**Files:**（不修改，僅驗證）
- `frontend/src/hooks/usePoseDetection.ts`（確認行為正確）

- [ ] **Step 1：啟動開發伺服器**

```bash
cd frontend && npm run dev
```

- [ ] **Step 2：開啟 StudentSession 頁面，啟用 face + hand 偵測**

進入學生端頁面，確認：
1. 骨架 overlay 隨動作即時更新（pose landmarks 仍正常）
2. VRM 頭部跟隨臉部轉動（faceLandmarks / blendshapes 正常）
3. 手部手勢偵測正常回應

- [ ] **Step 3：開啟瀏覽器 DevTools → Performance，錄製 10 秒**

確認 GC（垃圾回收）事件明顯減少；每幀 Minor GC 停頓應大幅縮短。

- [ ] **Step 4：確認 BigScreen 多人場景骨架正常**

開啟 BigScreen（Host 端），確認 VRM 骨架同步仍正常，無抖動或資料異常。
