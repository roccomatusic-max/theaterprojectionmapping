// Master clock seam.
//
// Every machine in the show (operator + side-wall render nodes) reads time from a
// ShowClock. On the operator it is the master; on render nodes it follows the master
// over the network link. Cues are scheduled in master-clock milliseconds, so a cue
// that says "start at T" starts at the same moment on every machine.
//
// The real synchronised implementation lives in the master clock work
// (see "Decide computers per projector setup"). LocalClock below is a placeholder
// that simply returns this machine's time, which is correct for a single-computer show.

export interface ClockStatus {
  role: "master" | "follower";
  synced: boolean;
  /** Estimated master - local offset in ms. */
  offsetMs: number;
  /** Round-trip time of the best recent sample in ms. */
  rttMs: number;
  lastSyncAt: number | null;
}

export interface ShowClock {
  /** Milliseconds on the master timeline. */
  now(): number;
  status(): ClockStatus;
  /** Optional: feed a "clock.*" message that arrived on a network link. */
  handleMessage?(msg: { type: string; [k: string]: unknown }, reply: (m: object) => void, peerId: string): void;
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
