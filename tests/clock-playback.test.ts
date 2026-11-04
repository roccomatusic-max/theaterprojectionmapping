/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { FollowerShowClock, MasterShowClock, type ClockMsg } from "../electron/clock";
import { localNow } from "../electron/clock/time";
import {
  VideoFollower,
  compareWalls,
  expectedVideoMs,
  type PlaybackReport,
  type VideoLike,
} from "../src/shared/clock-playback";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function still(wall: string, shownAt: number | null, extra: Partial<PlaybackReport> = {}): PlaybackReport {
  return { key: "k1", cueId: "c12", wall, mediaType: "image", startAt: 1000, shownAt, sampledAt: 2000, ...extra };
}

describe("comparing walls", () => {
  it("is idle with nothing on screen", () => {
    expect(compareWalls([], 0).state).toBe("idle");
  });

  it("calls stills in step when both walls put them up within a frame", () => {
    const s = compareWalls([still("left", 1003), still("right", 1020)], 2000);
    expect(s.state).toBe("in-step");
    expect(s.worstMs).toBe(17);
    expect(s.compared).toBe(1);
  });

  it("flags a still that one wall put up late", () => {
    const s = compareWalls([still("left", 1000), still("right", 1180)], 2000);
    expect(s.state).toBe("out-of-step");
    expect(s.issues[0].text).toBe("Right wall appeared 180 ms late");
  });

  it("flags a wall that has not shown a cue yet, or failed to load it", () => {
    expect(compareWalls([still("left", 1000), still("right", null)], 2000).issues[0].text).toBe(
      "Right wall has not shown it yet",
    );
    const failed = compareWalls([still("left", 1000), still("right", null, { error: "file not found" })], 2000);
    expect(failed.issues[0].text).toBe("Right wall: file not found");
  });

  it("flags a wall missing a cue it should be showing", () => {
    const s = compareWalls([still("left", 1000)], 2000, { k1: ["left", "right"] });
    expect(s.state).toBe("out-of-step");
    expect(s.issues[0].text).toBe("Right wall is not showing it");
  });

  it("is fine with a cue meant for one wall only", () => {
    expect(compareWalls([still("left", 1000)], 2000, { k1: ["left"] }).state).toBe("in-step");
  });

  it("compares moving video by position, allowing for different report times", () => {
    const v = (wall: string, pos: number, sampledAt: number): PlaybackReport =>
      still(wall, 1000, { mediaType: "video", videoPosMs: pos, videoPlaying: true, sampledAt });
    // Right reported 100 ms later and is 100 ms further on: same place.
    expect(compareWalls([v("left", 5000, 6000), v("right", 5100, 6100)], 6200).state).toBe("in-step");
    const s = compareWalls([v("left", 5000, 6000), v("right", 4930, 6000)], 6000);
    expect(s.state).toBe("drifting");
    expect(s.issues[0].text).toBe("Right wall 70 ms behind on video");
  });
});

/** A video element whose clock runs at its playbackRate, plus a fixed extra drift per second. */
class FakeVideo implements VideoLike {
  private t = 0;
  get currentTime() {
    return this.t;
  }
  /** Anything outside advance() setting the time is a seek. */
  set currentTime(s: number) {
    this.t = s;
    this.seeks++;
  }
  playbackRate = 1;
  duration = 30;
  paused = true;
  ended = false;
  seeks = 0;
  constructor(private driftPerSec = 0) {}
  play() {
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
  advance(ms: number) {
    if (this.paused) return;
    this.t += ((ms * this.playbackRate) / 1000) * (1 + this.driftPerSec);
  }
}

function run(video: FakeVideo, follower: VideoFollower, fromMs: number, toMs: number, frameMs = 16) {
  for (let t = fromMs; t < toMs; t += frameMs) {
    video.advance(frameMs);
    follower.update(t + frameMs);
  }
}

describe("video follower", () => {
  it("knows where a video should be", () => {
    expect(expectedVideoMs(1000, "loop", 10_000, 26_000)).toBe(5000);
    expect(expectedVideoMs(1000, "once", 10_000, 26_000)).toBe(10_000);
    expect(expectedVideoMs(1000, "hold", 10_000, 500)).toBe(0);
  });

  it("pulls a video that runs 2% fast back into line without seeking", () => {
    const video = new FakeVideo(0.02);
    const f = new VideoFollower(video, { startAt: 0, playMode: "loop" });
    run(video, f, 0, 200);
    const seeksBefore = video.seeks;
    run(video, f, 200, 20_000);
    expect(Math.abs(f.driftMs)).toBeLessThan(8);
    expect(video.seeks).toBe(seeksBefore);
    expect(Math.abs(video.playbackRate - 1)).toBeLessThanOrEqual(0.05);
  });

  it("seeks once when a video loads late, then stays locked", () => {
    const video = new FakeVideo();
    const f = new VideoFollower(video, { startAt: 0, playMode: "once" });
    // Video only becomes ready 1.2 s after the cue fired.
    f.update(1200);
    expect(video.seeks).toBe(1);
    expect(Math.abs(video.currentTime * 1000 - 1200)).toBeLessThan(1);
    run(video, f, 1200, 5000);
    expect(Math.abs(f.driftMs)).toBeLessThan(10);
  });

  it("holds the last frame when a once video ends", () => {
    const video = new FakeVideo();
    const f = new VideoFollower(video, { startAt: 0, playMode: "once" });
    run(video, f, 0, 31_000);
    expect(video.paused).toBe(true);
  });
});

describe("walls report to the booth", () => {
  it("the operator sees both walls in step, then spots one that slips", async () => {
    const master = new MasterShowClock();
    const walls = (["left", "right"] as const).map((wall, i) => {
      const clock = new FollowerShowClock(undefined, {
        name: `${wall} wall`,
        now: () => localNow() + (i ? -2500 : 4000),
      });
      const toWall = (m: object) => setImmediate(() => clock.handleMessage(m as ClockMsg));
      clock.attach((m) => setImmediate(() => master.handleMessage(m as ClockMsg, toWall, wall)));
      return { wall, clock };
    });
    await wait(800);

    // The operator fires a video cue on both walls 150 ms ahead.
    const startAt = master.now() + 150;
    master.setExpectedLayers({ k7: ["left", "right"] });
    const videos = walls.map(() => new FakeVideo());
    const followers = videos.map((v) => new VideoFollower(v, { startAt, playMode: "loop" }));
    let last = localNow();
    const report = (slipRightMs = 0) => {
      const step = localNow() - last;
      last = localNow();
      walls.forEach(({ wall, clock }, i) => {
        videos[i].advance(step);
        const now = clock.now();
        if (i === 1 && slipRightMs) videos[i].currentTime -= slipRightMs / 1000;
        else followers[i].update(now);
        clock.reportPlayback!([
          {
            key: "k7",
            cueId: "c7",
            wall,
            mediaType: "video",
            startAt,
            shownAt: now >= startAt ? startAt : null,
            sampledAt: now,
            ...followers[i].report(),
          },
        ]);
      });
    };
    for (let i = 0; i < 60; i++) {
      report();
      await wait(16);
    }
    await wait(300);
    let walls1 = master.status().walls!;
    expect(walls1.state).toBe("in-step");
    expect(walls1.worstMs).toBeLessThan(IN_STEP);

    // Right wall's video stalls by 300 ms (and its follower is not correcting).
    report(300);
    await wait(300);
    walls1 = master.status().walls!;
    expect(walls1.state).toBe("out-of-step");
    expect(walls1.issues[0].text).toMatch(/^Right wall \d+ ms behind on video$/);
    walls.forEach(({ clock }) => clock.dispose!());
  });
});

const IN_STEP = 34;
