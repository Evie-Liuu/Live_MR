import { useEffect, useRef, useState } from 'react'
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

/** 群組固定 chip 色:依出現順序依序取,循環使用。 */
const GROUP_CHIP_COLORS = ['#f76e12', '#1fb7a5', '#5aa1e8', '#a16cd6', '#f5b942', '#e25688']

function NumberRow({
  label, min, max, step, value, onChange, accent,
}: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; accent?: string }) {
  const display = Number.isFinite(value) ? Math.round(value * 100) / 100 : 0
  return (
    <div className="bs-editor-row">
      <label>{label}</label>
      <input
        type="range" min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={accent ? { accentColor: accent } : undefined}
      />
      <input
        className="bs-editor-row-num"
        type="number" step={step} value={display}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

export type BgTypeOverride = 'default' | 'none' | 'camera'

interface Props {
  editor: BigScreenEditorApi
  scene: SceneConfig
  onExit: () => void
  gizmoHandle: GizmoHandle | null
  occluderRoots: ReadonlyMap<string, Object3D>
  /** 背景來源:相機 deviceId(空字串 = 預設相機)。 */
  cameraBgDeviceId: string
  onCameraBgDeviceChange: (deviceId: string) => void
  /** 場景背景類型覆蓋(default = 依場景設定)。 */
  bgTypeOverride: BgTypeOverride
  onBgTypeOverrideChange: (v: BgTypeOverride) => void
  /** true 時播放退場動畫;由父層在 unmount 前短暫設為 true。 */
  exiting?: boolean
}

export function ConfirmModal({ title, message, confirmLabel = '確定', onConfirm, onCancel }: {
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="bs-confirm-backdrop" onClick={onCancel}>
      <div className="bs-confirm-dialog" onClick={e => e.stopPropagation()}>
        <div className="bs-confirm-icon">
          <span className="material-symbols-outlined">warning</span>
        </div>
        <div className="bs-confirm-title">{title}</div>
        <div className="bs-confirm-body">{message}</div>
        <div className="bs-confirm-actions">
          <button className="bs-confirm-btn-cancel" onClick={onCancel}>取消</button>
          <button className="bs-confirm-btn-danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

export default function BigScreenEditorOverlay({
  editor, scene, onExit, gizmoHandle, occluderRoots,
  cameraBgDeviceId, onCameraBgDeviceChange,
  bgTypeOverride, onBgTypeOverrideChange,
  exiting,
}: Props) {
  const { state } = editor
  const [showResetConfirm, setShowResetConfirm] = useState(false)

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

  // 列表 tab 切換 — 同時跟著 selection 自動切到對應 tab
  const [tab, setTab] = useState<'objects' | 'groups'>('objects')
  useEffect(() => {
    if (state.selection?.kind === 'occluder') setTab('objects')
    else if (state.selection?.kind === 'group') setTab('groups')
  }, [state.selection])

  // 左側 tab:素材庫 / 背景來源(null = 收起)— 改由 hover 觸發
  const [leftTab, setLeftTab] = useState<'library' | 'bg' | null>(null)
  // 移開到 rail/panel 外才關;短延遲讓滑鼠跨過 rail→panel 的間隙
  const closeTimerRef = useRef<number | null>(null)
  const cancelClose = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }
  const scheduleClose = () => {
    cancelClose()
    closeTimerRef.current = window.setTimeout(() => {
      setLeftTab(null)
      closeTimerRef.current = null
    }, 200)
  }
  const openLeftTab = (t: 'library' | 'bg') => {
    cancelClose()
    setLeftTab(t)
  }
  useEffect(() => () => cancelClose(), [])

  return (
    <>
      {/* ── Left rail:icon 工具列(永遠顯示) ───────────────────────── */}
      <aside
        className={`bs-editor-rail ${exiting ? 'bs-editor-rail--exiting' : ''}`}
        aria-label="編輯工具列"
        onMouseLeave={scheduleClose}
      >
        <button
          className={`bs-editor-rail-btn ${leftTab === 'bg' ? 'bs-editor-rail-btn--active' : ''}`}
          onMouseEnter={() => openLeftTab('bg')}
          onFocus={() => openLeftTab('bg')}
          title="背景來源"
        >
          <span className="material-symbols-outlined bs-editor-rail-icon" aria-hidden>image</span>
          <span className="bs-editor-rail-label">背景</span>
        </button>
        <button
          className={`bs-editor-rail-btn ${leftTab === 'library' ? 'bs-editor-rail-btn--active' : ''}`}
          onMouseEnter={() => openLeftTab('library')}
          onFocus={() => openLeftTab('library')}
          title="素材庫"
        >
          <span className="material-symbols-outlined bs-editor-rail-icon" aria-hidden>stacks</span>
          <span className="bs-editor-rail-label">素材庫</span>
        </button>
      </aside>

      {/* ── Left content:hover rail 後展開,移到面板上會持續顯示 ───── */}
      {leftTab && (
        <aside
          className={`bs-editor-library-panel ${exiting ? 'bs-editor-library-panel--exiting' : ''}`}
          aria-label={leftTab === 'library' ? '素材庫' : '背景來源'}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className="bs-editor-header">
            <span className="bs-editor-title">{leftTab === 'library' ? '素材庫' : '背景來源'}</span>
            <button className="bs-editor-exit" onClick={() => setLeftTab(null)}>✕</button>
          </div>

          {leftTab === 'library' && (
            <>
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
            </>
          )}

          {leftTab === 'bg' && (
            <BgSourceTab
              deviceId={cameraBgDeviceId}
              onDeviceChange={onCameraBgDeviceChange}
              bgType={bgTypeOverride}
              onBgTypeChange={onBgTypeOverrideChange}
              scene={scene}
            />
          )}
        </aside>
      )}

      {showResetConfirm && (
        <ConfirmModal
          title="確認場景重置"
          message="將清除此場景所有自訂（物件實例＋群組變換），此操作不可復原。"
          confirmLabel="確定重置"
          onConfirm={() => { setShowResetConfirm(false); editor.resetScene() }}
          onCancel={() => setShowResetConfirm(false)}
        />
      )}

      {/* ── Right overlay: 場景物件 + 群組 + 變換 ─────────────────────── */}
      <div
        className={`bs-editor-overlay ${exiting ? 'bs-editor-overlay--exiting' : ''}`}
        aria-label="BigScreen 編輯模式面板"
      >
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

        {/* Tab 切換:場景物件 / 角色群組 — 固定高度,不影響下方變換 bar */}
        <div className="bs-editor-tabs">
          <button
            className={`bs-editor-tab ${tab === 'objects' ? 'bs-editor-tab--active' : ''}`}
            onClick={() => setTab('objects')}
          >
            場景物件 <span className="bs-editor-tab-count">{occluders.length}/{MAX_OCCLUDERS_PER_SCENE}</span>
          </button>
          <button
            className={`bs-editor-tab ${tab === 'groups' ? 'bs-editor-tab--active' : ''}`}
            onClick={() => setTab('groups')}
            disabled={groups.length === 0}
          >
            角色群組 <span className="bs-editor-tab-count">{groups.length}</span>
          </button>
        </div>

        <section className="bs-editor-tabpane">
          {tab === 'objects' && (
            <>
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
                    <span className="flex items-center gap-2">{lib ? <><span className="material-symbols-outlined">view_in_ar</span> {lib.label}</> : '⚠ (已失效)'} <span className="bs-editor-item-suffix">#{sameLibBefore}</span></span>
                    <button
                      className="bs-editor-item-delete"
                      onClick={(e) => { e.stopPropagation(); editor.deleteOccluder(inst.instanceId) }}
                    >×</button>
                  </div>
                )
              })}
            </>
          )}

          {tab === 'groups' && (
            <>
              {groups.length === 0 && (
                <div className="bs-editor-hint">此場景沒有定義角色群組</div>
              )}
              <div className="bs-editor-group-list">
                {groups.map((g, idx) => {
                  const isSelected = state.selection?.kind === 'group' && state.selection.id === g.id
                  const isHidden = !!state.draft.groupHidden[g.id]
                  const color = GROUP_CHIP_COLORS[idx % GROUP_CHIP_COLORS.length]
                  const memberCount = g.members.length
                  return (
                    <div
                      key={g.id}
                      className={`bs-editor-group-card ${isSelected ? 'bs-editor-group-card--selected' : ''} ${isHidden ? 'bs-editor-group-card--hidden' : ''}`}
                      onClick={() => editor.select({ kind: 'group', id: g.id })}
                      style={isSelected ? { borderColor: color } : undefined}
                    >
                      <span className="bs-editor-group-chip" style={{ background: color }} aria-hidden />
                      <div className="bs-editor-group-meta">
                        <span className="bs-editor-group-label">{g.label}</span>
                        <span className="bs-editor-group-sub">{memberCount} 個成員</span>
                      </div>
                      <button
                        className="bs-editor-group-vis"
                        title={isHidden ? '顯示此群組' : '隱藏此群組'}
                        onClick={(e) => { e.stopPropagation(); editor.toggleGroupHidden(g.id) }}
                      >
                        {isHidden ? '🙈' : '👁'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </section>

        <OccluderEditor editor={editor} />
        <GroupEditor editor={editor} scene={scene} groups={groups} />

        <section className="bs-editor-footer">
          {editor.state.dirty && <div className="bs-editor-dirty-hint">⚠ 未保存變動</div>}
          <button
            className="bs-editor-btn-primary"
            disabled={!editor.state.dirty}
            onClick={editor.commit}
          >保存</button>
          <button
            className="bs-editor-btn-secondary"
            onClick={() => setShowResetConfirm(true)}
          >↺ 場景重置</button>
        </section>
      </div>
    </>
  )
}

function BgSourceTab({
  deviceId, onDeviceChange, bgType, onBgTypeChange, scene,
}: {
  deviceId: string
  onDeviceChange: (id: string) => void
  bgType: BgTypeOverride
  onBgTypeChange: (v: BgTypeOverride) => void
  scene: SceneConfig
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])

  const refreshDevices = async () => {
    try {
      let probe: MediaStream | null = null
      try {
        const all = await navigator.mediaDevices.enumerateDevices()
        if (!all.some(d => d.kind === 'videoinput' && d.label)) {
          probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        }
      } catch { /* ignore — labels may stay generic */ }
      const list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput')
      if (probe) probe.getTracks().forEach(t => t.stop())
      setDevices(list)
    } catch (err) {
      console.warn('[BgSourceTab] enumerateDevices failed:', err)
    }
  }

  useEffect(() => {
    let cancelled = false
    const wrap = async () => { if (!cancelled) await refreshDevices() }
    wrap()
    navigator.mediaDevices.addEventListener?.('devicechange', wrap)
    return () => {
      cancelled = true
      navigator.mediaDevices.removeEventListener?.('devicechange', wrap)
    }
  }, [])

  const cards: {
    value: BgTypeOverride
    title: string
    desc: string
    icon: string
    preview: React.ReactNode
  }[] = [
      {
        value: 'default',
        title: '預設場景',
        desc: '使用系統提供的場景',
        icon: 'image',
        preview: scene.backgroundType === 'image' && scene.backgroundValue
          ? <img src={scene.backgroundValue} alt="" />
          : <div className="bs-editor-bg-preview-fallback">{scene.label ?? '預設'}</div>,
      },
      {
        value: 'camera',
        title: '相機背景',
        desc: '使用攝影機即時畫面',
        icon: 'videocam',
        preview: (
          <div className="bs-editor-bg-preview-camera">
            <span className="material-symbols-outlined">videocam</span>
          </div>
        ),
      },
      {
        value: 'none',
        title: '無背景',
        desc: '使用純色背景',
        icon: 'block',
        preview: <div className="bs-editor-bg-preview-none" />,
      },
    ]

  const selectedDevice = devices.find(d => d.deviceId === deviceId)

  return (
    <div className="bs-editor-bg-pane">
      <div className="bs-editor-bg-section-label">選擇背景類型</div>
      <div className="bs-editor-bg-cards">
        {cards.map(c => {
          const active = bgType === c.value
          return (
            <button
              key={c.value}
              className={`bs-editor-bg-card ${active ? 'bs-editor-bg-card--active' : ''}`}
              onClick={() => onBgTypeChange(c.value)}
            >
              <div className="bs-editor-bg-card-preview">
                {c.preview}
                {active && (
                  <span className="bs-editor-bg-card-check material-symbols-outlined">check_circle</span>
                )}
              </div>
              <div className="bs-editor-bg-card-meta">
                <div className="bs-editor-bg-card-title">
                  <span className="material-symbols-outlined">{c.icon}</span>
                  {c.title}
                </div>
                <div className="bs-editor-bg-card-desc">{c.desc}</div>
                {active && <div className="bs-editor-bg-card-status">目前使用中</div>}
              </div>
            </button>
          )
        })}
      </div>

      <div className="bs-editor-bg-section-label">相機設定</div>
      <div className="bs-editor-bg-device-row">
        <label className="bs-editor-bg-device-label">使用裝置</label>
        <button
          className="bs-editor-bg-refresh"
          onClick={refreshDevices}
          title="重新列舉裝置"
        >
          <span className="material-symbols-outlined">refresh</span>
        </button>
      </div>
      <select
        className="bs-editor-bg-select"
        value={deviceId}
        onChange={(e) => onDeviceChange(e.target.value)}
        disabled={bgType !== 'camera'}
      >
        <option value="">— 預設相機 —</option>
        {devices.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || `Camera ${i + 1}`}
          </option>
        ))}
      </select>
      {bgType === 'camera' && selectedDevice && (
        <div className="bs-editor-bg-device-current">{selectedDevice.label || '預設相機'}</div>
      )}
      {bgType !== 'camera' && (
        <div className="bs-editor-hint">切換到「相機背景」才會啟用裝置選擇</div>
      )}
    </div>
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
      <div style={{ textAlign: 'left', marginLeft: 8 }}>位置</div>
      <NumberRow label="X" min={-5} max={5} step={0.05}
        value={inst.position[0]} onChange={v => update({ position: [v, inst.position[1], inst.position[2]] })} />
      <NumberRow label="Y" min={-5} max={5} step={0.05}
        value={inst.position[1]} onChange={v => update({ position: [inst.position[0], v, inst.position[2]] })} />
      <NumberRow label="Z" min={-5} max={5} step={0.05}
        value={inst.position[2]} onChange={v => update({ position: [inst.position[0], inst.position[1], v] })} />
      <div style={{ textAlign: 'left', marginLeft: 8 }}>旋轉 (°)</div>
      <NumberRow label="俯仰角" min={-180} max={180} step={1}
        value={Math.round(inst.rotation[0] * RAD2DEG * 100) / 100}
        onChange={deg => update({ rotation: [deg * DEG2RAD, inst.rotation[1], inst.rotation[2]] })} />
      <div style={{ textAlign: 'left', marginLeft: 8 }}>縮放</div>
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

function GroupEditor({ editor, scene, groups }: { editor: BigScreenEditorApi; scene: SceneConfig; groups: NonNullable<SceneConfig['groups']> }) {
  const sel = editor.state.selection
  if (sel?.kind !== 'group') return null
  const idx = groups.findIndex(x => x.id === sel.id)
  const g = idx >= 0 ? groups[idx] : scene.groups?.find(x => x.id === sel.id)
  if (!g) return null
  const accent = GROUP_CHIP_COLORS[(idx >= 0 ? idx : 0) % GROUP_CHIP_COLORS.length]
  const t = editor.state.draft.groupTransforms[g.id] ?? { pos: [0, 0, 0] as [number, number, number], rot: [0, 0, 0] as [number, number, number] }
  const setT = (next: typeof t) => editor.updateGroup(g.id, next)
  return (
    <section className="bs-editor-section">
      <div className="bs-editor-section-header">
        <span>選中變換 — <span style={{ color: accent }}>{g.label}</span></span>
      </div>
      <div style={{ textAlign: 'left', marginLeft: 8 }}>位置</div>
      <NumberRow label="X" min={-5} max={5} step={0.05} accent={accent}
        value={t.pos[0]} onChange={v => setT({ ...t, pos: [v, t.pos[1], t.pos[2]] })} />
      <NumberRow label="Y" min={-5} max={5} step={0.05} accent={accent}
        value={t.pos[1]} onChange={v => setT({ ...t, pos: [t.pos[0], v, t.pos[2]] })} />
      <NumberRow label="Z" min={-5} max={5} step={0.05} accent={accent}
        value={t.pos[2]} onChange={v => setT({ ...t, pos: [t.pos[0], t.pos[1], v] })} />
      <div style={{ textAlign: 'left', marginLeft: 8 }}>旋轉 (°)</div>
      <NumberRow label="俯仰角" min={-180} max={180} step={1} accent={accent}
        value={t.rot[0] * RAD2DEG}
        onChange={deg => setT({ ...t, rot: [deg * DEG2RAD, t.rot[1], t.rot[2]] })} />
      {/* <NumberRow label="Yaw(°)" min={-180} max={180} step={1} accent={accent}
        value={t.rot[1] * RAD2DEG}
        onChange={deg => setT({ ...t, rot: [t.rot[0], deg * DEG2RAD, t.rot[2]] })} />
      <NumberRow label="Roll(°)" min={-180} max={180} step={1} accent={accent}
        value={t.rot[2] * RAD2DEG}
        onChange={deg => setT({ ...t, rot: [t.rot[0], t.rot[1], deg * DEG2RAD] })} /> */}
      <div className="bs-editor-actions">
        <button className="bs-editor-btn-secondary" onClick={() => editor.resetItem('group', g.id)}>↺ 單一重置</button>
      </div>
    </section>
  )
}
