/**
 * sceneOccluder.ts
 *
 * 「場景遮罩物件」(scene occluder) 的使用者實例型別。
 * 教師在 drawer 中從 OCCLUDER_LIBRARY 挑物件加入當前場景後,即以本型別儲存於
 * localStorage(key: bigscreen-scene-occluders)並廣播給 BigScreen 渲染。
 *
 * 與 library item 解耦:libraryId 指回 OCCLUDER_LIBRARY[].id,
 * 實例只記錄 transform。若 libraryId 已從 config 移除則視同失效。
 */
export interface SceneOccluderInstance {
  /** 唯一識別,於加入當下以 crypto.randomUUID() 產生。 */
  instanceId: string
  /** 對應 OCCLUDER_LIBRARY[].id。 */
  libraryId: string
  /** 世界座標位置(公尺)。 */
  position: [number, number, number]
  /** Y 軸為主之歐拉旋轉(radian)。 */
  rotation: [number, number, number]
  /** uniform scale(單值)。 */
  scale: number
}
