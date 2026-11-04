// Sensible starting values. Every number here is editable in the app.

import type { Cue, Mesh, OutputConfig, Plan, Projector, Show, WallId } from "./types";
import { aimAt, fitZoom, wallFrame } from "./geometry";

let idCounter = 0;
export function uid(prefix: string): string {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}${idCounter}`;
}

export const PROJECTOR_COLORS = ["#4fa3ff", "#ff8a3d", "#3ddc97", "#e05cff", "#ffd23d", "#ff4f6d"];

export function baseProjector(partial: Partial<Projector> = {}): Projector {
  return {
    id: uid("proj"),
    name: "Projector",
    x: 0,
    y: 0,
    mountHeight: 16,
    pan: 90,
    tilt: -10,
    roll: 0,
    lumens: 8000,
    resolutionW: 1920,
    resolutionH: 1200,
    throwRatio: 1.6,
    throwRatioMin: 1.2,
    throwRatioMax: 2.4,
    lensShiftV: 0,
    lensShiftH: 0,
    targetWall: "right",
    color: PROJECTOR_COLORS[0],
    ...partial,
  };
}

export function defaultPlan(): Plan {
  const plan: Plan = {
    version: 1,
    name: "Matilda JR — auditorium",
    units: "imperial",
    room: {
      frontWidth: 48,
      backWidth: 56,
      length: 72,
      wallHeight: 20,
      wallOverrides: { left: null, right: null },
    },
    audience: {
      outline: [
        { x: -19, y: 8 },
        { x: 19, y: 8 },
        { x: 22, y: 66 },
        { x: -22, y: 66 },
      ],
      seatedHeadHeight: 4,
      standingHeadHeight: 6,
    },
    projectors: [],
    surfaces: {
      left: { gain: 0.8, color: "#d8d2c4" },
      right: { gain: 0.8, color: "#d8d2c4" },
    },
    obstructions: [
      {
        id: uid("obs"),
        wall: "left",
        kind: "exit-sign",
        label: "Exit sign",
        fromStage: 30,
        bottom: 8,
        width: 1.25,
        height: 0.75,
        neverProject: true,
      },
      {
        id: uid("obs"),
        wall: "left",
        kind: "door",
        label: "Side door",
        fromStage: 29,
        bottom: 0,
        width: 3.5,
        height: 7,
        neverProject: false,
      },
      {
        id: uid("obs"),
        wall: "right",
        kind: "exit-sign",
        label: "Exit sign",
        fromStage: 30,
        bottom: 8,
        width: 1.25,
        height: 0.75,
        neverProject: true,
      },
      {
        id: uid("obs"),
        wall: "right",
        kind: "door",
        label: "Side door",
        fromStage: 29,
        bottom: 0,
        width: 3.5,
        height: 7,
        neverProject: false,
      },
    ],
    derate: 0.8,
    goodFL: 8,
    okFL: 5,
  };
  // Two projectors stacked in each back corner, cross-shooting to the opposite wall:
  // one covers the front half of that wall, one the back half, overlapping ~15%.
  const r = plan.room;
  const inset = 1.5;
  const corners: { side: "left" | "right"; x: number; target: WallId }[] = [
    { side: "left", x: -r.backWidth / 2 + inset, target: "right" },
    { side: "right", x: r.backWidth / 2 - inset, target: "left" },
  ];
  let ci = 0;
  for (const c of corners) {
    for (const half of ["front", "back"] as const) {
      const p = baseProjector({
        name: `${c.side === "left" ? "Back-left" : "Back-right"} ${half} (→ ${c.target} wall)`,
        x: c.x,
        y: r.length - inset,
        mountHeight: half === "front" ? 17 : 15.5,
        targetWall: c.target,
        color: PROJECTOR_COLORS[ci++ % PROJECTOR_COLORS.length],
      });
      aimProjectorAtHalf(plan, p, half, 0.15);
      plan.projectors.push(p);
    }
  }
  return plan;
}

/** Aim and zoom a projector to cover the front or back half of its target wall. */
export function aimProjectorAtHalf(plan: Plan, p: Projector, half: "front" | "back", overlap: number): void {
  const f = wallFrame(plan.room, p.targetWall);
  const halfLen = f.length / 2;
  const width = halfLen * (1 + overlap);
  // s measured from the stage end.
  const sCentre = half === "front" ? width / 2 : f.length - width / 2;
  const x = p.targetWall === "right" ? sCentre : f.length - sCentre;
  const target = { x, y: f.height / 2 };
  const a = aimAt(p, plan.room, target);
  p.pan = round(a.pan, 2);
  p.tilt = round(a.tilt, 2);
  p.throwRatio = round(fitZoom(p, plan.room, width), 3);
  const a2 = aimAt(p, plan.room, target);
  p.pan = round(a2.pan, 2);
  p.tilt = round(a2.tilt, 2);
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

export function identityMesh(cols = 3, rows = 3): Mesh {
  return { cols, rows, offsets: Array.from({ length: cols * rows }, () => ({ x: 0, y: 0 })) };
}

export const DEFAULT_BLEND = { width: 0, curve: 2, gamma: 2.2 };

export function defaultOutput(partial: Partial<OutputConfig> = {}): OutputConfig {
  return {
    id: uid("out"),
    name: "Output",
    wall: "left",
    node: "local",
    displayId: null,
    width: 1920,
    height: 1200,
    slice: { x0: 0, y0: 0, x1: 36, y1: 20 },
    corners: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    mesh: identityMesh(),
    blend: {
      left: { ...DEFAULT_BLEND },
      right: { ...DEFAULT_BLEND },
      top: { ...DEFAULT_BLEND },
      bottom: { ...DEFAULT_BLEND },
    },
    brightness: 1,
    rgb: [1, 1, 1],
    masks: [],
    color: PROJECTOR_COLORS[0],
    ...partial,
  };
}

export function exampleCues(): Cue[] {
  return [
    {
      id: uid("cue"),
      number: "1",
      name: "Example: preshow",
      walls: ["left", "right"],
      media: { type: "color", color: "#1b2a5c" },
      playMode: "loop",
      fit: "cover",
      fadeIn: 3,
      fadeOut: 2,
      autoFollow: false,
      followDelay: 0,
      notes: "Replace with your preshow look (a video loop or a still).",
    },
    {
      id: uid("cue"),
      number: "2",
      name: "Example: scene look",
      walls: ["left", "right"],
      media: { type: "color", color: "#7a3b8f" },
      playMode: "hold",
      fit: "cover",
      fadeIn: 2,
      fadeOut: 2,
      autoFollow: false,
      followDelay: 0,
      notes: "Pick a video or image with the Media button.",
    },
    {
      id: uid("cue"),
      number: "3",
      name: "Example: blackout",
      walls: ["left", "right"],
      media: { type: "black" },
      playMode: "hold",
      fit: "cover",
      fadeIn: 0,
      fadeOut: 1.5,
      autoFollow: false,
      followDelay: 0,
    },
  ];
}

export function emptyShow(): Show {
  return {
    version: 1,
    name: "Matilda JR show",
    walls: {
      left: { width: 72.4, height: 20, pixelsPerFoot: 40 },
      right: { width: 72.4, height: 20, pixelsPerFoot: 40 },
    },
    wallMasks: { left: [], right: [] },
    nodes: [],
    outputs: [],
    cues: exampleCues(),
    osc: { enabled: false, port: 8000 },
  };
}
