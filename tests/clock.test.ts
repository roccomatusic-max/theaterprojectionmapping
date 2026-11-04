import { describe, expect, it } from "vitest";
import { OffsetEstimator } from "../electron/clock/estimator";
import { formatTimecode, showTimeAt } from "../src/shared/clock";

/** Simulates a wall whose clock is `trueOffset` ms behind master on a jittery network. */
function exchange(est: OffsetEstimator, wallTime: number, trueOffset: number, upMs: number, downMs: number) {
  const t0 = wallTime;
  const t1 = t0 + trueOffset + upMs;
  const t2 = t1 + 0.05;
  const t3 = t2 - trueOffset + downMs;
  est.add(t0, t1, t2, t3);
}

describe("clock offset estimator", () => {
  it("finds a large clock difference within a millisecond", () => {
    const est = new OffsetEstimator();
    for (let i = 0; i < 20; i++) exchange(est, 1000 + i * 50, 4321.5, 0.3, 0.3);
    expect(Math.abs(est.offset - 4321.5)).toBeLessThan(1);
    expect(est.status).toBe("locked");
  });

  it("ignores slow, lopsided packets by trusting the fastest round trips", () => {
    const est = new OffsetEstimator();
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 64; i++) {
      // Most packets are fast; some sit in a queue on the way up for 5-40 ms.
      const up = rand() < 0.3 ? 5 + rand() * 35 : 0.2 + rand() * 0.3;
      exchange(est, i * 50, -1500, up, 0.2 + rand() * 0.3);
    }
    expect(Math.abs(est.offset - -1500)).toBeLessThan(1);
  });

  it("slews small changes instead of jumping", () => {
    const est = new OffsetEstimator({ window: 4 });
    for (let i = 0; i < 8; i++) exchange(est, i * 50, 100, 0.2, 0.2);
    for (let i = 0; i < 4; i++) exchange(est, 1000 + i * 50, 110, 0.2, 0.2);
    // Moving 10 ms should take a few samples, not happen in one step.
    expect(est.offset).toBeGreaterThan(100);
    expect(est.offset).toBeLessThan(110);
  });

  it("steps immediately on a big jump", () => {
    const est = new OffsetEstimator({ window: 4 });
    for (let i = 0; i < 8; i++) exchange(est, i * 50, 100, 0.2, 0.2);
    for (let i = 0; i < 4; i++) exchange(est, 1000 + i * 50, 900, 0.2, 0.2);
    expect(Math.abs(est.offset - 900)).toBeLessThan(1);
  });
});

describe("show clock helpers", () => {
  it("computes show time and timecode", () => {
    const show = { running: true, startedAt: 10_000, pausedAt: 0, version: 1, session: "x" };
    expect(showTimeAt(show, 12_500)).toBe(2500);
    expect(showTimeAt({ ...show, running: false, pausedAt: 777 }, 99_999)).toBe(777);
    expect(formatTimecode(0)).toBe("00:00:00:00");
    expect(formatTimecode(3_723_500)).toBe("01:02:03:15");
  });
});
