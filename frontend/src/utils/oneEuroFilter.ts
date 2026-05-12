/**
 * One-Euro filter — adaptive low-pass smoothing for noisy signal streams.
 *
 * Smooths heavily when the signal is slow / still (kills jitter), and relaxes
 * the smoothing as the signal speeds up (so fast motion doesn't lag). The
 * standard choice for stabilising motion-capture / pose-landmark streams.
 *
 * Reference: Casiez, Roussel & Vogel, "1€ Filter: A Simple Speed-based
 * Low-pass Filter for Noisy Input in Interactive Systems" (CHI 2012).
 */

const TWO_PI = Math.PI * 2;

/** Low-pass smoothing factor for a cutoff frequency (Hz) at a given timestep (s). */
function alpha(cutoffHz: number, dtSec: number): number {
  const tau = 1 / (TWO_PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
}

class LowPassFilter {
  private hat = 0;
  private initialized = false;

  filter(x: number, a: number): number {
    if (!this.initialized) {
      this.hat = x;
      this.initialized = true;
    } else {
      this.hat = a * x + (1 - a) * this.hat;
    }
    return this.hat;
  }

  reset(): void {
    this.initialized = false;
  }
}

export class OneEuroFilter {
  private xLp = new LowPassFilter();
  private dxLp = new LowPassFilter();
  private xPrev = 0;
  private hasPrev = false;

  /**
   * @param minCutoff Hz — lower = more smoothing when the signal is still.
   * @param beta      speed coefficient — higher = less lag during fast motion.
   * @param dCutoff   Hz — cutoff for the speed estimate (rarely needs tuning).
   */
  constructor(
    private minCutoff = 1.0,
    private beta = 0.0,
    private dCutoff = 1.0,
  ) { }

  /** @param dtSec seconds since the previous sample (> 0). */
  filter(x: number, dtSec: number): number {
    const dx = this.hasPrev ? (x - this.xPrev) / dtSec : 0;
    this.xPrev = x;
    this.hasPrev = true;

    const edx = this.dxLp.filter(dx, alpha(this.dCutoff, dtSec));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.xLp.filter(x, alpha(cutoff, dtSec));
  }

  reset(): void {
    this.xLp.reset();
    this.dxLp.reset();
    this.hasPrev = false;
  }
}

/**
 * Per-coordinate One-Euro filter over an array of {x,y,z} landmarks, smoothing
 * them in place. One filter per landmark per axis, all sharing the same tuning.
 * Frame-rate independent — pass the real timestamp on every call.
 */
export class LandmarkSmoother {
  private fx: OneEuroFilter[];
  private fy: OneEuroFilter[];
  private fz: OneEuroFilter[];
  private lastTimeMs = 0;
  private hasLastTime = false;

  constructor(count: number, minCutoff = 1.0, beta = 0.0, dCutoff = 1.0) {
    const mk = () => new OneEuroFilter(minCutoff, beta, dCutoff);
    this.fx = Array.from({ length: count }, mk);
    this.fy = Array.from({ length: count }, mk);
    this.fz = Array.from({ length: count }, mk);
  }

  /**
   * Smooth `landmarks` in place. Only x/y/z are touched (visibility etc. left alone).
   * @param timeMs performance.now() of this sample.
   */
  apply(landmarks: { x: number; y: number; z: number }[], timeMs: number): void {
    let dt = this.hasLastTime ? (timeMs - this.lastTimeMs) / 1000 : 1 / 30;
    // Guard against zero / negative / huge gaps (stalled tab, clock weirdness).
    if (!(dt > 0)) dt = 1 / 60;
    if (dt > 0.25) dt = 0.25;
    this.lastTimeMs = timeMs;
    this.hasLastTime = true;

    const n = Math.min(landmarks.length, this.fx.length);
    for (let i = 0; i < n; i++) {
      const lm = landmarks[i];
      lm.x = this.fx[i].filter(lm.x, dt);
      lm.y = this.fy[i].filter(lm.y, dt);
      lm.z = this.fz[i].filter(lm.z, dt);
    }
  }

  reset(): void {
    for (let i = 0; i < this.fx.length; i++) {
      this.fx[i].reset();
      this.fy[i].reset();
      this.fz[i].reset();
    }
    this.hasLastTime = false;
  }
}
