// Cue engine. Pure functions: the operator computes the playback state and sends it
// to every output. Times are master-clock milliseconds, so every machine evaluates
// fades and video positions identically.

import type { Cue, Layer, Media, PlaybackState, Show, WallId } from "./types";
import { WALL_IDS } from "./types";

let keyCounter = 0;
const newKey = () => `L${Date.now().toString(36)}${(keyCounter++).toString(36)}`;

export function initialPlayback(): PlaybackState {
  return {
    seq: 0,
    walls: { left: [], right: [] },
    currentIndex: -1,
    standbyIndex: 0,
    blackout: false,
    testPatterns: {},
  };
}

function cloneWalls(s: PlaybackState): Record<WallId, Layer[]> {
  return { left: [...s.walls.left], right: [...s.walls.right] };
}

/** Fire cue `index` so that it starts at master time `at`. */
export function fireCue(state: PlaybackState, show: Show, index: number, at: number): PlaybackState {
  const cue = show.cues[index];
  if (!cue) return state;
  const walls = cloneWalls(state);
  // One key per firing, shared by every wall, so the walls can be compared.
  const layer = layerFor(cue, at);
  for (const w of cue.walls) {
    walls[w] = walls[w].map((l) =>
      l.fadeOutAt === null ? { ...l, fadeOutAt: at, fadeOutMs: Math.max(0, cue.fadeOut) * 1000 } : l,
    );
    if (cue.media.type !== "black") walls[w].push({ ...layer, media: { ...layer.media } });
  }
  return {
    ...state,
    seq: state.seq + 1,
    walls,
    blackout: false,
    currentIndex: index,
    standbyIndex: Math.min(index + 1, show.cues.length),
  };
}

function layerFor(cue: Cue, at: number): Layer {
  return {
    key: newKey(),
    cueId: cue.id,
    media: { ...cue.media },
    playMode: cue.playMode,
    fit: cue.fit,
    startAt: at,
    fadeInMs: Math.max(0, cue.fadeIn) * 1000,
    fadeOutAt: null,
    fadeOutMs: 0,
  };
}

/** GO: fire the standby cue. */
export function go(state: PlaybackState, show: Show, at: number): PlaybackState {
  if (state.standbyIndex >= show.cues.length) return state;
  return fireCue(state, show, state.standbyIndex, at);
}

/**
 * BACK: return to the previous look. Re-fires the cue before the current one and
 * leaves the current cue on standby. From the first cue, fades everything out.
 */
export function back(state: PlaybackState, show: Show, at: number): PlaybackState {
  const cur = state.currentIndex;
  if (cur <= 0) {
    const faded = fadeAll(state, at, 1000);
    return { ...faded, currentIndex: -1, standbyIndex: 0 };
  }
  const s = fireCue(state, show, cur - 1, at);
  return { ...s, standbyIndex: cur };
}

/** Move the standby (next) cue without firing anything. */
export function setStandby(state: PlaybackState, show: Show, index: number): PlaybackState {
  return { ...state, seq: state.seq + 1, standbyIndex: Math.max(0, Math.min(index, show.cues.length)) };
}

export function fadeAll(state: PlaybackState, at: number, ms: number): PlaybackState {
  const walls = cloneWalls(state);
  for (const w of WALL_IDS) walls[w] = walls[w].map((l) => (l.fadeOutAt === null ? { ...l, fadeOutAt: at, fadeOutMs: ms } : l));
  return { ...state, seq: state.seq + 1, walls };
}

/** PANIC / BLACKOUT: every output goes black immediately. The cue position is kept. */
export function panic(state: PlaybackState): PlaybackState {
  return { ...state, seq: state.seq + 1, walls: { left: [], right: [] }, blackout: true };
}

/** Drop layers whose fade-out has finished. Returns the same object if nothing changed. */
export function prune(state: PlaybackState, now: number): PlaybackState {
  let changed = false;
  const walls = cloneWalls(state);
  for (const w of WALL_IDS) {
    const kept = walls[w].filter((l) => l.fadeOutAt === null || now < l.fadeOutAt + l.fadeOutMs + 100);
    if (kept.length !== walls[w].length) changed = true;
    walls[w] = kept;
  }
  return changed ? { ...state, seq: state.seq + 1, walls } : state;
}

export function layerOpacity(l: Layer, t: number): number {
  if (t < l.startAt) return 0;
  const fin = l.fadeInMs > 0 ? Math.min(1, (t - l.startAt) / l.fadeInMs) : 1;
  let fout = 1;
  if (l.fadeOutAt !== null) {
    if (t >= l.fadeOutAt) fout = l.fadeOutMs > 0 ? Math.max(0, 1 - (t - l.fadeOutAt) / l.fadeOutMs) : 0;
  }
  return fin * fout;
}

/**
 * Where a video layer should be at master time t.
 * Returns the media time in seconds and whether the frame should be visible.
 */
export function videoTimeAt(l: Layer, t: number, duration: number): { time: number; visible: boolean; ended: boolean } {
  const elapsed = Math.max(0, (t - l.startAt) / 1000);
  if (!(duration > 0) || !isFinite(duration)) return { time: elapsed, visible: true, ended: false };
  switch (l.playMode) {
    case "loop":
      return { time: elapsed % duration, visible: true, ended: false };
    case "once":
      return elapsed >= duration ? { time: duration, visible: false, ended: true } : { time: elapsed, visible: true, ended: false };
    case "hold":
    default:
      return elapsed >= duration
        ? { time: Math.max(0, duration - 0.05), visible: true, ended: true }
        : { time: elapsed, visible: true, ended: false };
  }
}

/** For the wall-sync check: each live layer key and the walls it should be on. */
export function expectedLayers(state: PlaybackState): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (state.blackout) return out;
  for (const w of WALL_IDS)
    for (const l of state.walls[w]) if (l.fadeOutAt === null) (out[l.key] ??= []).push(w);
  return out;
}

/** Media that the standby cue needs, so outputs can preload it. */
export function standbyMedia(state: PlaybackState, show: Show): Media[] {
  const cue = show.cues[state.standbyIndex];
  return cue && (cue.media.type === "video" || cue.media.type === "image") ? [cue.media] : [];
}

/** All files referenced by the cue list. */
export function mediaFiles(show: Show): string[] {
  const s = new Set<string>();
  for (const c of show.cues) if (c.media.file && (c.media.type === "video" || c.media.type === "image")) s.add(c.media.file);
  return [...s];
}
