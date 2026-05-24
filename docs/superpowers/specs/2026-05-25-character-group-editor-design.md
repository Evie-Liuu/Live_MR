# 角色群組編輯器（Character Group Editor）設計文件

日期：2026-05-25
範圍：BigScreen 場景中「角色 + 道具」群組的位置/旋轉編輯，老師端控制、結果存於前端本機

---

## 1. 背景與目的

`BigScreen.tsx` 透過 `useBigScreenScene` 渲染場景，元素分三類：

- **VRM 角色**（`SceneVariant.slots`，例如顧客、收銀員）
- **靜態道具**（`SceneVariant.propSystem.staticProps`，例如櫃台、衣架）
- **任務道具**（`SceneVariant.propSystem.taskProps`，跟 task id 綁定的衣物 GLB）

目前位置與旋轉硬編碼在 `frontend/src/config/scenes.ts`。當老師想根據實際投影機畫面或上課情境微調這些元素的相對位置時，沒有 in-app 工具，只能改原始碼。

本設計新增一個「角色群組編輯器」：

- 場景設計時定義「群組」（一組會邏輯上一起移動的元素，例如「顧客 + 衣架 + 衣物」）
- 老師在 HostSession 端開啟編輯抽屜
- 對「整個群組」套用剛體位移 + 三軸旋轉（pitch / yaw / roll）
- 結果存於 `localStorage`，下次開啟場景自動套用

---

## 2. 範圍與非範圍

**範圍內**

- `scenes.ts` 新增 `groups` 設定欄位
- HostSession 端：每個 slot-card 加 ⚙ 入口、新增 SceneEditor 抽屜
- BigScreen 端：接收即時預覽訊息、啟動時讀 localStorage 套用
- `useBigScreenScene` 套用群組變換到成員 Object3D
- 純函式 `utils/groupTransform.ts`：pivot 計算 + 變換套用

**非範圍**

- 不引入測試框架（純函式留好介面、將來加 vitest 時可立即覆蓋）
- 不寫回 `scenes.ts` 原始碼、不接後端 API、不做 JSON 匯入/匯出
- 不支援臨時 ad-hoc 選成員、不支援 tag-based 自動分組
- 群組成員無法在 runtime 動態增減（為場景固定結構）
- 不支援動畫進場 / 出場
- 不支援 BigScreen 端直接編輯（無滑鼠鍵盤）

---

## 3. 資料模型

### 3.1 `scenes.ts` 新欄位

於 `frontend/src/types/vrm.ts`（或 `scenes.ts` 內部 type）新增：

```ts
export interface GroupMemberRef {
  kind: 'slot' | 'staticProp' | 'taskProp';
  id: string; // 對應 slot.id / staticProp.id / taskProp 的 task id
}

export interface GroupConfig {
  id: string;        // e.g. 'customer_area'
  label: string;     // e.g. '顧客區（顧客+衣架+衣物）'
  members: GroupMemberRef[];
  /** 選填：固定旋轉中心；不給則用成員 base position 的 centroid */
  pivot?: [number, number, number];
}
```

並擴充 `SceneVariant` 與 `SceneConfig`：

```ts
interface SceneVariant {
  // ...既有欄位
  groups?: GroupConfig[];
}
```

`buildScenePresets()` 把 `variant.groups` 一併放進 `SceneConfig`。

### 3.2 服飾店收銀台場景的範例 groups

```ts
groups: [
  {
    id: 'cashier_side',
    label: '收銀區',
    members: [
      { kind: 'slot',       id: 'cashier' },
      { kind: 'staticProp', id: 'cashier_counter' },
    ],
  },
  {
    id: 'customer_side',
    label: '顧客區',
    members: [
      { kind: 'slot',       id: 'customer' },
      { kind: 'staticProp', id: 'rack' },
      { kind: 'taskProp',   id: 'ask_price_1' },
      { kind: 'taskProp',   id: 'ask_price_2' },
      { kind: 'taskProp',   id: 'ask_price_3' },
      { kind: 'taskProp',   id: 'ask_price_4' },
      { kind: 'taskProp',   id: 'ask_price_5' },
    ],
  },
]
```

### 3.3 localStorage shape

Key：`bigscreen-group-transforms`

```ts
type StoredGroupTransform = { pos: [number, number, number]; rot: [number, number, number] };

type StoredScene = Record<string /* groupId */, StoredGroupTransform>;
type StoredAll   = Record<string /* sceneId */, StoredScene>;
```

`rot` 以 **radian** 儲存（與 scenes.ts、Three.js 一致）。SceneEditor UI 處理 deg ↔ rad 轉換。

### 3.4 BroadcastChannel 新訊息

於 `BigScreenMsg`：

```ts
type: 'pose' | 'leave' | /* ... */ | 'group-transform';
groupId?: string;
groupTransform?: { pos: [number, number, number]; rot: [number, number, number] };
```

---

## 4. 元件邊界與職責

```
┌─────────────────────────────────────┐         ┌──────────────────────────────────────┐
│  HostSession 視窗                   │         │  BigScreen 視窗                      │
│                                     │         │                                      │
│  ┌───────────────────────────────┐  │         │  ┌────────────────────────────────┐  │
│  │ SceneEditor.tsx (新)          │  │         │  │ BigScreen.tsx                  │  │
│  │  - 標題 + 成員列表            │  │         │  │  - 收 'group-transform' 訊息   │  │
│  │  - 6 滑桿 (XYZ pos / XYZ rot) │──┼─bcast──→│  │  - 維護 groupTransforms state  │  │
│  │  - Reset / Save 按鈕          │  │         │  │  - 傳給 useBigScreenScene      │  │
│  │  - 讀寫 localStorage          │  │         │  └──────────┬─────────────────────┘  │
│  └───────────────────────────────┘  │         │             │                        │
│            ↑                        │         │  ┌──────────▼─────────────────────┐  │
│            │ slot-card ⚙ 觸發      │         │  │ useBigScreenScene (改)         │  │
│  ┌─────────┴─────────────────────┐  │         │  │  - 解析 groupId → Object3Ds    │  │
│  │ HostSession.tsx (改)          │  │         │  │  - 用 groupTransform 套用     │  │
│  │  Slot drawer / slot-card 加鈕 │  │         │  └──────────┬─────────────────────┘  │
│  └───────────────────────────────┘  │         │             │                        │
└─────────────────────────────────────┘         │  ┌──────────▼─────────────────────┐  │
                                                │  │ utils/groupTransform.ts (新)   │  │
                                                │  │  - computePivot(members)       │  │
                                                │  │  - applyGroupTransform(base,   │  │
                                                │  │      pivot, transform)         │  │
                                                │  └────────────────────────────────┘  │
                                                └──────────────────────────────────────┘
```

### 4.1 新檔案

- `frontend/src/components/SceneEditor.tsx`
- `frontend/src/utils/groupTransform.ts`

### 4.2 修改既有檔案

- `frontend/src/types/vrm.ts` — 加 `GroupConfig` / `GroupMemberRef` / `SceneConfig.groups`
- `frontend/src/config/scenes.ts` — `clothingStore_cashier` 加 `groups`
- `frontend/src/components/BigScreen.tsx`
  - `BigScreenMsg` 加 `group-transform`
  - 新增 `groupTransforms` state + mount 時讀 localStorage
  - message handler 處理 `'group-transform'`
  - 傳 `groupTransforms` 給 `useBigScreenScene`
- `frontend/src/hooks/useBigScreenScene.ts`
  - options 加 `groupTransforms?: Record<string, StoredGroupTransform>`
  - 取得 prop loader 回傳的 `id → Object3D` map（若目前未暴露，propLoader.ts 小幅調整）
  - groupTransforms 變動時 re-apply（不重建 scene）
  - prop 載入完成 / avatar swap 完成的 callback 中也 trigger re-apply
- `frontend/src/components/HostSession.tsx`
  - slot-card 加 ⚙ 按鈕（僅當該 slot 屬於某 group 時顯示）
  - 新增 `sceneEditorGroupId` state、渲染 `<SceneEditor />` 抽屜
- `frontend/src/utils/propLoader.ts`
  - 確保 `loadStaticProps` / `loadTaskProps` 的回傳值可作為「id → Object3D」查表

### 4.3 SceneEditor.tsx 介面

```tsx
interface SceneEditorProps {
  sceneId: string;
  group: GroupConfig;
  channel: BroadcastChannel;
  onClose: () => void;
}
```

抽屜內容（沿用 `panel-drawer panel-drawer--open` 樣式）：

1. 標題：`{group.label}`、成員 icon 列、✕ 關閉
2. **位置** 區塊：X / Y / Z 三個 slider + number input
   - 範圍 ±5m，step 0.05；number input 不截
3. **旋轉** 區塊：Pitch / Yaw / Roll 三個 slider + number input
   - 範圍 ±180°，step 1°；UI 用度（deg），broadcast/儲存用 radian
4. 按鈕列：`Reset`、`Save`
5. 若群組包含 `kind: 'slot'`：Pitch/Roll 旁顯示提示「角色傾斜可能不自然」

行為：

- 滑桿/數值變動 → 立即 `channel.postMessage({ type:'group-transform', groupId, groupTransform })`（即時預覽）
- `Save` → 寫入 localStorage `bigscreen-group-transforms[sceneId][groupId]`
- `Reset` → broadcast zero transform、清除 localStorage 對應 entry、UI 歸零

---

## 5. 資料流

### 5.1 啟動（BigScreen mount）

```
1. 讀 sessionStorage 'bigscreen-sceneId' → sceneId
2. 讀 localStorage 'bigscreen-group-transforms' → 取 [sceneId] 那塊
3. setState groupTransforms = (2) 或 {}
4. useBigScreenScene 收到 groupTransforms prop
5. propLoader 完成、avatar ensureAvatar 完成後 → 套用群組變換到對應 Object3D
```

### 5.2 編輯（HostSession 操作）

```
SceneEditor slider onChange
   → 本機 useState 更新（即時 UI 回饋）
   → channel.postMessage('group-transform', ...)
   → BigScreen 收到 → setGroupTransforms({...prev, [groupId]: t})
   → useBigScreenScene re-apply
   → 畫面更新

按 Save:
   → localStorage 寫入 [sceneId][groupId]

按 Reset:
   → broadcast zero transform
   → localStorage 移除 [sceneId][groupId]
```

### 5.3 群組變換套用算法

純函式於 `utils/groupTransform.ts`：

```ts
type Vec3 = [number, number, number];

export function computePivot(memberBasePositions: Vec3[]): Vec3;

export function applyGroupTransform(
  base: { pos: Vec3; rot: Vec3 },
  pivot: Vec3,
  transform: { pos: Vec3; rot: Vec3 },
): { pos: Vec3; rot: Vec3 };
```

`applyGroupTransform` 邏輯：

```
relative = base.pos - pivot
rotated  = rotateByEuler(relative, transform.rot)   // 順序 XYZ
finalPos = pivot + rotated + transform.pos
finalRot = combineEuler(base.rot, transform.rot)
```

`useBigScreenScene` 每次 re-apply：

1. 由 `SceneConfig.groups` 取出 group + members
2. 解析每個 member 至 `Object3D`（lookup three maps：slots / staticProps / taskProps）
3. lookup 失敗 → skip（物件尚未載入，將由 load callback 重觸發）
4. 對找到的成員：抓 base pos/rot（從 scenes.ts 對應條目），呼叫 `applyGroupTransform`，寫入 `object.position` / `object.rotation`

### 5.4 觸發 re-apply 的時機

- `groupTransforms` state 改變（mount 載 localStorage 或收到 broadcast）
- propLoader 完成（既有 `onScenePropsReady` callback 內加）
- `ensureAvatar` Promise resolve 後
- `swapAvatar` 完成後（slot 重新指派 / VRM 換模）
- 場景切換（既有 `useEffect([sceneId])` 重建 scene，最後重套）

---

## 6. 邊界情況與錯誤處理

| 情況 | 處理 |
| --- | --- |
| 群組成員引用不存在的 id | dev 環境 `console.warn`；正式環境 skip；不阻擋其他成員 |
| 成員物件尚未載入（async race） | lookup 失敗 → skip；load callback 觸發重套 |
| 切換場景殘留 | localStorage 兩層 key `[sceneId][groupId]`；新場景自然讀新 entry |
| taskProp 被學生抓取（`propState === 'held'`） | **不**套用 group transform，跟著手走 |
| taskProp returning 狀態 | base position 改用「套了 group transform 的 displayPos」當目標 |
| slot 重新指派 / VRM swap | swap 完成 callback 觸發重套 |
| localStorage quota / JSON 解析失敗 | try/catch（沿用 BigScreen 既有寫法），失敗視為空 `{}` |
| 兩個 HostSession 同時編輯 | 後寫者勝；不額外處理（YAGNI） |
| VRM 角色 Pitch/Roll 不自然 | 不阻擋；SceneEditor 顯示提示文字 |
| 數值單位 | 位置 m；旋轉 UI 用 deg、broadcast/儲存 用 rad |

---

## 7. 與既有系統的互動

- **錄影**：composite stream 從 BigScreen 的 source canvas 抓取，群組變換已套用在 Object3D 上，錄出來與即時看到的一致，**不需改動錄影路徑**
- **PoseDetection**：套用的是 avatar 的 root scene `position`/`rotation`，與 VRM 骨架 pose（hips / spine 等）獨立，pose 仍正常作用
- **prop interaction**（grab / projectToUV / attachPropToHand）：interaction 計算發生在「base position」之後、group transform 之前。具體實作要求：把 displayPos 視為 base，由 groupTransform 算出 final；held 狀態時 group transform 跳過該物件
- **既有 `slot-assign` / `vrm-change` / `scene-change` 訊息**：彼此獨立，新訊息 `'group-transform'` 不衝突

---

## 8. 測試策略

### 8.1 不引入測試框架

`frontend/` 目前無 `vitest.config` 或專案內 `*.test.ts`。將 `groupTransform.ts` 寫成純函式，未來引入框架時可立即覆蓋，不在此功能引入。

### 8.2 PR 手動驗證 checklist

**基本流程**
- [ ] 點 slot-card ⚙ → 抽屜開啟、預選正確 group、列出正確成員
- [ ] 拖 X 位移 → BigScreen 該群組所有成員一起移動
- [ ] 拖 Yaw → 成員繞群組中心轉向（非各自原地轉）
- [ ] Save → 重新整理 BigScreen → 位置仍維持
- [ ] Reset → 立即還原、localStorage 該 entry 消失

**互動相容性**
- [ ] 切任務 → 新 taskProp 出場時自動帶上 group transform
- [ ] 學生抓取 prop（held）→ 跟手走，不被群組變換干擾
- [ ] 放下 prop（returning）→ lerp 回到套了群組變換的 displayPos

**邊界**
- [ ] 切場景 → 舊 group transform 不殘留
- [ ] 重新指派 slot / 換 VRM → 新 VRM 立即在群組變換後的位置
- [ ] 同時編輯兩個不同 group → 互不干擾

**錄影**
- [ ] 編輯中按錄影 → 錄出影片內元素位置與畫面一致

### 8.3 Dev-only 除錯輸出

實作時於 `applyGroupTransform` 入口加 `if (import.meta.env.DEV) console.log(...)`，印出「套用的成員 / 被 skip 的成員」，release 前移除或保留在 DEV 條件內。

---

## 9. 實作順序建議（供 writing-plans 參考）

1. 型別與 config：`types/vrm.ts` 加 type、`scenes.ts` 加 `groups` 範例
2. `utils/groupTransform.ts` 純函式
3. `propLoader.ts` 微調以暴露 id → Object3D map
4. `useBigScreenScene.ts` 整合：解析 + re-apply hook
5. `BigScreen.tsx` 訊息 + state + localStorage 啟動讀取
6. `SceneEditor.tsx` 新元件
7. `HostSession.tsx`：slot-card ⚙ 按鈕、抽屜 wiring
8. 手動驗證 checklist 跑一輪

---

## 10. 開放問題（none — 設計階段已收斂）

無待解。pivot 預設 centroid、held 不套變換、VRM Pitch/Roll 顯示提示 — 均已確認。
