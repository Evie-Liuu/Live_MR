import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { layoutNameplates, type AvatarAnchors, type NameplateInfo, type PlateBox, type PlateOffsets } from '../utils/nameplates.ts';
import './AvatarNameplates.css';

interface AvatarNameplatesProps {
  /** 由場景每 ~100ms 推送頭頂座標；用 sink 而不是 props，避免整個大屏跟著重新渲染 */
  sinkRef: MutableRefObject<((anchors: AvatarAnchors) => void) | null>;
  plates: Record<string, NameplateInfo>;
}

/** 名牌被推離頭頂超過這個距離（px）才畫指引線 */
const LEADER_MIN_PX = 10;

function sameOffsets(a: PlateOffsets, b: PlateOffsets): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every(k => b[k] && a[k].dx === b[k].dx && a[k].dy === b[k].dy);
}

/**
 * 大屏角色名牌：跟著模型頭頂移動，顯示「角色・演出者」，解決看不出誰演誰、該換誰說話的問題。
 * 只放短文字（角色與名字），台詞仍在下方字幕區，避免頭上文字太多遮住場景。
 * 角色站得近時名牌會自動左右推開（必要時上下錯開），並用細線指回頭頂。
 */
export default function AvatarNameplates({ sinkRef, plates }: AvatarNameplatesProps) {
  const [anchors, setAnchors] = useState<AvatarAnchors>({});
  const [offsets, setOffsets] = useState<PlateOffsets>({});
  const layerRef = useRef<HTMLDivElement>(null);
  const plateEls = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    sinkRef.current = setAnchors;
    return () => { sinkRef.current = null; };
  }, [sinkRef]);

  // 量名牌實際大小（含說話中的放大）再排版；只依錨點計算，不受上一次位移影響
  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const { width, height } = layer.getBoundingClientRect();
    const boxes: PlateBox[] = [];
    for (const [id, p] of Object.entries(anchors)) {
      const el = plateEls.current.get(id);
      if (!el || !plates[id]) continue;
      const r = el.getBoundingClientRect();
      boxes.push({ id, x: p.x * width, y: p.y * height, w: r.width, h: r.height });
    }
    const next = layoutNameplates(boxes, width);
    // 需要先量 DOM 才能排版，所以在 layout effect 裡更新
    setOffsets(prev => (sameOffsets(prev, next) ? prev : next));
  }, [anchors, plates]);

  return (
    <div className="bs-nameplates" ref={layerRef} aria-hidden="true">
      {Object.entries(anchors).map(([id, p]) => {
        const info = plates[id];
        if (!info) return null;
        const { dx = 0, dy = 0 } = offsets[id] ?? {};
        const len = Math.hypot(dx, dy);
        return (
          <div key={id} style={{ ['--plate-color' as string]: info.color }}>
            {len >= LEADER_MIN_PX && (
              <span
                className="bs-nameplate-leader"
                style={{
                  left: `${p.x * 100}%`,
                  top: `${p.y * 100}%`,
                  width: `${len}px`,
                  transform: `rotate(${Math.atan2(dy, dx)}rad)`,
                }}
              />
            )}
            <div
              ref={el => { if (el) plateEls.current.set(id, el); else plateEls.current.delete(id); }}
              className={`bs-nameplate${info.active ? '' : ' is-idle'}${info.speaking ? ' is-speaking' : ''}${info.turn ? ' is-turn' : ''}`}
              style={{ left: `calc(${p.x * 100}% + ${dx}px)`, top: `calc(${p.y * 100}% + ${dy}px)` }}
            >
              {info.role && <span className="bs-nameplate-role">{info.role}</span>}
              {info.name && <span className="bs-nameplate-name">{info.name}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
