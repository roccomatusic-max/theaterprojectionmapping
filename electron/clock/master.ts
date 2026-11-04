/**
 * The master clock. Runs on the operator computer in the booth.
 *
 * - Answers timing pings from every wall computer.
 * - Owns the show clock (play / pause / reset / seek) and pushes changes to walls.
 * - Keeps a table of connected walls and how well each one is synced.
 *
 * It does no networking itself. The app's link calls receive() with each
 * "clock." message and gives it a send function for replies, so the clock works
 * over whatever connection the operator already has to each wall.
 */
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { localNow, type Now } from './time';
import { showTimeAt, type ShowState, type SyncState as SyncStatus } from '../../src/shared/clock';
import type { ClockMsg } from './protocol';
import { compareWalls, type PlaybackReport, type WallSyncSummary } from '../../src/shared/clock-playback';

export type SendFn = (msg: ClockMsg) => void;

export interface MasterOptions {
  now?: Now;
  /** A wall is shown as lost after this long without a ping (ms). */
  lostAfterMs?: number;
}

export interface NodeInfo {
  id: string;
  name: string;
  /** How far the wall's own clock is from master time (ms). Large is fine; it gets corrected. */
  offset: number;
  /** Shortest recent round trip on the network (ms). */
  rtt: number;
  /** Estimated worst-case timing error after correction (ms). This is the number that matters. */
  error: number;
  status: SyncStatus;
  lastSeen: number;
  /** What the wall last said it is showing. */
  playback: PlaybackReport[];
}

export interface MasterSnapshot {
  masterTime: number;
  showTime: number;
  show: ShowState;
  nodes: NodeInfo[];
  walls: WallSyncSummary;
}

interface NodeEntry {
  info: NodeInfo;
  send: SendFn;
}

export class MasterClock extends EventEmitter {
  private nodes = new Map<string, NodeEntry>();
  private show: ShowState = { running: false, startedAt: 0, pausedAt: 0, version: 0, session: randomUUID() };
  private readonly opts: Required<MasterOptions>;
  private expected: Record<string, string[]> | undefined;

  constructor(opts: MasterOptions = {}) {
    super();
    this.opts = { now: localNow, lostAfterMs: 2000, ...opts };
  }

  now(): number {
    return this.opts.now();
  }

  /**
   * Hand every "clock." message from a wall to this, as soon as it is parsed.
   * Pass recvTime if the link stamped arrival earlier with this clock's now().
   */
  receive(nodeId: string, msg: ClockMsg, send: SendFn, recvTime?: number): void {
    const t1 = recvTime ?? this.now();
    if (msg.type !== 'clock.ping') return;
    send({ type: 'clock.pong', seq: msg.seq, t0: msg.t0, t1, t2: this.now(), show: this.show });

    const isNew = !this.nodes.has(nodeId);
    this.nodes.set(nodeId, {
      send,
      info: {
        id: nodeId,
        name: msg.name,
        offset: msg.report?.offset ?? NaN,
        rtt: msg.report?.rtt ?? NaN,
        error: msg.report?.error ?? Infinity,
        status: msg.report?.status ?? 'syncing',
        lastSeen: t1,
        playback: Array.isArray(msg.playback) ? msg.playback : [],
      },
    });
    if (isNew) this.emit('node', nodeId);
  }

  /** Call when the link to a wall closes. It stays in the table, shown as lost. */
  disconnected(nodeId: string): void {
    const n = this.nodes.get(nodeId);
    if (n) n.info.lastSeen = -Infinity;
  }

  forgetNode(nodeId: string): void {
    this.nodes.delete(nodeId);
  }

  private setShow(next: Omit<ShowState, 'version' | 'session'>): void {
    this.show = { ...next, version: this.show.version + 1, session: this.show.session };
    for (const n of this.nodes.values()) {
      try {
        n.send({ type: 'clock.state', show: this.show });
      } catch {
        /* a dropped wall will catch up from its next pong */
      }
    }
    this.emit('show', this.show);
  }

  showTime(): number {
    return showTimeAt(this.show, this.now());
  }

  getShow(): ShowState {
    return this.show;
  }

  /**
   * Start or resume the show clock. Walls get the start time in master time,
   * so they all begin from the same instant no matter when the message lands.
   */
  play(): void {
    if (this.show.running) return;
    this.setShow({ running: true, startedAt: this.now() - this.show.pausedAt, pausedAt: 0 });
  }

  pause(): void {
    if (!this.show.running) return;
    this.setShow({ running: false, startedAt: 0, pausedAt: this.showTime() });
  }

  /** Stop and go back to 00:00:00:00. */
  reset(): void {
    this.setShow({ running: false, startedAt: 0, pausedAt: 0 });
  }

  /** Jump the show clock to a time (ms), keeping it running or paused. */
  seek(showMs: number): void {
    if (this.show.running) this.setShow({ running: true, startedAt: this.now() - showMs, pausedAt: 0 });
    else this.setShow({ running: false, startedAt: 0, pausedAt: showMs });
  }

  getNodes(): NodeInfo[] {
    const now = this.now();
    return [...this.nodes.values()]
      .map(({ info }) => (now - info.lastSeen > this.opts.lostAfterMs ? { ...info, status: 'lost' as const } : { ...info }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Optional: for each live layer key, the walls it should be on (from the cue).
   * Lets the operator see a wall that never showed a cue at all.
   */
  setExpectedLayers(expected: Record<string, string[]>): void {
    this.expected = expected;
  }

  /** Are the walls showing the same thing at the same moment? */
  wallSync(now = this.now()): WallSyncSummary {
    // A lost wall's last report is stale; it shows up as lost in the node table instead.
    const live = this.getNodes().filter((n) => n.status !== 'lost');
    return compareWalls(live.flatMap((n) => n.playback), now, this.expected);
  }

  snapshot(): MasterSnapshot {
    const masterTime = this.now();
    return {
      masterTime,
      showTime: showTimeAt(this.show, masterTime),
      show: this.show,
      nodes: this.getNodes(),
      walls: this.wallSync(masterTime),
    };
  }
}
