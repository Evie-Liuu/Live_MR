/**
 * occluderLoader.ts
 *
 * 場景遮罩物件(occluder)的 GLB 載入與 dispose helper。
 * 與 propLoader 類似,但每次只載一個,並回傳純 THREE.Group(失敗時為 null),
 * 讓 useBigScreenScene 以 instanceId 為單位做 diff sync。
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const loader = new GLTFLoader()

/**
 * 載入一個遮罩 GLB 並 add 進 scene。
 * 失敗時 console.warn 並回 null — 呼叫端視同「該 instance 載入失敗」。
 */
export async function loadOccluderGlb(
  url: string,
  scene: THREE.Scene,
): Promise<THREE.Group | null> {
  try {
    const gltf = await loader.loadAsync(url)
    gltf.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    })
    scene.add(gltf.scene)
    return gltf.scene
  } catch (err) {
    console.warn(`[OccluderLoader] Failed to load "${url}":`, err)
    return null
  }
}

/** 從場景移除並釋放此 group 的 geometry / material。 */
export function disposeOccluder(group: THREE.Group, scene: THREE.Scene): void {
  scene.remove(group)
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) (m as THREE.Material).dispose()
    }
  })
}
