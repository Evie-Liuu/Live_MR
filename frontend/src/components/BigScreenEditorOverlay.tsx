import { useEffect } from 'react'
import type { BigScreenEditorApi } from '../hooks/useBigScreenEditor'
import type { SceneConfig } from '../types/vrm'
import type { GizmoHandle } from '../utils/editorGizmo'
import type { Object3D } from 'three'
import { OCCLUDER_LIBRARY, OCCLUDER_LIBRARY_BY_ID } from '../config/sceneOccluders'
import { MAX_OCCLUDERS_PER_SCENE } from '../hooks/useBigScreenEditor.reducer'
import OccluderPreview from './OccluderPreview'
import './BigScreenEditorOverlay.css'

const RAD2DEG = 180 / Math.PI
const DEG2RAD = Math.PI / 180

function NumberRow({
  label, min, max, step, value, onChange,
}: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <div className="bs-editor-row">
      <label>{label}</label>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

interface Props {
  editor: BigScreenEditorApi
  scene: SceneConfig
  onExit: () => void
  gizmoHandle: GizmoHandle | null
  occluderRoots: ReadonlyMap<string, Object3D>
}

export default function BigScreenEditorOverlay({ editor, scene, onExit, gizmoHandle, occluderRoots }: Props) {
  const { state } = editor

  useEffect(() => {
    if (!gizmoHandle) return
    const sel = state.selection
    if (sel?.kind === 'occluder') {
      const root = occluderRoots.get(sel.id) ?? null
      gizmoHandle.setTarget(root)
    } else {
      gizmoHandle.setTarget(null)
    }
  }, [gizmoHandle, occluderRoots, state.selection])

  useEffect(() => {
    gizmoHandle?.setMode(state.gizmoMode)
  }, [gizmoHandle, state.gizmoMode])

  const occluders = state.draft.occluders
  const groups = scene.groups ?? []
  const atOccluderLimit = occluders.length >= MAX_OCCLUDERS_PER_SCENE

  return (
    <>
    {/* ── Library panel (left) ──────────────────────────────────────── */}
    <aside className="bs-editor-library-panel" aria-label="素材庫">
      <div className="bs-editor-header">
        <span className="bs-editor-title">素材庫</span>
        <span className="bs-editor-count">{OCCLUDER_LIBRARY.length}</span>
      </div>
      <div className="bs-editor-library-grid">
        {OCCLUDER_LIBRARY.length === 0 && (
          <div className="bs-editor-hint">尚未登錄任何遮罩物件(見 sceneOccluders.ts)</div>
        )}
        {OCCLUDER_LIBRARY.map(lib => {
          const usedCount = occluders.filter(o => o.libraryId === lib.id).length
          return (
            <div key={lib.id} className="bs-editor-library-card">
              <OccluderPreview glbUrl={lib.glbUrl} size={140} />
              <div className="bs-editor-library-card-meta">
                <span className="bs-editor-library-card-label">{lib.label}</span>
                {usedCount > 0 && <span className="bs-editor-library-card-used">已加入 ×{usedCount}</span>}
              </div>
              <button
                className="bs-editor-btn-add bs-editor-library-card-add"
                disabled={atOccluderLimit}
                onClick={() => editor.addOccluder(lib.id)}
                title={atOccluderLimit ? `每場景最多 ${MAX_OCCLUDERS_PER_SCENE} 個` : '加入到當前場景'}
              >
                + 加入
              </button>
            </div>
          )
        })}
      </div>
      {atOccluderLimit && (
        <div className="bs-editor-hint">已達上限 {MAX_OCCLUDERS_PER_SCENE} 個 — 請先刪除一些再加入</div>
      )}
    </aside>

    {/* ── Right overlay: 場景物件 + 群組 + 變換 ─────────────────────── */}
    <div className="bs-editor-overlay" aria-label="BigScreen 編輯模式面板">
      {/* Header */}
      <div className="bs-editor-header">
        <span className="bs-editor-title">編輯模式</span>
        <button className="bs-editor-exit" onClick={onExit}>✕ 退出</button>
      </div>

      {/* Toolbar */}
      <div className="bs-editor-toolbar">
        {editor.state.selection?.kind === 'occluder' && (
          <>
            <button
              className={`bs-editor-tb-btn ${editor.state.gizmoMode === 'translate' ? 'bs-editor-tb-btn--active' : ''}`}
              onClick={() => editor.setGizmoMode('translate')}
              title="移動 (Translate)"
            >↔</button>
            <button
              className={`bs-editor-tb-btn ${editor.state.gizmoMode === 'rotate' ? 'bs-editor-tb-btn--active' : ''}`}
              onClick={() => editor.setGizmoMode('rotate')}
              title="旋轉 (Rotate)"
            >↻</button>
            <span className="bs-editor-tb-sep" />
          </>
        )}
        <button className="bs-editor-tb-btn" disabled={editor.state.past.length === 0} onClick={editor.undo} title="Undo (Ctrl+Z)">↶</button>
        <button className="bs-editor-tb-btn" disabled={editor.state.future.length === 0} onClick={editor.redo} title="Redo (Ctrl+Shift+Z)">↷</button>
      </div>

      {/* Section: occluders(僅顯示已加入;新增請至左側素材庫) */}
      <section className="bs-editor-section">
        <div className="bs-editor-section-header">
          <span>場景物件 ({occluders.length}/{MAX_OCCLUDERS_PER_SCENE})</span>
        </div>

        {occluders.length === 0 && (
          <div className="bs-editor-hint">尚未加入物件 — 從左側素材庫挑選</div>
        )}

        {occluders.map((inst, idx) => {
          const lib = OCCLUDER_LIBRARY_BY_ID[inst.libraryId]
          const isSelected = state.selection?.kind === 'occluder' && state.selection.id === inst.instanceId
          const sameLibBefore = occluders.slice(0, idx).filter(i => i.libraryId === inst.libraryId).length + 1
          return (
            <div
              key={inst.instanceId}
              className={`bs-editor-list-item ${isSelected ? 'bs-editor-list-item--selected' : ''}`}
              onClick={() => editor.select({ kind: 'occluder', id: inst.instanceId })}
            >
              <span>{lib ? `🪴 ${lib.label}` : '⚠ (已失效)'} <span className="bs-editor-item-suffix">#{sameLibBefore}</span></span>
              <button
                className="bs-editor-item-delete"
                onClick={(e) => { e.stopPropagation(); editor.deleteOccluder(inst.instanceId) }}
              >×</button>
            </div>
          )
        })}
      </section>

      {/* Section: groups */}
      {groups.length > 0 && (
        <section className="bs-editor-section">
          <div className="bs-editor-section-header"><span>角色群組 ({groups.length})</span></div>
          {groups.map(g => {
            const isSelected = state.selection?.kind === 'group' && state.selection.id === g.id
            const isHidden = !!state.draft.groupHidden[g.id]
            return (
              <div
                key={g.id}
                className={`bs-editor-list-item ${isSelected ? 'bs-editor-list-item--selected' : ''} ${isHidden ? 'bs-editor-list-item--hidden' : ''}`}
                onClick={() => editor.select({ kind: 'group', id: g.id })}
              >
                <span>👥 {g.label}</span>
                <button
                  className="bs-editor-item-vis"
                  title={isHidden ? '顯示此群組' : '隱藏此群組'}
                  onClick={(e) => { e.stopPropagation(); editor.toggleGroupHidden(g.id) }}
                >
                  {isHidden ? '🙈' : '👁'}
                </button>
              </div>
            )
          })}
        </section>
      )}

      <OccluderEditor editor={editor} />
      <GroupEditor editor={editor} scene={scene} />

      <section className="bs-editor-footer">
        {editor.state.dirty && <div className="bs-editor-dirty-hint">⚠ 未保存變動</div>}
        <button
          className="bs-editor-btn-primary"
          disabled={!editor.state.dirty}
          onClick={editor.commit}
        >💾 保存</button>
        <button
          className="bs-editor-btn-secondary"
          onClick={() => { if (confirm('將清除此場景所有自訂(物件實例 + 群組變換)。確定?')) editor.resetScene() }}
        >↺ 場景重置</button>
      </section>
    </div>
    </>
  )
}

function OccluderEditor({ editor }: { editor: BigScreenEditorApi }) {
  const sel = editor.state.selection
  if (sel?.kind !== 'occluder') return null
  const inst = editor.state.draft.occluders.find(o => o.instanceId === sel.id)
  if (!inst) return null
  const lib = OCCLUDER_LIBRARY_BY_ID[inst.libraryId]
  const update = (patch: Partial<typeof inst>) => editor.updateOccluder(inst.instanceId, patch)
  return (
    <section className="bs-editor-section">
      <div className="bs-editor-section-header"><span>選中變換 — {lib?.label ?? '(已失效)'}</span></div>
      <NumberRow label="X" min={-5} max={5} step={0.05}
        value={inst.position[0]} onChange={v => update({ position: [v, inst.position[1], inst.position[2]] })} />
      <NumberRow label="Y" min={-5} max={5} step={0.05}
        value={inst.position[1]} onChange={v => update({ position: [inst.position[0], v, inst.position[2]] })} />
      <NumberRow label="Z" min={-5} max={5} step={0.05}
        value={inst.position[2]} onChange={v => update({ position: [inst.position[0], inst.position[1], v] })} />
      <NumberRow label="Yaw(°)" min={-180} max={180} step={1}
        value={Math.round(inst.rotation[1] * RAD2DEG * 100) / 100}
        onChange={deg => update({ rotation: [inst.rotation[0], deg * DEG2RAD, inst.rotation[2]] })} />
      <NumberRow label="Scale" min={0.1} max={5} step={0.05}
        value={inst.scale} onChange={v => update({ scale: v })} />
      <div className="bs-editor-actions">
        <button className="bs-editor-btn-secondary" onClick={() => editor.resetItem('occluder', inst.instanceId)}>↺ 單一重置</button>
        <button className="bs-editor-btn-secondary" onClick={() => editor.duplicateOccluder(inst.instanceId)}>⎘ 複製</button>
        <button className="bs-editor-btn-danger" onClick={() => editor.deleteOccluder(inst.instanceId)}>🗑 刪除</button>
      </div>
    </section>
  )
}

function GroupEditor({ editor, scene }: { editor: BigScreenEditorApi; scene: SceneConfig }) {
  const sel = editor.state.selection
  if (sel?.kind !== 'group') return null
  const g = scene.groups?.find(x => x.id === sel.id)
  if (!g) return null
  const t = editor.state.draft.groupTransforms[g.id] ?? { pos: [0, 0, 0] as [number, number, number], rot: [0, 0, 0] as [number, number, number] }
  const setT = (next: typeof t) => editor.updateGroup(g.id, next)
  return (
    <section className="bs-editor-section">
      <div className="bs-editor-section-header"><span>選中變換 — {g.label}</span></div>
      <NumberRow label="X" min={-5} max={5} step={0.05}
        value={t.pos[0]} onChange={v => setT({ ...t, pos: [v, t.pos[1], t.pos[2]] })} />
      <NumberRow label="Y" min={-5} max={5} step={0.05}
        value={t.pos[1]} onChange={v => setT({ ...t, pos: [t.pos[0], v, t.pos[2]] })} />
      <NumberRow label="Z" min={-5} max={5} step={0.05}
        value={t.pos[2]} onChange={v => setT({ ...t, pos: [t.pos[0], t.pos[1], v] })} />
      <NumberRow label="Pitch(°)" min={-180} max={180} step={1}
        value={Math.round(t.rot[0] * RAD2DEG * 100) / 100}
        onChange={deg => setT({ ...t, rot: [deg * DEG2RAD, t.rot[1], t.rot[2]] })} />
      <NumberRow label="Yaw(°)" min={-180} max={180} step={1}
        value={Math.round(t.rot[1] * RAD2DEG * 100) / 100}
        onChange={deg => setT({ ...t, rot: [t.rot[0], deg * DEG2RAD, t.rot[2]] })} />
      <NumberRow label="Roll(°)" min={-180} max={180} step={1}
        value={Math.round(t.rot[2] * RAD2DEG * 100) / 100}
        onChange={deg => setT({ ...t, rot: [t.rot[0], t.rot[1], deg * DEG2RAD] })} />
      <div className="bs-editor-actions">
        <button className="bs-editor-btn-secondary" onClick={() => editor.resetItem('group', g.id)}>↺ 單一重置</button>
      </div>
    </section>
  )
}
