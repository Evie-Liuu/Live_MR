import { beforeEach, describe, expect, it } from 'vitest';
import {
  flushPerfMetrics,
  perfCount,
  perfGauge,
  perfValue,
  percentile,
  sanitizeMetrics,
  setPerfEnabled,
  summarizeInboundVideo,
  summarizePerf,
  type InboundVideoRow,
} from './perfRecorder';

describe('效能指標累積', () => {
  beforeEach(() => setPerfEnabled(true));

  it('沒在記錄時不累積', () => {
    setPerfEnabled(false);
    perfValue('a', 1);
    perfCount('b');
    perfGauge('c', 1);
    expect(flushPerfMetrics(1000)).toEqual({});
  });

  it('數值輸出平均、p95、最大值', () => {
    for (let i = 1; i <= 100; i += 1) perfValue('ms', i);
    expect(flushPerfMetrics(1000)).toEqual({ 'ms.avg': 50.5, 'ms.p95': 95, 'ms.max': 100 });
  });

  it('次數換算成每秒速率', () => {
    perfCount('pose', 30);
    perfCount('bytes', 500);
    expect(flushPerfMetrics(5000)).toEqual({ 'pose.perSec': 6, 'bytes.perSec': 100 });
  });

  it('狀態值輸出最後一次，輸出後清空', () => {
    perfGauge('draw', 10);
    perfGauge('draw', 20);
    expect(flushPerfMetrics(1000)).toEqual({ draw: 20 });
    expect(flushPerfMetrics(1000)).toEqual({});
  });
});

describe('percentile', () => {
  it('空陣列回傳 0，單一值回傳本身', () => {
    expect(percentile([], 0.95)).toBe(0);
    expect(percentile([7], 0.95)).toBe(7);
  });
});

describe('sanitizeMetrics', () => {
  it('只留有限的數值', () => {
    expect(sanitizeMetrics({ a: 1, b: 'x', c: NaN, d: Infinity })).toEqual({ a: 1 });
    expect(sanitizeMetrics(null)).toBeNull();
    expect(sanitizeMetrics('x')).toBeNull();
  });

  it('限制欄位數量', () => {
    const raw = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(sanitizeMetrics(raw) ?? {})).toHaveLength(128);
  });
});

describe('summarizePerf', () => {
  it('依來源分開算全程平均與最大值', () => {
    const summary = summarizePerf([
      { t: 1, source: 'student', identity: 's1', metrics: { fps: 10 } },
      { t: 2, source: 'student', identity: 's1', metrics: { fps: 30 } },
      { t: 1, source: 'student', identity: 's2', metrics: { fps: 60 } },
      { t: 1, source: 'host', metrics: { fps: 50 } },
    ]);
    expect(summary['student:s1'].fps).toEqual({ avg: 20, max: 30 });
    expect(summary['student:s2'].fps).toEqual({ avg: 60, max: 60 });
    expect(summary.host.fps).toEqual({ avg: 50, max: 50 });
  });

  it('只有部分取樣才有的指標，平均不被其他取樣稀釋', () => {
    const summary = summarizePerf([
      { t: 1, source: 'host', metrics: { fps: 60 } },
      { t: 2, source: 'host', metrics: { fps: 60, videoKbps: 100 } },
    ]);
    expect(summary.host.videoKbps).toEqual({ avg: 100, max: 100 });
  });
});

describe('summarizeInboundVideo', () => {
  const row = (id: string, over: Partial<InboundVideoRow> = {}): InboundVideoRow => ({
    id, fps: 20, bytesReceived: 0, packetsLost: 0, framesDropped: 0, jitter: 0, ...over,
  });

  it('由累計值的差算出這段時間的數據', () => {
    const prev = new Map([['a', row('a', { bytesReceived: 1000, packetsLost: 2, framesDropped: 1 })]]);
    const metrics = summarizeInboundVideo(
      [row('a', { bytesReceived: 126000, packetsLost: 5, framesDropped: 4, fps: 18, jitter: 0.02 })],
      prev,
      5000,
    );
    expect(metrics).toMatchObject({
      videoTracks: 1, videoKbps: 200, videoPacketsLost: 3, videoFramesDropped: 3, videoJitterMaxMs: 20, videoFpsMin: 18,
    });
  });

  it('新出現的影像不把累計值算成一次爆量', () => {
    const metrics = summarizeInboundVideo([row('new', { bytesReceived: 9_000_000, packetsLost: 50 })], new Map(), 5000);
    expect(metrics.videoKbps).toBe(0);
    expect(metrics.videoPacketsLost).toBe(0);
  });

  it('計數器重設時不出現負值', () => {
    const prev = new Map([['a', row('a', { bytesReceived: 1000 })]]);
    expect(summarizeInboundVideo([row('a', { bytesReceived: 10 })], prev, 5000).videoKbps).toBe(0);
  });

  it('全班的 FPS 取平均與最低，沒有 FPS 資料時不輸出', () => {
    const metrics = summarizeInboundVideo([row('a', { fps: 30 }), row('b', { fps: 10 })], new Map(), 5000);
    expect(metrics.videoFpsAvg).toBe(20);
    expect(metrics.videoFpsMin).toBe(10);
    expect(summarizeInboundVideo([row('a', { fps: null })], new Map(), 5000)).not.toHaveProperty('videoFpsAvg');
  });
});
