// Clock factory used by electron/main.ts. The master clock work owns this folder.
//
// Contract with the rest of the app:
//  - main.ts calls createMasterClock() on the operator and createFollowerClock(send)
//    on a render node once the operator link is up. On a reconnect, call
//    clock.attach(newSend) on the same follower rather than making a new one, so
//    it keeps its learned offset; call clock.detach() when the link drops.
//  - Every incoming message whose type starts with "clock." is passed to
//    clock.handleMessage(msg, reply, peerId) synchronously, straight from the link.
//    On the operator, call clock.peerDisconnected(peerId) when a wall's link closes.
//  - main.ts sends {type:"clockStatus"} to the operator UI every 250 ms using
//    clock.status(), and sends each output window the master-minus-local offset
//    (clock.now() - Date.now()) so video playback follows the master timeline.
//  - The operator UI's play / pause / reset / seek buttons go to clock.command(cmd).
//  - Keeping walls in step (see src/shared/clock-playback.ts): each wall's output
//    drives video with VideoFollower and calls clock.reportPlayback(reports) with
//    what it is showing; the operator calls clock.setExpectedLayers({layerKey: walls})
//    when layers change, and status().walls says whether the walls match.

import os from "node:os";
import type { ClockCommand, ClockStatus, PlaybackReport, ShowClock } from "../../src/shared/clock";
import { FollowerClock, type FollowerOptions } from "./follower";
import { MasterClock, type MasterOptions } from "./master";
import { isClockMsg } from "./protocol";

export { MasterClock } from "./master";
export { FollowerClock } from "./follower";
export { OffsetEstimator } from "./estimator";
export * from "./protocol";

export class MasterShowClock implements ShowClock {
  readonly master: MasterClock;

  constructor(opts?: MasterOptions) {
    this.master = new MasterClock(opts);
  }

  now(): number {
    return this.master.now();
  }

  showTime(): number {
    return this.master.showTime();
  }

  status(): ClockStatus {
    const snap = this.master.snapshot();
    return {
      role: "master",
      synced: true,
      state: "locked",
      offsetMs: 0,
      rttMs: 0,
      errorMs: 0,
      lastSyncAt: null,
      masterTime: snap.masterTime,
      showTimeMs: snap.showTime,
      show: snap.show,
      nodes: snap.nodes.map((n) => ({
        peerId: n.id,
        name: n.name,
        state: n.status,
        offsetMs: n.offset,
        rttMs: n.rtt,
        errorMs: n.error,
        lastSeen: Number.isFinite(n.lastSeen) ? n.lastSeen : null,
        playback: n.playback,
      })),
      walls: snap.walls,
    };
  }

  setExpectedLayers(expected: Record<string, string[]>): void {
    this.master.setExpectedLayers(expected);
  }

  command(cmd: ClockCommand): void {
    if (cmd.type === "play") this.master.play();
    else if (cmd.type === "pause") this.master.pause();
    else if (cmd.type === "reset") this.master.reset();
    else if (cmd.type === "seek" && Number.isFinite(cmd.ms)) this.master.seek(cmd.ms);
  }

  handleMessage(msg: { type: string }, reply: (m: object) => void, peerId: string): void {
    if (isClockMsg(msg)) this.master.receive(peerId, msg, reply);
  }

  peerDisconnected(peerId: string): void {
    this.master.disconnected(peerId);
  }
}

export class FollowerShowClock implements ShowClock {
  readonly follower: FollowerClock;

  constructor(send?: (msg: object) => void, opts?: FollowerOptions) {
    this.follower = new FollowerClock(opts);
    if (send) this.follower.attach(send);
  }

  now(): number {
    return this.follower.masterTime();
  }

  showTime(): number {
    return this.follower.showTime();
  }

  status(): ClockStatus {
    const s = this.follower.snapshot();
    return {
      role: "follower",
      synced: s.status === "locked",
      state: s.status,
      offsetMs: s.offset,
      rttMs: s.rtt,
      errorMs: s.error,
      lastSyncAt: s.lastSyncAt,
      masterTime: s.masterTime,
      showTimeMs: s.showTime,
      show: s.show,
    };
  }

  handleMessage(msg: { type: string }): void {
    if (isClockMsg(msg)) this.follower.receive(msg);
  }

  reportPlayback(reports: PlaybackReport[]): void {
    this.follower.reportPlayback(reports);
  }

  attach(send: (msg: object) => void): void {
    this.follower.attach(send);
  }

  detach(): void {
    this.follower.detach();
  }

  dispose(): void {
    this.follower.detach();
  }
}

export function createMasterClock(): ShowClock {
  return new MasterShowClock();
}

/** @param send sends a message to the operator over the link. */
export function createFollowerClock(send: (msg: object) => void, name = os.hostname()): ShowClock {
  return new FollowerShowClock(send, { name });
}
