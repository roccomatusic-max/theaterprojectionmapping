// Master clock seam.
//
// Every machine in the show (operator + side-wall render nodes) reads time from a
// ShowClock. On the operator it is the master; on render nodes it follows the master
// over the network link. Cues are scheduled in master-clock milliseconds, so a cue
// that says "start at T" starts at the same moment on every machine.
//
// The master clock also owns the show clock (the timecode the operator sees),
// which every wall follows: play, pause, reset and seek happen on all machines together.
//
// The synchronised implementation lives in electron/clock/. LocalClock below is a
// stand-in for a single-computer show and for tests.
//
// This file is shared by the Electron main process and the React UI, so it must
// stay free of Node imports.

export type SyncState = "locked" | "syncing" | "lost";

/**
 * The show clock, expressed in master time.
 * When running, show time = masterNow - startedAt. When paused, show time = pausedAt.
 */
export interface ShowState {
  running: boolean;
  /** Master time (ms) at which show time was 0. Only meaningful while running. */
  startedAt: number;
  /** Show time (ms) frozen while paused. */
  pausedAt: number;
  /** Increments on every change so walls can ignore stale messages. */
  version: number;
  /** Random id for this run of the master, so walls notice a restarted master. */
  session: string;
}

/** One wall computer as seen from the operator. */
export interface ClockNodeStatus {
  peerId: string;
  name: string;
  state: SyncState;
  /** How far the wall's own clock is from master time (ms). Large is fine; it is corrected. */
  offsetMs: number;
  /** Shortest recent network round trip (ms). */
  rttMs: number;
  /** Estimated worst-case timing error after correction (ms). This is the number that matters. */
  errorMs: number;
  /** Master time of the last ping from this wall. */
  lastSeen: number | null;
}

export interface ClockStatus {
  role: "master" | "follower";
  synced: boolean;
  /** Estimated master - local offset in ms. */
  offsetMs: number;
  /** Round-trip time of the best recent sample in ms. */
  rttMs: number;
  lastSyncAt: number | null;
  /** Follower: sync quality. Master: always "locked". */
  state?: SyncState;
  /** Follower: estimated worst-case error vs master (ms). */
  errorMs?: number;
  /** Master time when this status was taken. */
  masterTime?: number;
  /** Show time (ms) when this status was taken. */
  showTimeMs?: number;
  show?: ShowState;
  /** Master only: every wall computer that has connected. */
  nodes?: ClockNodeStatus[];
}

export type ClockCommand =
  | { type: "play" }
  | { type: "pause" }
  | { type: "reset" }
  | { type: "seek"; ms: number };

export interface ShowClock {
  /** Milliseconds on the master timeline. */
  now(): number;
  status(): ClockStatus;
  /** Show time in ms (the operator's timecode). Media and cues on the show timeline follow this. */
  showTime?(): number;
  /** Operator only: play, pause, reset or seek the show clock on every machine. */
  command?(cmd: ClockCommand): void;
  /** Feed a "clock.*" message that arrived on a network link, synchronously. */
  handleMessage?(msg: { type: string; [k: string]: unknown }, reply: (m: object) => void, peerId: string): void;
  /** Operator: a wall's link closed. It shows as lost straight away. */
  peerDisconnected?(peerId: string): void;
  /** Follower: a (re)connected link to the operator. Keeps the learned offset across reconnects. */
  attach?(send: (msg: object) => void): void;
  /** Follower: the link to the operator dropped. */
  detach?(): void;
  dispose?(): void;
}

export class LocalClock implements ShowClock {
  constructor(private readonly role: "master" | "follower" = "master") {}
  now(): number {
    return Date.now();
  }
  status(): ClockStatus {
    return { role: this.role, synced: this.role === "master", offsetMs: 0, rttMs: 0, lastSyncAt: null };
  }
}

/** Lead time added to every cue so all machines receive it before it starts. */
export const CUE_LEAD_MS = 150;

/** Frame rate used for the operator timecode display. */
export const TIMECODE_FPS = 30;

export function showTimeAt(show: ShowState, masterTime: number): number {
  return show.running ? masterTime - show.startedAt : show.pausedAt;
}

/** Formats show time as HH:MM:SS:FF. */
export function formatTimecode(ms: number, fps = TIMECODE_FPS): string {
  const neg = ms < 0;
  const totalFrames = Math.floor((Math.abs(ms) * fps) / 1000);
  const ff = totalFrames % fps;
  const totalSec = Math.floor(totalFrames / fps);
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${neg ? "-" : ""}${p(hh)}:${p(mm)}:${p(ss)}:${p(ff)}`;
}
