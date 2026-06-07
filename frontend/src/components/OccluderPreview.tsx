/**
 * OccluderPreview.tsx
 *
 * 在素材庫卡片中渲染一個 GLB 的 mini 3D 預覽:
 *  - 自帶 renderer / scene / camera,單獨運作不影響大屏主場景
 *  - 自動 fit-camera 到模型 bounding box
 *  - 緩慢 Y 軸 auto-rotate,讓使用者看到立體感
 *  - unmount 時清掉 GPU 資源
 */
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

interface Props {
  glbUrl: string
  size?: number // px
}

const sharedLoader = new GLTFLoader()

export default function OccluderPreview({ glbUrl, size = 120 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(size, size, false)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    wrap.appendChild(renderer.domElement)

    const scene = new THREE.Scene()

    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100)
    camera.position.set(0, 1, 3)
    camera.lookAt(0, 0.5, 0)

    scene.add(new THREE.AmbientLight(0xffffff, 0.9))
    const key = new THREE.DirectionalLight(0xffffff, 1.4)
    key.position.set(2, 3, 2)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0x88aaff, 0.5)
    rim.position.set(-2, 1, -2)
    scene.add(rim)

    let model: THREE.Object3D | null = null
    let raf = 0
    let cancelled = false

    sharedLoader
      .loadAsync(glbUrl)
      .then((gltf) => {
        if (cancelled) return
        model = gltf.scene
        // Fit to unit cube
        const bbox = new THREE.Box3().setFromObject(model)
        const sizeV = bbox.getSize(new THREE.Vector3())
        const center = bbox.getCenter(new THREE.Vector3())
        const maxDim = Math.max(sizeV.x, sizeV.y, sizeV.z) || 1
        const fitScale = 1.2 / maxDim // make it fill nicely
        model.scale.setScalar(fitScale)
        model.position.sub(center.multiplyScalar(fitScale))
        // Keep feet near floor visually — lift a bit so it sits in frame
        model.position.y += 0.25
        scene.add(model)
      })
      .catch((err) => {
        console.warn('[OccluderPreview] load failed:', glbUrl, err)
      })

    const clock = new THREE.Clock()
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const t = clock.getElapsedTime()
      if (model) model.rotation.y = t * 0.5
      renderer.render(scene, camera)
    }
    tick()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      if (model) {
        scene.remove(model)
        model.traverse((obj) => {
          const m = obj as THREE.Mesh
          if (m.geometry) m.geometry.dispose()
          if (m.material) {
            const mats = Array.isArray(m.material) ? m.material : [m.material]
            for (const mat of mats) (mat as THREE.Material).dispose()
          }
        })
      }
      renderer.dispose()
      if (renderer.domElement.parentNode === wrap) {
        wrap.removeChild(renderer.domElement)
      }
    }
  }, [glbUrl, size])

  return <div ref={wrapRef} className="bs-editor-library-preview" style={{ width: size, height: size }} />
}
