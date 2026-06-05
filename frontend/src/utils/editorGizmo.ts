/**
 * editorGizmo.ts
 *
 * 對 three.js TransformControls 的薄封裝。
 *  - attachGizmo:建立並加入 scene。
 *  - 對外只透過 setTarget / setMode 操作;dragging-changed 事件由呼叫端訂閱。
 *  - disposeGizmo:從 scene 移除並釋放。
 */
import * as THREE from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'

export type GizmoMode = 'translate' | 'rotate'

export interface GizmoHandle {
  controls: TransformControls
  setTarget: (root: THREE.Object3D | null) => void
  setMode: (mode: GizmoMode) => void
  /** 主動釋放 — caller 必須在 unmount 時呼叫。 */
  dispose: () => void
}

export function attachGizmo(
  scene: THREE.Scene,
  camera: THREE.Camera,
  domElement: HTMLElement,
  mode: GizmoMode,
): GizmoHandle {
  const controls = new TransformControls(camera, domElement)
  controls.setMode(mode)
  controls.setSpace('world')
  scene.add(controls as unknown as THREE.Object3D)

  let attached: THREE.Object3D | null = null

  const setTarget = (root: THREE.Object3D | null) => {
    if (root === attached) return
    if (attached) controls.detach()
    if (root) controls.attach(root)
    attached = root
  }

  const setMode = (m: GizmoMode) => controls.setMode(m)

  const dispose = () => {
    try { controls.detach() } catch { /* ignore */ }
    try { scene.remove(controls as unknown as THREE.Object3D) } catch { /* ignore */ }
    try { controls.dispose() } catch { /* ignore */ }
  }

  return { controls, setTarget, setMode, dispose }
}
