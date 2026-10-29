import { useEffect, useState, type MutableRefObject } from 'react';
import type { AvatarAnchors, NameplateInfo } from '../utils/nameplates.ts';
import './AvatarNameplates.css';

interface AvatarNameplatesProps {
  /** 由場景每 ~100ms 推送頭頂座標；用 sink 而不是 props，避免整個大屏跟著重新渲染 */
  sinkRef: MutableRefObject<((anchors: AvatarAnchors) => void) | null>;
  plates: Record<string, NameplateInfo>;
}

/**
 * 大屏角色名牌：跟著模型頭頂移動，顯示「角色・演出者」，解決看不出誰演誰、該換誰說話的問題。
 * 只放短文字（角色與名字），台詞仍在下方字幕區，避免頭上文字太多遮住場景。
 */
export default function AvatarNameplates({ sinkRef, plates }: AvatarNameplatesProps) {
  const [anchors, setAnchors] = useState<AvatarAnchors>({});

  useEffect(() => {
    sinkRef.current = setAnchors;
    return () => { sinkRef.current = null; };
  }, [sinkRef]);

  return (
    <div className="bs-nameplates" aria-hidden="true">
      {Object.entries(anchors).map(([id, p]) => {
        const info = plates[id];
        if (!info) return null;
        return (
          <div
            key={id}
            className={`bs-nameplate${info.active ? '' : ' is-idle'}${info.speaking ? ' is-speaking' : ''}${info.turn ? ' is-turn' : ''}`}
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, ['--plate-color' as string]: info.color }}
          >
            {info.role && <span className="bs-nameplate-role">{info.role}</span>}
            {info.name && <span className="bs-nameplate-name">{info.name}</span>}
          </div>
        );
      })}
    </div>
  );
}
