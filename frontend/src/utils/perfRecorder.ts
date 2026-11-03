/**
 * 上課效能記錄：教師端開始記錄後，教師端、大屏、每台學生平板各自累積指標、定期取樣，
 * 全部彙整到教師端，停止時下載成一個 JSON。
 *
 * 程式各處用 perfValue / perfCount / perfGauge 回報；沒在記錄時這些函式會立刻返回，不影響效能。
 * 模組狀態是「每個視窗一份」，教師端、大屏、平板互不干擾。
 */

export type PerfSource = 'host' | 'bigscreen' | 'student';

export interface PerfSample {
  /** epoch ms（各裝置自己的時鐘） */
  t: number;
  source: PerfSource;
  /** 學生的 LiveKit identity */
  identity?: string;
  metrics: Record<string, number>;
}

export interface PerfEvent {
  t: number;
  label: string;
}

export interface PerfDevice {
  userAgent: string;
  cores: number | null;
  memoryGb: number | null;
  devicePixelRatio: number;
  screen: string;
}

export interface PerfReport {
  version: 1;
  roomId: string;
  startedAt: number;
  stoppedAt: number;
  devices: Record<string, PerfDevice>;
  /** 來源（host / bigscreen / student:<identity>）→ 指標 → 全程平均與最大值 */
  summary: Record<string, Record<string, { avg: number; max: number }>>;
  events: PerfEvent[];
  samples: PerfSample[];
}

let enabled = false;
const values = new Map<string, number[]>();
const counters = new Map<string, number>();
const gauges = new Map<string, number>();

export function setPerfEnabled(on: boolean): void {
  enabled = on;
  values.clear();
  counters.clear();
  gauges.clear();
}

/** 組指標名稱（字串相加）前先檢查，避免沒記錄時的額外成本 */
export function isPerfEnabled(): boolean {
  return enabled;
}

/** 每次發生都有數值（耗時、間隔）：取樣時輸出平均、p95、最大值 */
export function perfValue(name: string, value: number): void {
  if (!enabled) return;
  const list = values.get(name);
  if (list) list.push(value);
  else values.set(name, [value]);
}

/** 累計次數或位元組：取樣時輸出每秒速率 */
export function perfCount(name: string, amount = 1): void {
  if (!enabled) return;
  counters.set(name, (counters.get(name) ?? 0) + amount);
}

/** 當下狀態（draw calls、連線品質）：取樣時輸出最後一次的值 */
export function perfGauge(name: string, value: number): void {
  if (!enabled) return;
  gauges.set(name, value);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

/** 輸出這段時間累積的指標並清空 */
export function flushPerfMetrics(elapsedMs: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, list] of values) {
    const sorted = [...list].sort((a, b) => a - b);
    out[`${name}.avg`] = round1(sorted.reduce((sum, v) => sum + v, 0) / sorted.length);
    out[`${name}.p95`] = round1(percentile(sorted, 0.95));
    out[`${name}.max`] = round1(sorted[sorted.length - 1]);
  }
  for (const [name, count] of counters) {
    out[`${name}.perSec`] = round1((count * 1000) / Math.max(elapsedMs, 1));
  }
  for (const [name, value] of gauges) out[name] = round1(value);
  values.clear();
  counters.clear();
  gauges.clear();
  return out;
}

export function describeDevice(): PerfDevice {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: nav.userAgent,
    cores: nav.hardwareConcurrency ?? null,
    memoryGb: nav.deviceMemory ?? null,
    devicePixelRatio: window.devicePixelRatio,
    screen: `${window.screen.width}x${window.screen.height}`,
  };
}

const MAX_REMOTE_METRICS = 128;

/** 學生、大屏傳來的取樣：只留有限的數值，避免異常訊息塞爆記憶體 */
export function sanitizeMetrics(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Record<string, number> = {};
  let kept = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    out[key] = value;
    if (++kept >= MAX_REMOTE_METRICS) break;
  }
  return out;
}

export function sanitizeDevice(raw: unknown): PerfDevice | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Partial<PerfDevice>;
  if (typeof d.userAgent !== 'string') return null;
  return {
    userAgent: d.userAgent.slice(0, 512),
    cores: typeof d.cores === 'number' ? d.cores : null,
    memoryGb: typeof d.memoryGb === 'number' ? d.memoryGb : null,
    devicePixelRatio: typeof d.devicePixelRatio === 'number' ? d.devicePixelRatio : 0,
    screen: typeof d.screen === 'string' ? d.screen.slice(0, 32) : '',
  };
}

export function sourceKey(sample: Pick<PerfSample, 'source' | 'identity'>): string {
  return sample.identity ? `${sample.source}:${sample.identity}` : sample.source;
}

export function summarizePerf(samples: readonly PerfSample[]): PerfReport['summary'] {
  const totals = new Map<string, Map<string, { sum: number; n: number; max: number }>>();
  for (const sample of samples) {
    const key = sourceKey(sample);
    let source = totals.get(key);
    if (!source) totals.set(key, (source = new Map()));
    for (const [name, value] of Object.entries(sample.metrics)) {
      const total = source.get(name);
      if (total) {
        total.sum += value;
        total.n += 1;
        total.max = Math.max(total.max, value);
      } else {
        source.set(name, { sum: value, n: 1, max: value });
      }
    }
  }
  const summary: PerfReport['summary'] = {};
  for (const [key, source] of totals) {
    summary[key] = {};
    for (const [name, { sum, n, max }] of [...source].sort(([a], [b]) => a.localeCompare(b))) {
      summary[key][name] = { avg: round1(sum / n), max: round1(max) };
    }
  }
  return summary;
}

/** 一路接收影像在某個時間點的累計數據（WebRTC inbound-rtp） */
export interface InboundVideoRow {
  id: string;
  fps: number | null;
  bytesReceived: number;
  packetsLost: number;
  framesDropped: number;
  /** 秒 */
  jitter: number | null;
}

/** 由兩次累計值算出這段時間的全班影像狀況；新出現的一路從下一次才開始計差值 */
export function summarizeInboundVideo(
  rows: readonly InboundVideoRow[],
  prev: ReadonlyMap<string, InboundVideoRow>,
  elapsedMs: number,
): Record<string, number> {
  let bytes = 0;
  let lost = 0;
  let dropped = 0;
  let jitterMax = 0;
  const fpsList: number[] = [];
  for (const row of rows) {
    if (row.fps !== null) fpsList.push(row.fps);
    if (row.jitter !== null) jitterMax = Math.max(jitterMax, row.jitter);
    const before = prev.get(row.id);
    if (!before) continue;
    bytes += Math.max(0, row.bytesReceived - before.bytesReceived);
    lost += Math.max(0, row.packetsLost - before.packetsLost);
    dropped += Math.max(0, row.framesDropped - before.framesDropped);
  }
  const metrics: Record<string, number> = {
    videoTracks: rows.length,
    videoKbps: round1((bytes * 8) / Math.max(elapsedMs, 1)),
    videoPacketsLost: lost,
    videoFramesDropped: dropped,
    videoJitterMaxMs: round1(jitterMax * 1000),
  };
  if (fpsList.length > 0) {
    metrics.videoFpsAvg = round1(fpsList.reduce((sum, v) => sum + v, 0) / fpsList.length);
    metrics.videoFpsMin = Math.min(...fpsList);
  }
  return metrics;
}

export function buildPerfReport(input: {
  roomId: string;
  startedAt: number;
  stoppedAt: number;
  devices: Record<string, PerfDevice>;
  events: PerfEvent[];
  samples: PerfSample[];
}): PerfReport {
  return { version: 1, ...input, summary: summarizePerf(input.samples) };
}
