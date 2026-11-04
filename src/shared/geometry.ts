// Planner math: room walls, projector frustums, footprints, brightness, sharpness,
// shadows, blend overlap and obstruction checks. See README "How the numbers work".

import type { Obstruction, Plan, Projector, Rect, Room, Vec2, Vec3, WallId, WallLine } from "./types";
import { WALL_IDS } from "./types";
import { applyH, homographyFrom4, Mat3, UNIT_SQUARE } from "./homography";
import { area, bounds, clipConvex, pointInPolygon, rectPoly } from "./polygon";

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Vectors
// ---------------------------------------------------------------------------
export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, s: number): Vec3 => v3(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 =>
  v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const len = (a: Vec3): number => Math.sqrt(dot(a, a));
export const norm = (a: Vec3): Vec3 => scale(a, 1 / len(a));

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

export function defaultWallLine(room: Room, wall: WallId): WallLine {
  const sx = wall === "left" ? -1 : 1;
  return {
    start: { x: (sx * room.frontWidth) / 2, y: 0 },
    end: { x: (sx * room.backWidth) / 2, y: room.length },
  };
}

export function wallLine(room: Room, wall: WallId): WallLine {
  return room.wallOverrides[wall] ?? defaultWallLine(room, wall);
}

export interface WallFrame {
  wall: WallId;
  start: Vec3;
  /** Unit vector along the wall, from the stage end towards the back. */
  along: Vec3;
  /** Unit horizontal normal pointing into the room. */
  inward: Vec3;
  length: number;
  height: number;
}

export function wallFrame(room: Room, wall: WallId): WallFrame {
  const l = wallLine(room, wall);
  const start = v3(l.start.x, l.start.y, 0);
  const d = v3(l.end.x - l.start.x, l.end.y - l.start.y, 0);
  const length = len(d);
  const along = scale(d, 1 / length);
  // Perpendicular, then flip it to point towards the room centre line (x = 0).
  let inward = v3(-along.y, along.x, 0);
  const mid = add(start, scale(along, length / 2));
  if (dot(inward, v3(-mid.x, 0, 0)) < 0) inward = scale(inward, -1);
  return { wall, start, along, inward, length, height: room.wallHeight };
}

/**
 * Wall-canvas coordinates (feet) as seen from inside the room looking at the wall:
 * x from the left edge, y down from the top. On the right wall the stage end is on
 * the left; on the left wall the stage end is on the right.
 */
export function wallPointToCanvas(f: WallFrame, p: Vec3): Vec2 {
  const s = dot(sub(p, f.start), f.along);
  return { x: f.wall === "right" ? s : f.length - s, y: f.height - p.z };
}

export function canvasToWallPoint(f: WallFrame, c: Vec2): Vec3 {
  const s = f.wall === "right" ? c.x : f.length - c.x;
  const p = add(f.start, scale(f.along, s));
  return v3(p.x, p.y, f.height - c.y);
}

/** Obstruction rectangle in canvas coordinates. */
export function obstructionRect(f: WallFrame, o: Obstruction): Rect {
  const s0 = o.fromStage;
  const s1 = o.fromStage + o.width;
  const x0 = f.wall === "right" ? s0 : f.length - s1;
  const top = f.height - (o.bottom + o.height);
  return { x0, y0: top, x1: x0 + o.width, y1: top + o.height };
}

// ---------------------------------------------------------------------------
// Projector frustum
// ---------------------------------------------------------------------------

export interface ProjectorBasis {
  origin: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
  /** Image half-extents on the plane one foot in front of the lens. */
  halfW: number;
  halfH: number;
  shiftX: number;
  shiftY: number;
}

export function projectorBasis(p: Projector): ProjectorBasis {
  const pan = p.pan * DEG;
  const tilt = p.tilt * DEG;
  const roll = p.roll * DEG;
  const forward = v3(Math.sin(pan) * Math.cos(tilt), -Math.cos(pan) * Math.cos(tilt), Math.sin(tilt));
  const right0 = v3(Math.cos(pan), Math.sin(pan), 0);
  const up0 = cross(forward, right0); // +z when pan = tilt = 0
  // Roll the image about the lens axis.
  const right = add(scale(right0, Math.cos(roll)), scale(up0, -Math.sin(roll)));
  const up = add(scale(up0, Math.cos(roll)), scale(right0, Math.sin(roll)));
  const imageW = 1 / p.throwRatio;
  const imageH = (imageW * p.resolutionH) / p.resolutionW;
  return {
    origin: v3(p.x, p.y, p.mountHeight),
    forward,
    right,
    up,
    halfW: imageW / 2,
    halfH: imageH / 2,
    shiftX: (p.lensShiftH / 100) * imageW,
    shiftY: (p.lensShiftV / 100) * imageH,
  };
}

/** Ray direction (not normalised) through image point (u, v), u right, v down, 0..1. */
export function imageRay(b: ProjectorBasis, u: number, v: number): Vec3 {
  const xi = (u - 0.5) * 2 * b.halfW + b.shiftX;
  const yi = (0.5 - v) * 2 * b.halfH + b.shiftY;
  return add(add(b.forward, scale(b.right, xi)), scale(b.up, yi));
}

/** Ray–plane intersection with the (infinite) wall plane. Returns distance t along dir, or null. */
export function intersectWall(origin: Vec3, dir: Vec3, f: WallFrame): { point: Vec3; t: number } | null {
  const denom = dot(dir, f.inward);
  // The ray must travel towards the wall, i.e. against the inward normal.
  if (denom > -1e-9) return null;
  const t = dot(sub(f.start, origin), f.inward) / denom;
  if (!(t > 0)) return null;
  return { point: add(origin, scale(dir, t)), t };
}

export function imageToCanvas(b: ProjectorBasis, f: WallFrame, u: number, v: number): Vec2 | null {
  const hit = intersectWall(b.origin, imageRay(b, u, v), f);
  return hit ? wallPointToCanvas(f, hit.point) : null;
}

export interface Footprint {
  /** Image corners on the wall canvas: TL, TR, BR, BL of the projector image. */
  corners: Vec2[];
  /** Maps image (u, v) in 0..1 to wall canvas feet. */
  imageToWall: Mat3;
}

export function footprint(p: Projector, room: Room): Footprint | null {
  const b = projectorBasis(p);
  const f = wallFrame(room, p.targetWall);
  const corners: Vec2[] = [];
  for (const c of UNIT_SQUARE) {
    const w = imageToCanvas(b, f, c.x, c.y);
    if (!w) return null;
    corners.push(w);
  }
  const h = homographyFrom4(UNIT_SQUARE, corners);
  if (!h) return null;
  return { corners, imageToWall: h };
}

// ---------------------------------------------------------------------------
// Aiming helpers
// ---------------------------------------------------------------------------

function anglesOf(d: Vec3): { pan: number; tilt: number } {
  return { pan: Math.atan2(d.x, -d.y) / DEG, tilt: Math.atan2(d.z, Math.hypot(d.x, d.y)) / DEG };
}

/** Pan/tilt so the centre of the (lens-shifted) image lands on a wall-canvas point. */
export function aimAt(p: Projector, room: Room, target: Vec2): { pan: number; tilt: number } {
  const f = wallFrame(room, p.targetWall);
  const tp = canvasToWallPoint(f, target);
  const origin = v3(p.x, p.y, p.mountHeight);
  const want = anglesOf(sub(tp, origin));
  let pan = want.pan;
  let tilt = want.tilt;
  for (let i = 0; i < 20; i++) {
    const b = projectorBasis({ ...p, pan, tilt });
    const got = anglesOf(imageRay(b, 0.5, 0.5));
    let dPan = want.pan - got.pan;
    if (dPan > 180) dPan -= 360;
    if (dPan < -180) dPan += 360;
    pan += dPan;
    tilt += want.tilt - got.tilt;
  }
  return { pan, tilt };
}

/** Throw ratio that makes the image's middle row span `width` feet of wall (clamped to the zoom range). */
export function fitZoom(p: Projector, room: Room, width: number): number {
  let lo = p.throwRatioMin;
  let hi = p.throwRatioMax;
  const spanAt = (tr: number) => {
    const fp = footprint({ ...p, throwRatio: tr }, room);
    if (!fp) return Infinity;
    const a = applyH(fp.imageToWall, { x: 0, y: 0.5 });
    const c = applyH(fp.imageToWall, { x: 1, y: 0.5 });
    return Math.hypot(c.x - a.x, c.y - a.y);
  };
  // Larger throw ratio = narrower image.
  if (spanAt(lo) <= width) return lo;
  if (spanAt(hi) >= width) return hi;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (spanAt(mid) > width) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export type ShadowLevel = "clear" | "standing" | "seated";

export interface Cell {
  poly: Vec2[];
  /** Foot-lamberts (luminance) on the wall. */
  fL: number;
  /** Pixels per inch. */
  ppi: number;
  shadow: ShadowLevel;
  onWall: boolean;
}

export interface ProjectorAnalysis {
  projectorId: string;
  wall: WallId;
  ok: boolean;
  error?: string;
  footprint: Footprint | null;
  /** Footprint clipped to the wall. */
  onWall: Vec2[];
  footprintArea: number;
  onWallArea: number;
  /** Simple average: lumens × gain × derate ÷ area. */
  averageFL: number;
  minFL: number;
  maxFL: number;
  minPPI: number;
  maxPPI: number;
  throwDistance: number;
  /** Edge lengths of the footprint in feet: top, right, bottom, left. */
  edges: [number, number, number, number];
  cells: Cell[];
  cols: number;
  rows: number;
  seatedShadowPct: number;
  standingShadowPct: number;
  obstructionHits: { obstructionId: string; area: number; neverProject: boolean }[];
}

export interface OverlapInfo {
  wall: WallId;
  a: string;
  b: string;
  poly: Vec2[];
  /** Horizontal extent of the overlap along the wall, feet. */
  width: number;
  area: number;
  pctOfA: number;
  pctOfB: number;
}

export interface PlanAnalysis {
  projectors: ProjectorAnalysis[];
  overlaps: OverlapInfo[];
  walls: Record<WallId, WallFrame>;
}

export const CELL_COLS = 32;
export const CELL_ROWS = 20;
const SHADOW_SAMPLES = 64;

/** Luminance (fL) of a wall patch that receives `lumens` over `areaSqft`. */
export function footLamberts(lumens: number, gain: number, derate: number, areaSqft: number): number {
  return (lumens * gain * derate) / areaSqft;
}

/** Pixels per inch for `pixels` pixels spread over `areaSqft` square feet. */
export function pixelsPerInch(pixels: number, areaSqft: number): number {
  return Math.sqrt(pixels / (areaSqft * 144));
}

/** Does the straight beam from `from` to `to` pass through the audience volume up to `headHeight`? */
export function beamBlocked(from: Vec3, to: Vec3, outline: Vec2[], headHeight: number, samples = SHADOW_SAMPLES): boolean {
  if (outline.length < 3) return false;
  // Quick reject: both ends above head height means the straight line stays above it.
  if (from.z > headHeight && to.z > headHeight) return false;
  for (let i = 1; i < samples; i++) {
    const k = i / samples;
    const z = from.z + (to.z - from.z) * k;
    if (z > headHeight) continue;
    const x = from.x + (to.x - from.x) * k;
    const y = from.y + (to.y - from.y) * k;
    if (pointInPolygon({ x, y }, outline)) return true;
  }
  return false;
}

export function analyzeProjector(plan: Plan, p: Projector, cols = CELL_COLS, rows = CELL_ROWS): ProjectorAnalysis {
  const f = wallFrame(plan.room, p.targetWall);
  const base: ProjectorAnalysis = {
    projectorId: p.id,
    wall: p.targetWall,
    ok: false,
    footprint: null,
    onWall: [],
    footprintArea: 0,
    onWallArea: 0,
    averageFL: 0,
    minFL: 0,
    maxFL: 0,
    minPPI: 0,
    maxPPI: 0,
    throwDistance: 0,
    edges: [0, 0, 0, 0],
    cells: [],
    cols,
    rows,
    seatedShadowPct: 0,
    standingShadowPct: 0,
    obstructionHits: [],
  };
  const fp = footprint(p, plan.room);
  if (!fp) {
    return { ...base, error: "Part of the image never reaches this wall. Check pan, tilt and target wall." };
  }
  const b = projectorBasis(p);
  const wallRect = rectPoly({ x0: 0, y0: 0, x1: f.length, y1: f.height });
  const onWall = clipConvex(fp.corners, wallRect);
  const gain = plan.surfaces[p.targetWall].gain;
  const fpArea = area(fp.corners);
  const centreHit = intersectWall(b.origin, imageRay(b, 0.5, 0.5), f);
  const c = fp.corners;
  const dist = (a: Vec2, d: Vec2) => Math.hypot(a.x - d.x, a.y - d.y);

  const cells: Cell[] = [];
  const pixPerCell = (p.resolutionW / cols) * (p.resolutionH / rows);
  const lumPerCell = p.lumens / (cols * rows);
  let minFL = Infinity,
    maxFL = 0,
    minPPI = Infinity,
    maxPPI = 0;
  let seated = 0,
    standing = 0,
    counted = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const quad = [
        { x: i / cols, y: j / rows },
        { x: (i + 1) / cols, y: j / rows },
        { x: (i + 1) / cols, y: (j + 1) / rows },
        { x: i / cols, y: (j + 1) / rows },
      ].map((q) => applyH(fp.imageToWall, q));
      const a = area(quad);
      const fL = footLamberts(lumPerCell, gain, plan.derate, a);
      const ppi = pixelsPerInch(pixPerCell, a);
      const centre = applyH(fp.imageToWall, { x: (i + 0.5) / cols, y: (j + 0.5) / rows });
      const onW = centre.x >= 0 && centre.x <= f.length && centre.y >= 0 && centre.y <= f.height;
      const wp = canvasToWallPoint(f, centre);
      let shadow: ShadowLevel = "clear";
      if (beamBlocked(b.origin, wp, plan.audience.outline, plan.audience.seatedHeadHeight)) shadow = "seated";
      else if (beamBlocked(b.origin, wp, plan.audience.outline, plan.audience.standingHeadHeight)) shadow = "standing";
      cells.push({ poly: quad, fL, ppi, shadow, onWall: onW });
      if (onW) {
        counted++;
        minFL = Math.min(minFL, fL);
        maxFL = Math.max(maxFL, fL);
        minPPI = Math.min(minPPI, ppi);
        maxPPI = Math.max(maxPPI, ppi);
        if (shadow === "seated") seated++;
        if (shadow !== "clear") standing++;
      }
    }
  }

  const obstructionHits = plan.obstructions
    .filter((o) => o.wall === p.targetWall)
    .map((o) => {
      const poly = clipConvex(fp.corners, rectPoly(obstructionRect(f, o)));
      return { obstructionId: o.id, area: poly.length ? area(poly) : 0, neverProject: o.neverProject };
    })
    .filter((h) => h.area > 1e-6);

  return {
    ...base,
    ok: true,
    footprint: fp,
    onWall,
    footprintArea: fpArea,
    onWallArea: onWall.length ? area(onWall) : 0,
    averageFL: footLamberts(p.lumens, gain, plan.derate, fpArea),
    minFL: counted ? minFL : 0,
    maxFL: counted ? maxFL : 0,
    minPPI: counted ? minPPI : 0,
    maxPPI: counted ? maxPPI : 0,
    throwDistance: centreHit ? centreHit.t * len(imageRay(b, 0.5, 0.5)) : 0,
    edges: [dist(c[0], c[1]), dist(c[1], c[2]), dist(c[2], c[3]), dist(c[3], c[0])],
    cells,
    seatedShadowPct: counted ? (100 * seated) / counted : 0,
    standingShadowPct: counted ? (100 * standing) / counted : 0,
    obstructionHits,
  };
}

export function overlapOf(a: ProjectorAnalysis, b: ProjectorAnalysis): OverlapInfo | null {
  if (!a.ok || !b.ok || a.wall !== b.wall || !a.onWall.length || !b.onWall.length) return null;
  const poly = clipConvex(a.onWall, b.onWall);
  if (!poly.length) return null;
  const ar = area(poly);
  if (ar < 1e-6) return null;
  const bb = bounds(poly);
  return {
    wall: a.wall,
    a: a.projectorId,
    b: b.projectorId,
    poly,
    width: bb.x1 - bb.x0,
    area: ar,
    pctOfA: (100 * ar) / a.onWallArea,
    pctOfB: (100 * ar) / b.onWallArea,
  };
}

export function analyzePlan(plan: Plan): PlanAnalysis {
  const projectors = plan.projectors.map((p) => analyzeProjector(plan, p));
  const overlaps: OverlapInfo[] = [];
  for (let i = 0; i < projectors.length; i++)
    for (let j = i + 1; j < projectors.length; j++) {
      const o = overlapOf(projectors[i], projectors[j]);
      if (o) overlaps.push(o);
    }
  const walls = Object.fromEntries(WALL_IDS.map((w) => [w, wallFrame(plan.room, w)])) as Record<WallId, WallFrame>;
  return { projectors, overlaps, walls };
}

/** Heat-map colour bands. */
export function brightnessBand(fL: number, good: number, ok: number): "good" | "ok" | "low" {
  return fL >= good ? "good" : fL >= ok ? "ok" : "low";
}

/** Top-down outline of the beam: lens plus the four image corners on the wall (room coords). */
export function beamOutline(p: Projector, room: Room): { lens: Vec2; corners: Vec2[] } | null {
  const fp = footprint(p, room);
  if (!fp) return null;
  const f = wallFrame(room, p.targetWall);
  return {
    lens: { x: p.x, y: p.y },
    corners: fp.corners.map((c) => {
      const w = canvasToWallPoint(f, { x: Math.min(Math.max(c.x, -1e4), 1e4), y: c.y });
      return { x: w.x, y: w.y };
    }),
  };
}
