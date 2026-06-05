/**
 * SceneOccludersPanel.tsx
 *
 * 教師端 drawer:在當前場景中加入/編輯/刪除「遮罩物件」。
 * 視覺語言沿用 SceneEditor(.panel-drawer / .scene-editor-section / .scene-editor-row)。
 *
 * 行為:
 *  - 物件庫列表(OCCLUDER_LIBRARY)每項有 [+ 加入] — 達 MAX_PER_SCENE 上限時 disabled。
 *  - 已加入列表每列可點擊選中,選中項才顯示變換區。
 *  - 變換區:X/Y/Z 位置 / Y 軸旋轉(度) / 單值 scale / 複製 / 刪除。
 *  - 任何變動(加 / 改 / 刪 / 複製)立即透過 onChange 回呼,
 *    由父層(HostSession)寫 localStorage + 廣播 'occluders-set'。
 *  - libraryId 找不到對應 library item → 顯示「(已失效)」,只能刪。
 */
import { useEffect, useState } from 'react'
import { OCCLUDER_LIBRARY, OCCLUDER_LIBRARY_BY_ID } from '../config/sceneOccluders'
import type { SceneOccluderInstance } from '../types/sceneOccluder'
import { defaultOccluderTransform } from '../utils/occluderDefaults'

export const MAX_OCCLUDERS_PER_SCENE = 10

interface SceneOccludersPanelProps {
  sceneId: string
  instances: SceneOccluderInstance[]
  onChange: (next: SceneOccluderInstance[]) => void
  open: boolean
  onClose: () => void
}

const RAD2DEG = 180 / Math.PI
const DEG2RAD = Math.PI / 180


export default function SceneOccludersPanel({
  sceneId,
  instances,
  onChange,
  open,
  onClose,
}: SceneOccludersPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // 切場景或實例被外部刪除時清除選中
  useEffect(() => {
    if (selectedId && !instances.some((i) => i.instanceId === selectedId)) {
      setSelectedId(null)
    }
  }, [instances, selectedId])
  useEffect(() => { setSelectedId(null) }, [sceneId])

  const selected = selectedId ? instances.find((i) => i.instanceId === selectedId) ?? null : null
  const atLimit = instances.length >= MAX_OCCLUDERS_PER_SCENE

  // ── 操作 helpers ─────────────────────────────────────────────────────────
  const addFromLibrary = (libraryId: string) => {
    if (atLimit) return
    const lib = OCCLUDER_LIBRARY_BY_ID[libraryId]
    if (!lib) return
    const t = defaultOccluderTransform(libraryId)
    const instance: SceneOccluderInstance = {
      instanceId: crypto.randomUUID(),
      libraryId,
      ...t,
    }
    onChange([...instances, instance])
    setSelectedId(instance.instanceId)
  }

  const updateSelected = (patch: Partial<SceneOccluderInstance>) => {
    if (!selected) return
    onChange(instances.map((i) => (i.instanceId === selected.instanceId ? { ...i, ...patch } : i)))
  }

  const deleteInstance = (instanceId: string) => {
    onChange(instances.filter((i) => i.instanceId !== instanceId))
    if (selectedId === instanceId) setSelectedId(null)
  }

  const duplicateSelected = () => {
    if (!selected || atLimit) return
    // 偏移微距(0.3m)以便分辨
    const dup: SceneOccluderInstance = {
      ...selected,
      instanceId: crypto.randomUUID(),
      position: [selected.position[0] + 0.3, selected.position[1], selected.position[2] + 0.3],
    }
    onChange([...instances, dup])
    setSelectedId(dup.instanceId)
  }

  const onPosChange = (axis: 0 | 1 | 2, value: number) => {
    if (!selected) return
    const next = [...selected.position] as [number, number, number]
    next[axis] = value
    updateSelected({ position: next })
  }

  const onYawChangeDeg = (deg: number) => {
    if (!selected) return
    const next: [number, number, number] = [selected.rotation[0], deg * DEG2RAD, selected.rotation[2]]
    updateSelected({ rotation: next })
  }

  const onScaleChange = (value: number) => {
    if (!selected) return
    updateSelected({ scale: value })
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className={`panel-drawer ${open ? 'panel-drawer--open' : ''}`}>
      <div className="panel-drawer-header">
        <div className="slot-drawer-title">
          <span className="orange">場景物件</span>{' '}
          <span className="teal">遮罩編輯</span>
        </div>
        <div className="scene-editor-hint" style={{ marginRight: 8, fontSize: 11 }}>
          💡 在大屏編輯模式可整合調整
        </div>
        <button className="panel-close-btn" onClick={onClose}>✕</button>
      </div>
      <div className="panel-drawer-body">

        {/* 物件庫 */}
        <fieldset className="scene-editor-section">
          <legend>物件庫</legend>
          {OCCLUDER_LIBRARY.length === 0 && (
            <div className="scene-editor-hint">
              尚未登錄任何遮罩物件 — 請於 <code>src/config/sceneOccluders.ts</code> 補上 OCCLUDER_LIBRARY,並把對應的 GLB 放在 <code>/public/models/occluders/</code>。
            </div>
          )}
          {OCCLUDER_LIBRARY.map((lib) => {
            const usedCount = instances.filter((i) => i.libraryId === lib.id).length
            return (
              <div key={lib.id} className="scene-editor-row" style={{ gridTemplateColumns: '1fr auto' }}>
                <span>
                  🪴 {lib.label}
                  {usedCount > 0 && <span style={{ opacity: 0.55, marginLeft: 6 }}>×{usedCount}</span>}
                </span>
                <button
                  className="scene-editor-btn-save"
                  disabled={atLimit}
                  title={atLimit ? `每場景最多 ${MAX_OCCLUDERS_PER_SCENE} 個` : '加入到當前場景'}
                  onClick={() => addFromLibrary(lib.id)}
                >
                  + 加入
                </button>
              </div>
            )
          })}
          {atLimit && (
            <div className="scene-editor-hint">
              已達上限 {MAX_OCCLUDERS_PER_SCENE} 個 — 請先刪除一些再加入。
            </div>
          )}
        </fieldset>

        {/* 已加入列表 */}
        <fieldset className="scene-editor-section">
          <legend>已加入 ({instances.length}/{MAX_OCCLUDERS_PER_SCENE})</legend>
          {instances.length === 0 && (
            <div className="scene-editor-hint">此場景尚未加入任何遮罩物件。</div>
          )}
          {instances.map((inst, idx) => {
            const lib = OCCLUDER_LIBRARY_BY_ID[inst.libraryId]
            const isSelected = selectedId === inst.instanceId
            // 同 library 第幾個
            const sameLibBefore = instances
              .slice(0, idx)
              .filter((i) => i.libraryId === inst.libraryId).length + 1
            return (
              <div
                key={inst.instanceId}
                className="scene-editor-row"
                style={{
                  gridTemplateColumns: '1fr auto',
                  background: isSelected ? 'rgba(247, 110, 18, 0.12)' : undefined,
                  borderRadius: 6,
                  padding: '4px 6px',
                  cursor: 'pointer',
                }}
                onClick={() => setSelectedId(inst.instanceId)}
              >
                <span>
                  {lib ? `🪴 ${lib.label}` : '⚠️ (已失效)'}
                  <span style={{ opacity: 0.55, marginLeft: 6 }}>#{sameLibBefore}</span>
                </span>
                <button
                  className="scene-editor-btn-reset"
                  onClick={(e) => { e.stopPropagation(); deleteInstance(inst.instanceId) }}
                  title="刪除"
                >
                  ×
                </button>
              </div>
            )
          })}
        </fieldset>

        {/* 變換區(僅選中時) */}
        {selected && (
          <>
            <fieldset className="scene-editor-section">
              <legend>位置 (m)</legend>
              {(['X', 'Y', 'Z'] as const).map((label, i) => (
                <div key={label} className="scene-editor-row">
                  <label>{label}</label>
                  <input
                    type="range" min={-5} max={5} step={0.05}
                    value={selected.position[i as 0 | 1 | 2]}
                    onChange={(e) => onPosChange(i as 0 | 1 | 2, Number(e.target.value))}
                  />
                  <input
                    type="number" step={0.05}
                    value={selected.position[i as 0 | 1 | 2]}
                    onChange={(e) => onPosChange(i as 0 | 1 | 2, Number(e.target.value))}
                  />
                </div>
              ))}
            </fieldset>

            <fieldset className="scene-editor-section">
              <legend>旋轉 (°) — Yaw</legend>
              <div className="scene-editor-row">
                <label>Yaw</label>
                <input
                  type="range" min={-180} max={180} step={1}
                  value={selected.rotation[1] * RAD2DEG}
                  onChange={(e) => onYawChangeDeg(Number(e.target.value))}
                />
                <input
                  type="number" step={1}
                  value={Math.round(selected.rotation[1] * RAD2DEG * 100) / 100}
                  onChange={(e) => onYawChangeDeg(Number(e.target.value))}
                />
              </div>
            </fieldset>

            <fieldset className="scene-editor-section">
              <legend>縮放 (uniform)</legend>
              <div className="scene-editor-row">
                <label>Scale</label>
                <input
                  type="range" min={0.1} max={5} step={0.05}
                  value={selected.scale}
                  onChange={(e) => onScaleChange(Number(e.target.value))}
                />
                <input
                  type="number" step={0.05} min={0.1}
                  value={selected.scale}
                  onChange={(e) => onScaleChange(Number(e.target.value))}
                />
              </div>
            </fieldset>

            <div className="scene-editor-actions">
              <button
                className="scene-editor-btn-reset"
                onClick={() => deleteInstance(selected.instanceId)}
              >
                刪除
              </button>
              <button
                className="scene-editor-btn-save"
                disabled={atLimit}
                onClick={duplicateSelected}
              >
                複製
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
