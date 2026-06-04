/**
 * sceneOccluders.ts
 *
 * 「場景遮罩物件」靜態物件庫。教師端 drawer 從此清單挑選後,
 * 以 SceneOccluderInstance(types/sceneOccluder.ts)記錄使用者實例的 transform。
 *
 * GLB 檔請放在 /public/models/occluders/ 之下。新增物件時:
 *  1) 把 .glb 放進該目錄
 *  2) 在 OCCLUDER_LIBRARY 補一筆 { id, label, glbUrl, defaultScale? }
 *  3) 重新整理 BigScreen 與教師端即可使用
 */
export interface OccluderLibraryItem {
  /** 物件庫中的穩定 ID(請避免跟既有 ID 衝突;一旦上線勿輕易更名)。 */
  id: string
  /** UI 顯示名稱。 */
  label: string
  /** 公開路徑下的 GLB URL,例如 '/models/occluders/screen-panel.glb'。 */
  glbUrl: string
  /** 預設 uniform scale(未設則 1)。 */
  defaultScale?: number
}

/**
 * 預製物件清單。先留空,實際使用時請在此補資料 — 對應的 GLB 檔也要存在,
 * 否則 BigScreen 載入會 warn 且物件不會出現(但 drawer 仍可正常操作)。
 */
export const OCCLUDER_LIBRARY: OccluderLibraryItem[] = [
  {
    id: 'rack',
    label: '衣架',
    glbUrl: '/models/occluders/Rack.glb',
    defaultScale: 1
  }
]

/** 以 id 為 key 的快速查找表 — 供 BigScreen 端在收到實例時對照取 glbUrl。 */
export const OCCLUDER_LIBRARY_BY_ID: Record<string, OccluderLibraryItem> = Object.fromEntries(
  OCCLUDER_LIBRARY.map((item) => [item.id, item]),
)
