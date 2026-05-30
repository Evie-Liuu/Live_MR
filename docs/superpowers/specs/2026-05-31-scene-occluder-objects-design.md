# 場景遮罩物件編輯器設計

日期：2026-05-31
狀態：草稿（待使用者審閱）

## 背景與目標

大屏 `backgroundType: 'camera'` 模式會把真實相機畫面當作背景，與 Three.js
場景內的角色 / 道具合成，達到 MR 效果。但真實環境中常有不和諧的物件（如
凌亂的桌面、椅背、走道），讓老師希望能放置「虛擬遮罩物件」在 3D 場景中，
讓這些物件在大屏視角下擋住真實場景的視覺干擾，增加虛實融合感。

目標：讓教師在教師控制台 drawer 中，從**預製 GLB 物件庫**挑選並加入遮罩
物件至當前場景，調整位置/旋轉/縮放後即時呈現在大屏。

非目標（本次不做）：
- 材質 / 色彩 / 透明度編輯
- viewport 內直接拖拉物件（Three.js gizmo）
- 跨機器同步 / 後端持久化
- 多場景批次匯入匯出
- 任何相機背景處理（分割 / blur / 替換）

## 架構與資料模型

**物件庫**（靜態 config）— 由開發者預先放 GLB，登錄在：

```ts
// frontend/src/config/sceneOccluders.ts
export interface OccluderLibraryItem {
  id: string            // 'screen-panel'
  label: string         // '屏風'
  glbUrl: string        // '/models/occluders/screen-panel.glb'
  defaultScale?: number // 預設 uniform scale（未設則 1）
}
export const OCCLUDER_LIBRARY: OccluderLibraryItem[] = []
```

**使用者加入的實例**（per-scene；persistence in localStorage）：

```ts
// frontend/src/types/sceneOccluder.ts
export interface SceneOccluderInstance {
  instanceId: string                     // crypto.randomUUID()，每次加入產生
  libraryId: string                      // OCCLUDER_LIBRARY[].id
  position: [number, number, number]
  rotation: [number, number, number]     // radian
  scale: number                          // 單一 uniform scale
}
```

LocalStorage：
- key：`bigscreen-scene-occluders`
- value 形式：`Record<sceneId, SceneOccluderInstance[]>`

**MVP 限制**：
- 每場景上限 10 個（軟性 UI 限制，避免列表過長）。
- 無 undo / redo。
- 無材質 UI（GLB 自帶材質）。
- 只支援 uniform scale（單值）。

## 廣播協議

新增一個 `BigScreenMsg` 類型，整包傳送：

```ts
type: '...其他既有... | occluders-set'
occluders?: SceneOccluderInstance[]
```

任何加入 / 刪除 / 滑桿移動都觸發一次 `'occluders-set'` 廣播，附當前場景的完整
陣列（N ≤ 10，成本可忽略；與既有 `groupTransforms` 整包傳遞風格一致）。BigScreen
收到後對照當前已渲染的 `instanceId` 集合做 diff：新增載入、移除 dispose、保留則
更新 transform。

## 檔案結構

**新建（4）：**
- `frontend/src/config/sceneOccluders.ts` — 物件庫宣告
- `frontend/src/types/sceneOccluder.ts` — `SceneOccluderInstance` 型別
- `frontend/src/components/SceneOccludersPanel.tsx` — drawer 內容元件
- `frontend/src/utils/occluderLoader.ts` — 純 `GLTFLoader` 載入 / dispose helper

**修改（3）：**
- `frontend/src/components/HostSession.tsx` — drawer 觸發按鈕 + 編輯 state +
  localStorage 讀寫 + 廣播（`channelRef.current?.postMessage(...)`）
- `frontend/src/components/BigScreen.tsx` — `BigScreenMsg` 加 `'occluders-set'`；
  state `occluderInstances`；message handler；初始化從 localStorage 讀
  current scene 的清單；傳入 `useBigScreenScene` options
- `frontend/src/hooks/useBigScreenScene.ts` — 新 `occluderInstances?: SceneOccluderInstance[]`
  option；用 instanceId 為 key 維護 `Map<instanceId, THREE.Group>`；
  diff 後 add / update / remove；scene unmount 時全 dispose

**Total**: 4 新檔，3 修改檔。

## UX 細節

**進入點**：HostSession 右側面板列加一顆「🪴 場景物件」按鈕（與既有 場景 / Slot / Task /
Pending 同列），點擊開 drawer。

**Drawer 內容**（由上而下，沿用 SceneEditor 的視覺語言）：

1. **物件庫列表**：每行 = 「圖示（小縮圖或 material icon） + 名稱 + [+ 加入] 按鈕」。
   按 [+] 立即建立一個 instance（uuid）加入當前場景，預設 transform，廣播。
   若該場景 instances 已達 10 個則 [+] disabled。
2. **已加入列表**：每行 = 「名稱 + 序號（同 library 第 N 個）+ [×] 刪除」；
   整列可點擊以選中。選中項以高亮樣式呈現。
3. **變換區**（僅當有選中項時顯示）：
   - X / Y / Z 位置滑桿（同 SceneEditor pattern）
   - Y 軸旋轉滑桿（degree 顯示）
   - 單值 Scale 滑桿（0.1 ~ 5.0）
   - [複製]（複製選中項並偏移微距方便分辨）/ [刪除]

**即時預覽**：建議老師打開既有的「embedded BigScreen preview」（HostSession 已有
`showBigScreenPreview` 狀態）或直接看大屏窗口。滑桿值變動即時 broadcast。

**新加入物件的預設 transform**：
- position: `[0, 1, -1]`（場景中央，地面以上 1m，鏡頭前 1m）
- rotation: `[0, 0, 0]`
- scale: 該 library item 的 `defaultScale ?? 1`

## 資料流

```
教師 drawer 操作 → setOccluderInstances(sceneId, ...)
   ├─→ localStorage 寫入（key 'bigscreen-scene-occluders'）
   └─→ channelRef.postMessage({ type:'occluders-set', occluders })
                                                │
                                                ▼
                                BigScreen.onmessage 'occluders-set'
                                  → setOccluderInstances(array)
                                  → 傳入 useBigScreenScene
                                  → hook diff & sync THREE.Group map

大屏初始化 / 切場景時：BigScreen 從 localStorage 讀 current sceneId 的清單，
                       套用後續再聽訊息（與既有 sceneId / tasks 還原機制一致）。
```

## 邊界與失敗處理

- **切場景**（HostSession `handleSceneChange`）：不清除其他場景的清單；只重載
  新場景的清單給 state，並廣播該場景的清單給 BigScreen。BigScreen 端在收到
  `'scene-change'` 後也會用新 sceneId 重讀 localStorage。
- **GLB 載入失敗**：hook 內 catch，`console.warn`，不阻擋其他操作；已加入列表
  的條目仍可點 [×] 刪除（list 是純資料，渲染失敗不影響資料層）。
- **localStorage 配額**：try/catch 包覆寫入，失敗時 `console.warn`，記憶體 state
  仍正常工作（與既有 group-transform editor 處理方式一致）。
- **delete 已選中項**：清空選中狀態，變換區隱藏。
- **library item 被開發者刪除**（升級後 instance.libraryId 找不到）：hook 端
  static-guard，將該 instance 視同 GLB 載入失敗，drawer 列表也顯示「(已失效)」
  並提供刪除。

## 測試計畫

專案無自動化測試 framework — 沿用 type-check + lint + 手動驗證。

- `npx tsc -b --noEmit` 通過。
- `npm run lint` 維持 baseline。
- 手動：
  1. 在 `OCCLUDER_LIBRARY` 加 1-2 個測試 GLB；開大屏 + 教師控制台。
  2. 從 drawer [+ 加入] 一個物件 → 大屏立即出現於預設位置。
  3. 拉位置 / 旋轉 / 縮放滑桿 → 大屏即時跟隨。
  4. 加第二個、選中切換、複製、刪除。
  5. 切場景 → 該物件消失；切回 → 還原。
  6. 重整頁面 → 還原。
  7. 第 11 次點 [+] → disabled 並提示。
  8. 把 library item 從 config 拿掉 → 既存 instance 顯示 (已失效) 可刪。

## 風險

- 預設位置 `[0, 1, -1]` 在某些場景的相機視角下可能在畫外。可在後續加 per-scene
  spawn point，但本次先以單一預設值為主。
- 滑桿單值 scale 對於要當「遮牆」用的扁平 GLB 來說可能不夠（想拉長一邊）。
  若實際發現太受限，二期再加 XYZ 分離 scale。
