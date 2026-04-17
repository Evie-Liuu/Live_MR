export interface StatsSnapshot {
  frameMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  avatarCount: number;
  avgPoseIntervals: Record<string, number>;
}

interface StatsPanelProps {
  data: StatsSnapshot;
}

export default function StatsPanel({ data }: StatsPanelProps) {
  const style: React.CSSProperties = {
    position: 'absolute',
    bottom: 10,
    left: 10,
    background: 'rgba(0,0,0,0.75)',
    color: '#0f0',
    padding: '6px 10px',
    borderRadius: '4px',
    fontFamily: 'monospace',
    fontSize: '12px',
    zIndex: 9999,
    pointerEvents: 'none',
    lineHeight: '1.6',
    whiteSpace: 'pre',
  };

  const fmt = (n: number) => n.toLocaleString();
  const fmtMs = (n: number) => n.toFixed(1);

  const intervalLines = Object.entries(data.avgPoseIntervals)
    .map(([id, ms]) => `  ${id.slice(0, 16).padEnd(16)} ${fmtMs(ms)} ms`)
    .join('\n');

  const text = [
    `[perf] Frame:   ${fmtMs(data.frameMs)} ms`,
    `       Draw:    ${fmt(data.drawCalls)}`,
    `       Tris:    ${fmt(data.triangles)}`,
    `       Geo:     ${fmt(data.geometries)}   Tex: ${fmt(data.textures)}`,
    `       Avatars: ${data.avatarCount}`,
    intervalLines ? `       Pose intervals:\n${intervalLines}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return <div style={style}>{text}</div>;
}
