// Keeping the walls in step with each other during the show.
//
// Both walls follow the master clock, so if each one places every image and
// every video frame by master time, they match each other. This file has the
// two halves of that:
//
//  1. On each wall: VideoFollower keeps a playing video locked to the master
//     clock (tiny speed changes for small drift, a seek for big drift). Stills
//     and fades need no helper: show them at layer.startAt in master time and
//     compute fade opacity from clock.now() every frame, never from CSS timers.
//
//  2. Each wall reports what it is actually showing (PlaybackReport) with its
//     clock pings. The operator compares the walls (compareWalls) and the clock
//     panel shows whether they are in step, and by how much.
//
// Shared by the Electron main process and the React UI, so no Node imports.

/** What one wall is actually showing for one layer, sent with its clock pings. */
export interface PlaybackReport {
  /** Layer.key: unique per cue firing, so the same firing can be matched across walls. */
  key: string;
  cueId: string;
  /** Cue number as the operator knows it (Cue.number), for messages. */
  cueNumber?: string;
  /** Wall id ("left" / "right"). */
  wall: string;
  mediaType: "video" | "image" | "color" | "black";
  /** Master time the layer was meant to appear (Layer.startAt). */
  startAt: number;
  /** Master time the layer actually became visible, or null if it has not (still loading, failed). */
  shownAt: number | null;
  /** Video only: position in ms at sampledAt. */
  videoPosMs?: number;
  /** Video only: true while the video is playing (not paused or ended). */
  videoPlaying?: boolean;
  /** Master time this report was taken. */
  sampledAt: number;
  /** Set if the media failed to load or play. */
  error?: string;
}

export type WallSyncState = "idle" | "in-step" | "drifting" | "out-of-step";

export interface WallSyncIssue {
  cueId: string;
  /** Cue number if the wall sent it, else the cue id. */
  cue: string;
  key: string;
  /** Short, operator-facing description, e.g. "Right wall 140 ms behind on video". */
  text: string;
  diffMs: number;
  state: WallSyncState;
}

export interface WallSyncSummary {
  state: WallSyncState;
  /** Biggest difference between walls right now, in ms (0 when idle). */
  worstMs: number;
  /** Cue firings compared. */
  compared: number;
  issues: WallSyncIssue[];
}

/** Up to one frame at 30 fps is invisible. */
export const IN_STEP_MS = 34;
/** Past this, someone in the audience could notice. */
export const OUT_OF_STEP_MS = 100;

function grade(diffMs: number): WallSyncState {
  if (diffMs <= IN_STEP_MS) return "in-step";
  if (diffMs <= OUT_OF_STEP_MS) return "drifting";
  return "out-of-step";
}

const RANK: Record<WallSyncState, number> = { idle: 0, "in-step": 1, drifting: 2, "out-of-step": 3 };

function wallLabel(wall: string): string {
  return wall ? `${wall[0].toUpperCase()}${wall.slice(1)} wall` : "A wall";
}

/** Video position extrapolated to master time `at`. */
function videoPosAt(r: PlaybackReport, at: number): number {
  const pos = r.videoPosMs ?? 0;
  return r.videoPlaying ? pos + (at - r.sampledAt) : pos;
}

/**
 * Compares what the walls report. Reports for the same cue firing (same key)
 * on different walls are matched; a firing on only one wall is fine (cues can
 * target one wall), unless `expected` says the cue should be on both.
 *
 * @param reports every wall's latest reports, flattened
 * @param now master time
 * @param expected optional: for each live layer key, the walls it should be on
 */
export function compareWalls(
  reports: PlaybackReport[],
  now: number,
  expected?: Record<string, string[]>,
): WallSyncSummary {
  const byKey = new Map<string, PlaybackReport[]>();
  for (const r of reports) {
    const list = byKey.get(r.key) ?? [];
    list.push(r);
    byKey.set(r.key, list);
  }

  const issues: WallSyncIssue[] = [];
  let worst = 0;
  let compared = 0;
  let state: WallSyncState = "idle";
  const bump = (s: WallSyncState) => {
    if (RANK[s] > RANK[state]) state = s;
  };

  for (const [key, list] of byKey) {
    const cueId = list[0].cueId;
    const cue = list[0].cueNumber ?? cueId;

    for (const r of list) {
      if (r.error) {
        issues.push({ cueId, cue, key, text: `${wallLabel(r.wall)}: ${r.error}`, diffMs: Infinity, state: "out-of-step" });
        bump("out-of-step");
      } else if (r.shownAt === null && now - r.startAt > OUT_OF_STEP_MS) {
        issues.push({ cueId, cue, key, text: `${wallLabel(r.wall)} has not shown it yet`, diffMs: now - r.startAt, state: "out-of-step" });
        bump("out-of-step");
      }
    }

    const missing = (expected?.[key] ?? []).filter((w) => !list.some((r) => r.wall === w));
    for (const w of missing) {
      issues.push({ cueId, cue, key, text: `${wallLabel(w)} is not showing it`, diffMs: Infinity, state: "out-of-step" });
      bump("out-of-step");
    }

    const shown = list.filter((r) => r.shownAt !== null && !r.error);
    if (shown.length < 2) {
      if (shown.length === 1) bump("in-step");
      continue;
    }
    compared++;

    // When did each wall put it up? Matters for stills and the start of every fade.
    const starts = shown.map((r) => r.shownAt!);
    let diff = Math.max(...starts) - Math.min(...starts);
    let late = shown[starts.indexOf(Math.max(...starts))];
    let what = "appeared";

    // For moving media, what matters is where each video is right now: a late
    // start is caught up by VideoFollower, so compare positions instead.
    const videos = shown.filter((r) => r.mediaType === "video" && r.videoPosMs !== undefined);
    if (videos.length >= 2) {
      const pos = videos.map((r) => videoPosAt(r, now));
      diff = Math.max(...pos) - Math.min(...pos);
      late = videos[pos.indexOf(Math.min(...pos))];
      what = "video";
    }

    worst = Math.max(worst, diff);
    const s = grade(diff);
    bump(s);
    if (s !== "in-step") {
      const text =
        what === "video"
          ? `${wallLabel(late.wall)} ${Math.round(diff)} ms behind on video`
          : `${wallLabel(late.wall)} appeared ${Math.round(diff)} ms late`;
      issues.push({ cueId, cue, key, text, diffMs: diff, state: s });
    }
  }

  issues.sort((a, b) => RANK[b.state] - RANK[a.state] || b.diffMs - a.diffMs);
  return { state, worstMs: worst, compared, issues };
}

// ---------------------------------------------------------------------------
// Video on a wall
// ---------------------------------------------------------------------------

/** The bits of HTMLVideoElement we touch, so tests can use a fake. */
export interface VideoLike {
  currentTime: number;
  playbackRate: number;
  duration: number;
  paused: boolean;
  ended: boolean;
  play(): Promise<void> | void;
  pause(): void;
}

/**
 * Where a video should be at master time `now`, in ms.
 * loop: wraps around. once / hold: stops on the last frame.
 */
export function expectedVideoMs(startAt: number, playMode: "loop" | "once" | "hold", durationMs: number, now: number): number {
  const elapsed = Math.max(0, now - startAt);
  if (!(durationMs > 0)) return elapsed;
  if (playMode === "loop") return elapsed % durationMs;
  return Math.min(elapsed, durationMs);
}

export interface VideoFollowerOptions {
  /** Within this, leave the speed at 1.0 (ms). */
  deadbandMs?: number;
  /** Beyond this, seek instead of nudging the speed (ms). */
  seekThresholdMs?: number;
  /** Largest speed change used to catch up, e.g. 0.05 = 5%. Small enough not to be seen or heard. */
  maxRateChange?: number;
}

/**
 * Keeps one video element locked to the master clock. Call update() every frame
 * (requestAnimationFrame) with the master time.
 *
 * Small drift is fixed by playing up to 5% faster or slower, which nobody
 * notices; big drift (after a stall or a late load) is fixed with one seek.
 */
export class VideoFollower {
  private readonly opts: Required<VideoFollowerOptions>;
  private lastSeekAt = -Infinity;
  /** Last difference seen, target minus actual (ms). Positive = video is behind. */
  driftMs = 0;

  constructor(
    private readonly video: VideoLike,
    private readonly layer: { startAt: number; playMode: "loop" | "once" | "hold" },
    opts: VideoFollowerOptions = {},
  ) {
    this.opts = { deadbandMs: 8, seekThresholdMs: 250, maxRateChange: 0.05, ...opts };
  }

  update(now: number): void {
    const v = this.video;
    if (now < this.layer.startAt) {
      if (!v.paused) v.pause();
      if (v.currentTime !== 0) v.currentTime = 0;
      return;
    }
    const durationMs = (v.duration || 0) * 1000;
    const target = expectedVideoMs(this.layer.startAt, this.layer.playMode, durationMs, now);
    const actual = v.currentTime * 1000;
    const finished = this.layer.playMode !== "loop" && durationMs > 0 && target >= durationMs;

    if (finished) {
      // Hold the last frame on every wall.
      if (!v.paused) v.pause();
      v.playbackRate = 1;
      this.driftMs = 0;
      return;
    }

    let drift = target - actual;
    // Around a loop point, the short way round is the right one.
    if (this.layer.playMode === "loop" && durationMs > 0) {
      if (drift > durationMs / 2) drift -= durationMs;
      else if (drift < -durationMs / 2) drift += durationMs;
    }
    this.driftMs = drift;

    if (v.paused || v.ended) void v.play();

    // Leave a seek time to land before judging again.
    if (Math.abs(drift) > this.opts.seekThresholdMs && now - this.lastSeekAt > 500) {
      v.currentTime = target / 1000;
      v.playbackRate = 1;
      this.lastSeekAt = now;
      return;
    }
    if (Math.abs(drift) <= this.opts.deadbandMs) {
      v.playbackRate = 1;
      return;
    }
    // Catch up over about a quarter of a second.
    const change = Math.max(-this.opts.maxRateChange, Math.min(this.opts.maxRateChange, drift / 250));
    v.playbackRate = 1 + change;
  }

  /** For the PlaybackReport sent to the operator. */
  report(): { videoPosMs: number; videoPlaying: boolean } {
    return { videoPosMs: this.video.currentTime * 1000, videoPlaying: !this.video.paused && !this.video.ended };
  }
}
