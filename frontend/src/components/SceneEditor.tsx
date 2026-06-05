import { useState, useEffect } from 'react';
import type { GroupConfig } from '../types/vrm';

type Vec3 = [number, number, number];

interface SceneEditorProps {
  sceneId: string;
  group: GroupConfig;
  channel: BroadcastChannel | null;
  open: boolean;
  onClose: () => void;
}

interface Transform {
  pos: Vec3;
  rot: Vec3; // radian
}

const ZERO: Transform = { pos: [0, 0, 0], rot: [0, 0, 0] };
const STORAGE_KEY = 'bigscreen-group-transforms';

function loadStored(sceneId: string, groupId: string): Transform {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, Record<string, Transform>>;
    return all[sceneId]?.[groupId] ?? ZERO;
  } catch { return ZERO; }
}

function saveStored(sceneId: string, groupId: string, t: Transform) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, Record<string, Transform>>;
    all[sceneId] = all[sceneId] ?? {};
    all[sceneId][groupId] = t;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch (e) {
    console.warn('[SceneEditor] save failed:', e);
  }
}

function deleteStored(sceneId: string, groupId: string) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, Record<string, Transform>>;
    if (all[sceneId]) {
      delete all[sceneId][groupId];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    }
  } catch (e) {
    console.warn('[SceneEditor] delete failed:', e);
  }
}

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

export default function SceneEditor({ sceneId, group, channel, open, onClose }: SceneEditorProps) {
  const [t, setT] = useState<Transform>(() => loadStored(sceneId, group.id));

  useEffect(() => {
    setT(loadStored(sceneId, group.id));
  }, [sceneId, group.id]);

  const broadcast = (next: Transform) => {
    channel?.postMessage({
      type: 'group-transform',
      groupId: group.id,
      groupTransform: { pos: next.pos, rot: next.rot },
    });
  };

  const onPosChange = (axis: 0 | 1 | 2, value: number) => {
    const next: Transform = { ...t, pos: [...t.pos] as Vec3 };
    next.pos[axis] = value;
    setT(next);
    broadcast(next);
  };

  const onRotChangeDeg = (axis: 0 | 1 | 2, degValue: number) => {
    const next: Transform = { ...t, rot: [...t.rot] as Vec3 };
    next.rot[axis] = degValue * DEG2RAD;
    setT(next);
    broadcast(next);
  };

  const onSave = () => { saveStored(sceneId, group.id, t); };
  const onReset = () => {
    setT(ZERO);
    deleteStored(sceneId, group.id);
    broadcast(ZERO);
  };

  const hasSlotMember = group.members.some(m => m.kind === 'slot');

  return (
    <div className={`panel-drawer ${open ? 'panel-drawer--open' : ''}`}>
      <div className="panel-drawer-header">
        <div className="slot-drawer-title">
          <span className="orange">場景編輯</span> <span className="teal">{group.label}</span>
        </div>
        <div className="scene-editor-hint" style={{ marginRight: 8, fontSize: 11 }}>
          💡 在大屏編輯模式可整合調整
        </div>
        <button className="panel-close-btn" onClick={onClose}>✕</button>
      </div>
      <div className="panel-drawer-body">

        <div className="scene-editor-members">
          {group.members.map(m => (
            <span key={`${m.kind}:${m.id}`} className="scene-editor-member-chip">
              {m.kind === 'slot' ? '👤' : m.kind === 'staticProp' ? '📦' : '🧺'} {m.id}
            </span>
          ))}
        </div>

        <fieldset className="scene-editor-section">
          <legend>位置 (m)</legend>
          {(['X', 'Y', 'Z'] as const).map((label, i) => (
            <div key={label} className="scene-editor-row">
              <label>{label}</label>
              <input type="range" min={-5} max={5} step={0.05}
                value={t.pos[i as 0|1|2]}
                onChange={e => onPosChange(i as 0|1|2, Number(e.target.value))} />
              <input type="number" step={0.05}
                value={t.pos[i as 0|1|2]}
                onChange={e => onPosChange(i as 0|1|2, Number(e.target.value))} />
            </div>
          ))}
        </fieldset>

        <fieldset className="scene-editor-section">
          <legend>旋轉 (°) — Pitch / Yaw / Roll</legend>
          {(['Pitch', 'Yaw', 'Roll'] as const).map((label, i) => (
            <div key={label} className="scene-editor-row">
              <label>{label}</label>
              <input type="range" min={-180} max={180} step={1}
                value={t.rot[i as 0|1|2] * RAD2DEG}
                onChange={e => onRotChangeDeg(i as 0|1|2, Number(e.target.value))} />
              <input type="number" step={1}
                value={Math.round(t.rot[i as 0|1|2] * RAD2DEG * 100) / 100}
                onChange={e => onRotChangeDeg(i as 0|1|2, Number(e.target.value))} />
            </div>
          ))}
          {hasSlotMember && (
            <div className="scene-editor-hint">⚠️ 角色傾斜（Pitch/Roll）可能不自然</div>
          )}
        </fieldset>

        <div className="scene-editor-actions">
          <button onClick={onReset} className="scene-editor-btn-reset">Reset</button>
          <button onClick={onSave}  className="scene-editor-btn-save">Save</button>
        </div>
      </div>
    </div>
  );
}
