import { useState } from 'react'
import type { BigScreenEditorApi } from '../hooks/useBigScreenEditor'
import type { SceneConfig } from '../types/vrm'
import { OCCLUDER_LIBRARY, OCCLUDER_LIBRARY_BY_ID } from '../config/sceneOccluders'
import { MAX_OCCLUDERS_PER_SCENE } from '../hooks/useBigScreenEditor.reducer'
import './BigScreenEditorOverlay.css'

interface Props {
  editor: BigScreenEditorApi
  scene: SceneConfig
  onExit: () => void
}

export default function BigScreenEditorOverlay({ editor, scene, onExit }: Props) {
  const { state } = editor
  const [libraryOpen, setLibraryOpen] = useState(false)

  const occluders = state.draft.occluders
  const groups = scene.groups ?? []
  const atOccluderLimit = occluders.length >= MAX_OCCLUDERS_PER_SCENE

  return (
    <div className="bs-editor-overlay" aria-label="BigScreen 編輯模式面板">
      {/* Header */}
      <div className="bs-editor-header">
        <span className="bs-editor-title">編輯模式</span>
        <button className="bs-editor-exit" onClick={onExit}>✕ 退出</button>
      </div>

      {/* Section: occluders */}
      <section className="bs-editor-section">
        <div className="bs-editor-section-header">
          <span>場景物件 ({occluders.length}/{MAX_OCCLUDERS_PER_SCENE})</span>
          <button
            className="bs-editor-btn-add"
            disabled={atOccluderLimit}
            onClick={() => setLibraryOpen(v => !v)}
            title={atOccluderLimit ? `每場景最多 ${MAX_OCCLUDERS_PER_SCENE} 個` : '加入物件'}
          >
            + 加入
          </button>
        </div>

        {libraryOpen && !atOccluderLimit && (
          <div className="bs-editor-library">
            {OCCLUDER_LIBRARY.length === 0 && (
              <div className="bs-editor-hint">尚未登錄任何遮罩物件(見 sceneOccluders.ts)</div>
            )}
            {OCCLUDER_LIBRARY.map(lib => (
              <button
                key={lib.id}
                className="bs-editor-library-item"
                onClick={() => { editor.addOccluder(lib.id); setLibraryOpen(false) }}
              >
                🪴 {lib.label}
              </button>
            ))}
          </div>
        )}

        {occluders.length === 0 && !libraryOpen && (
          <div className="bs-editor-hint">尚未加入物件</div>
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
            return (
              <div
                key={g.id}
                className={`bs-editor-list-item ${isSelected ? 'bs-editor-list-item--selected' : ''}`}
                onClick={() => editor.select({ kind: 'group', id: g.id })}
              >
                <span>👥 {g.label}</span>
              </div>
            )
          })}
        </section>
      )}

      {/* Transform editor & toolbar — Task 10 / Task 11 加入 */}
      <section className="bs-editor-section bs-editor-placeholder-section">
        (transform editor 待 Task 10 加入)
      </section>
    </div>
  )
}
