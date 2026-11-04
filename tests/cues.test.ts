import { describe, expect, it } from "vitest";
import { back, expectedLayers, fireCue, go, initialPlayback, layerOpacity, panic, prune, setStandby, standbyMedia, videoTimeAt } from "../src/shared/cueEngine";
import { emptyShow } from "../src/shared/defaults";
import type { Show } from "../src/shared/types";

function show(): Show {
  const s = emptyShow();
  s.cues[1].media = { type: "video", file: "scene.mp4" };
  return s;
}

describe("cue engine", () => {
  it("starts with an empty show containing three example cues", () => {
    const s = emptyShow();
    expect(s.cues.map((c) => c.name)).toEqual(["Example: preshow", "Example: scene look", "Example: blackout"]);
  });

  it("GO fires the standby cue and advances", () => {
    const s = show();
    let st = initialPlayback();
    st = go(st, s, 1000);
    expect(st.currentIndex).toBe(0);
    expect(st.standbyIndex).toBe(1);
    expect(st.walls.left.length).toBe(1);
    expect(st.walls.right.length).toBe(1);
  });

  it("fades in over fadeIn and the replaced look fades out over the new cue's fadeOut", () => {
    const s = show();
    let st = go(initialPlayback(), s, 0); // preshow, 3 s fade in
    const l1 = st.walls.left[0];
    expect(layerOpacity(l1, 0)).toBe(0);
    expect(layerOpacity(l1, 1500)).toBeCloseTo(0.5, 9);
    expect(layerOpacity(l1, 3000)).toBe(1);
    st = go(st, s, 10_000); // scene look: fadeOut 2 s
    const old = st.walls.left[0];
    expect(old.fadeOutAt).toBe(10_000);
    expect(layerOpacity(old, 11_000)).toBeCloseTo(0.5, 9);
    expect(layerOpacity(old, 12_000)).toBe(0);
    st = prune(st, 12_500);
    expect(st.walls.left.length).toBe(1);
  });

  it("a black cue fades everything out and adds no layer", () => {
    const s = show();
    let st = go(go(go(initialPlayback(), s, 0), s, 5000), s, 9000);
    expect(st.walls.left.every((l) => l.fadeOutAt !== null)).toBe(true);
    st = prune(st, 20_000);
    expect(st.walls.left.length).toBe(0);
    expect(go(st, s, 21_000)).toBe(st); // end of list: GO does nothing
  });

  it("BACK restores the previous look and keeps the current cue on standby", () => {
    const s = show();
    let st = go(go(initialPlayback(), s, 0), s, 5000);
    st = back(st, s, 8000);
    expect(st.currentIndex).toBe(0);
    expect(st.standbyIndex).toBe(1);
    const live = st.walls.left.filter((l) => l.fadeOutAt === null);
    expect(live.length).toBe(1);
    expect(live[0].cueId).toBe(s.cues[0].id);
  });

  it("PANIC blacks out immediately, keeps the cue position, and GO recovers", () => {
    const s = show();
    let st = go(initialPlayback(), s, 0);
    st = panic(st);
    expect(st.blackout).toBe(true);
    expect(st.walls.left.length).toBe(0);
    expect(st.standbyIndex).toBe(1);
    st = go(st, s, 100);
    expect(st.blackout).toBe(false);
  });

  it("preloads the standby cue's media", () => {
    const s = show();
    let st = go(initialPlayback(), s, 0);
    expect(standbyMedia(st, s)).toEqual([{ type: "video", file: "scene.mp4" }]);
    st = setStandby(st, s, 2);
    expect(standbyMedia(st, s)).toEqual([]);
  });

  it("one firing shares its layer key across walls so the walls can be compared", () => {
    const s = show();
    const st = go(initialPlayback(), s, 0);
    expect(st.walls.left[0].key).toBe(st.walls.right[0].key);
    expect(expectedLayers(st)).toEqual({ [st.walls.left[0].key]: ["left", "right"] });
  });

  it("re-firing a cue creates a new layer key so video restarts", () => {
    const s = show();
    const a = fireCue(initialPlayback(), s, 1, 0);
    const b = fireCue(a, s, 1, 1000);
    const live = b.walls.left.filter((l) => l.fadeOutAt === null);
    expect(live[0].key).not.toBe(a.walls.left[0].key);
  });
});

describe("video timing on the master clock", () => {
  const base = { key: "k", cueId: "c", media: { type: "video" as const, file: "a.mp4" }, fit: "cover" as const, startAt: 1000, fadeInMs: 0, fadeOutAt: null, fadeOutMs: 0 };
  it("loop wraps", () => {
    expect(videoTimeAt({ ...base, playMode: "loop" }, 1000 + 12_500, 10).time).toBeCloseTo(2.5, 9);
  });
  it("once ends and hides", () => {
    const r = videoTimeAt({ ...base, playMode: "once" }, 1000 + 12_500, 10);
    expect(r.visible).toBe(false);
  });
  it("hold freezes on the last frame", () => {
    const r = videoTimeAt({ ...base, playMode: "hold" }, 1000 + 12_500, 10);
    expect(r.visible).toBe(true);
    expect(r.time).toBeCloseTo(9.95, 9);
  });
  it("before the start time the video waits on frame 0", () => {
    expect(videoTimeAt({ ...base, playMode: "loop" }, 900, 10).time).toBe(0);
  });
});
