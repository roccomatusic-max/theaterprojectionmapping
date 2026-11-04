/**
 * Wire format for the master clock. Small JSON messages that ride the operator
 * <-> wall link (electron/net/link.ts routes every "clock." message here).
 *
 *   clock.ping   wall -> operator, carries t0 and the wall's sync report
 *   clock.pong   operator -> wall, t0/t1/t2 plus the show clock state
 *   clock.state  operator -> all walls, pushed on play / pause / reset / seek
 */
import type { ShowState, SyncState } from "../../src/shared/clock";

export interface PingMsg {
  type: "clock.ping";
  name: string;
  seq: number;
  /** Wall local time when sent. */
  t0: number;
  /** Wall's current sync quality, for the operator display. */
  report?: { offset: number; rtt: number; error: number; status: SyncState };
}

export interface PongMsg {
  type: "clock.pong";
  seq: number;
  t0: number;
  /** Master time when the ping arrived. */
  t1: number;
  /** Master time when the pong was sent. */
  t2: number;
  show: ShowState;
}

export interface StateMsg {
  type: "clock.state";
  show: ShowState;
}

export type ClockMsg = PingMsg | PongMsg | StateMsg;

export function isClockMsg(m: unknown): m is ClockMsg {
  const t = (m as { type?: unknown } | null)?.type;
  return t === "clock.ping" || t === "clock.pong" || t === "clock.state";
}
