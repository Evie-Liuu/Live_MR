import { OCCLUDER_LIBRARY_BY_ID } from '../config/sceneOccluders'
import type { SceneOccluderInstance } from '../types/sceneOccluder'

/**
 * 預設 transform — 場景中央,地面以上 1m,鏡頭前 1m。
 * scale 來自 library 設定的 defaultScale,缺省為 1。
 */
export function defaultOccluderTransform(
  libraryId: string,
): Pick<SceneOccluderInstance, 'position' | 'rotation' | 'scale'> {
  const lib = OCCLUDER_LIBRARY_BY_ID[libraryId]
  return {
    position: [0, 1, -1],
    rotation: [0, 0, 0],
    scale: lib?.defaultScale ?? 1,
  }
}
