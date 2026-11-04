/**
 * Runs on each wall computer. Follows the master clock over the app's link.
 *
 * It pings the master several times a second and keeps a corrected "master
 * time" that the Player uses to place every frame. Media playback should
 * always ask showTime() rather than run on its own timer.
 *
 * No networking here: call attach() with a send function when the link to the
 * operator is up, detach() when it drops, and receive() for each "clock." message.
 */
import { EventEmitter } from 'node:events';
import os from 'node:os';
import { localNow, type Now } from './time';
import { OffsetEstimator, type EstimatorOptions } from './estimator';
import { showTimeAt, type ShowState, type SyncState as SyncStatus } from '../../src/shared/clock';
import type { ClockMsg } from './protocol';
import type { SendFn } from './master';

export interface FollowerOptions {
  name?: string;
  now?: Now;
  /** Fast pings until locked, then slower. */
  fastIntervalMs?: number;
  intervalMs?: number;
  /** No reply for this long means the master is lost (ms). */
  lostAfterMs?: number;
  estimator?: EstimatorOptions;
}

export interface FollowerSnapshot {
  name: string;
  connected: boolean;
  status: SyncStatus;
  offset: number;
  rtt: number;
  error: number;
  lastSyncAt: number | null;
  masterTime: number;
  showTime: number;
  show: ShowState;
}

export class FollowerClock extends EventEmitter {
  private send: SendFn | null = null;
  private timer: NodeJS.Timeout | null = null;
  private seq = 0;
  private sentAt = new Map<number, number>();
  private lastReply: number | null = null;
  private pingsSent = 0;
  private show: ShowState = { running: false, startedAt: 0, pausedAt: 0, version: -1, session: '' };
  readonly estimator: OffsetEstimator;
  private readonly opts: Required<Omit<FollowerOptions, 'estimator'>>;

  constructor(opts: FollowerOptions = {}) {
    super();
    this.opts = {
      name: os.hostname(),
      now: localNow,
      fastIntervalMs: 50,
      intervalMs: 250,
      lostAfterMs: 2000,
      ...opts,
    };
    this.estimator = new OffsetEstimator(opts.estimator);
  }

  /** The link to the operator is up. Start pinging. */
  attach(send: SendFn): void {
    this.detach();
    this.send = send;
    this.pingsSent = 0;
    this.schedule();
  }

  /**
   * The link dropped. Keep the last offset so playback carries on smoothly;
   * the status turns to lost after lostAfterMs.
   */
  detach(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.send = null;
    this.sentAt.clear();
  }

  private schedule(): void {
    const fast = this.pingsSent < 40 || this.estimator.status !== 'locked';
    this.timer = setTimeout(() => {
      this.ping();
      if (this.send) this.schedule();
    }, fast ? this.opts.fastIntervalMs : this.opts.intervalMs);
  }

  private ping(): void {
    if (!this.send) return;
    const seq = ++this.seq;
    const t0 = this.opts.now();
    this.sentAt.set(seq, t0);
    if (this.sentAt.size > 64) this.sentAt.delete(this.sentAt.keys().next().value!);
    this.pingsSent++;
    try {
      this.send({
        type: 'clock.ping',
        name: this.opts.name,
        seq,
        t0,
        report: {
          offset: this.estimator.offset,
          rtt: this.estimator.rtt,
          error: this.estimator.error,
          status: this.status(),
        },
      });
    } catch {
      /* link is going down; detach() will follow */
    }
  }

  /** Hand every "clock." message from the operator to this, as soon as it is parsed. */
  receive(msg: ClockMsg, recvTime?: number): void {
    const t3 = recvTime ?? this.opts.now();
    if (msg.type === 'clock.pong') {
      const t0 = this.sentAt.get(msg.seq);
      if (t0 === undefined || t0 !== msg.t0) return;
      this.sentAt.delete(msg.seq);
      if (msg.show.session !== this.show.session) this.estimator.reset(); // master restarted
      this.estimator.add(msg.t0, msg.t1, msg.t2, t3);
      this.lastReply = t3;
      this.applyShow(msg.show);
    } else if (msg.type === 'clock.state') {
      this.applyShow(msg.show);
    }
  }

  private applyShow(show: ShowState): void {
    // Ignore packets that arrive out of order. A restarted master has a new
    // session id and starts counting again, so always take its state.
    if (show.session !== this.show.session || show.version > this.show.version) {
      this.show = show;
      this.emit('show', show);
    }
  }

  now(): number {
    return this.opts.now();
  }

  status(): SyncStatus {
    if (this.lastReply === null) return 'syncing';
    if (this.opts.now() - this.lastReply > this.opts.lostAfterMs) return 'lost';
    return this.estimator.status;
  }

  /** Current master time, corrected for this computer's clock difference. */
  masterTime(): number {
    return this.opts.now() + this.estimator.offset;
  }

  /** Show time in ms. The Player should drive every video frame from this. */
  showTime(): number {
    return showTimeAt(this.show, this.masterTime());
  }

  getShow(): ShowState {
    return this.show;
  }

  snapshot(): FollowerSnapshot {
    const masterTime = this.masterTime();
    return {
      name: this.opts.name,
      connected: this.send !== null,
      status: this.status(),
      offset: this.estimator.offset,
      rtt: this.estimator.rtt,
      error: this.estimator.error,
      lastSyncAt: this.lastReply,
      masterTime,
      showTime: showTimeAt(this.show, masterTime),
      show: this.show,
    };
  }
}
