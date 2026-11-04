/**
 * Works out how far a wall computer's clock is from the master's, using the
 * same four-timestamp exchange as NTP:
 *
 *   t0 wall sends ping   -> t1 master receives
 *   t3 wall receives pong <- t2 master sends
 *
 *   offset = ((t1 - t0) + (t2 - t3)) / 2     (add to wall time to get master time)
 *   rtt    = (t3 - t0) - (t2 - t1)
 *
 * Network delay varies, so we keep a window of samples and trust the ones with
 * the shortest round trip (least queueing). The applied offset slews gently so
 * playback never stutters, but steps immediately on first lock or a big jump.
 */
import type { SyncState as SyncStatus } from '../../src/shared/clock';

export interface Sample {
  offset: number;
  rtt: number;
}

export interface EstimatorOptions {
  /** Number of recent samples to keep. */
  window?: number;
  /** If the target moves by more than this (ms), jump instead of slewing. */
  stepThresholdMs?: number;
  /** Fraction of the remaining error corrected per sample when slewing. */
  slewRate?: number;
  /** Error bound (ms) under which we call the clock locked. */
  lockedErrorMs?: number;
  /** Samples needed before we can call it locked. */
  minSamples?: number;
}

export class OffsetEstimator {
  private samples: Sample[] = [];
  private applied: number | null = null;
  private readonly opts: Required<EstimatorOptions>;

  constructor(opts: EstimatorOptions = {}) {
    this.opts = {
      window: 32,
      stepThresholdMs: 25,
      slewRate: 0.2,
      lockedErrorMs: 4,
      minSamples: 6,
      ...opts,
    };
  }

  add(t0: number, t1: number, t2: number, t3: number): void {
    const rtt = t3 - t0 - (t2 - t1);
    const offset = (t1 - t0 + (t2 - t3)) / 2;
    if (!(rtt >= 0) || !Number.isFinite(offset)) return;
    this.samples.push({ offset, rtt });
    if (this.samples.length > this.opts.window) this.samples.shift();

    const target = this.target();
    if (this.applied === null || Math.abs(target - this.applied) > this.opts.stepThresholdMs) {
      this.applied = target;
    } else {
      this.applied += (target - this.applied) * this.opts.slewRate;
    }
  }

  /** Mean offset of the quarter of samples with the shortest round trip. */
  private target(): number {
    const best = this.bestSamples();
    return best.reduce((s, x) => s + x.offset, 0) / best.length;
  }

  private bestSamples(): Sample[] {
    const sorted = [...this.samples].sort((a, b) => a.rtt - b.rtt);
    return sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 4)));
  }

  /** Milliseconds to add to local time to get master time. */
  get offset(): number {
    return this.applied ?? 0;
  }

  get hasLock(): boolean {
    return this.applied !== null;
  }

  /** Shortest recent round trip, in ms. */
  get rtt(): number {
    if (!this.samples.length) return NaN;
    return Math.min(...this.samples.map((s) => s.rtt));
  }

  /**
   * Worst-case error estimate in ms: half the best round trip (the most the
   * delay could be lopsided) plus the spread between the best samples.
   */
  get error(): number {
    if (!this.samples.length) return Infinity;
    const best = this.bestSamples();
    const mean = best.reduce((s, x) => s + x.offset, 0) / best.length;
    const spread = Math.max(...best.map((x) => Math.abs(x.offset - mean)));
    return this.rtt / 2 + spread + Math.abs(mean - this.offset);
  }

  get status(): SyncStatus {
    if (this.samples.length < this.opts.minSamples) return 'syncing';
    return this.error <= this.opts.lockedErrorMs ? 'locked' : 'syncing';
  }

  reset(): void {
    this.samples = [];
    this.applied = null;
  }
}
