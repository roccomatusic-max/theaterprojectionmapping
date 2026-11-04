// Output warping: corner pin (homography) + smooth mesh warp, and edge-blend ramps.

import type { BlendEdge, Mesh, OutputConfig, Rect, Vec2 } from "./types";
import { applyH, homographyFrom4, Mat3, UNIT_SQUARE } from "./homography";

/** Maps slice-normalised (a, b) in 0..1 to output-normalised coordinates via the 4 corners. */
export function cornerHomography(out: Pick<OutputConfig, "corners">): Mat3 {
  return (
    homographyFrom4(UNIT_SQUARE, out.corners) ?? [1, 0, 0, 0, 1, 0, 0, 0, 1]
  );
}

function crWeights(t: number): [number, number, number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    0.5 * (-t3 + 2 * t2 - t),
    0.5 * (3 * t3 - 5 * t2 + 2),
    0.5 * (-3 * t3 + 4 * t2 + t),
    0.5 * (t3 - t2),
  ];
}

/** Control-point offset at (i, j) with linear extrapolation beyond the edges. */
function offsetAt(m: Mesh, i: number, j: number): Vec2 {
  const ci = Math.min(Math.max(i, 0), m.cols - 1);
  const cj = Math.min(Math.max(j, 0), m.rows - 1);
  const base = m.offsets[cj * m.cols + ci] ?? { x: 0, y: 0 };
  if (i === ci && j === cj) return base;
  // Mirror-extrapolate: P[-1] = 2 P[0] - P[1].
  const ii = i < 0 ? Math.min(1, m.cols - 1) : i >= m.cols ? Math.max(m.cols - 2, 0) : ci;
  const jj = j < 0 ? Math.min(1, m.rows - 1) : j >= m.rows ? Math.max(m.rows - 2, 0) : cj;
  const inner = m.offsets[jj * m.cols + ii] ?? { x: 0, y: 0 };
  return { x: 2 * base.x - inner.x, y: 2 * base.y - inner.y };
}

/** Smooth (Catmull-Rom) interpolation of mesh offsets at slice-normalised (a, b). */
export function meshOffset(m: Mesh, a: number, b: number): Vec2 {
  if (m.cols < 2 || m.rows < 2) return { x: 0, y: 0 };
  const fx = Math.min(Math.max(a, 0), 1) * (m.cols - 1);
  const fy = Math.min(Math.max(b, 0), 1) * (m.rows - 1);
  const i = Math.min(Math.floor(fx), m.cols - 2);
  const j = Math.min(Math.floor(fy), m.rows - 2);
  const wx = crWeights(fx - i);
  const wy = crWeights(fy - j);
  let x = 0,
    y = 0;
  for (let dj = -1; dj <= 2; dj++)
    for (let di = -1; di <= 2; di++) {
      const w = wx[di + 1] * wy[dj + 1];
      if (w === 0) continue;
      const o = offsetAt(m, i + di, j + dj);
      x += w * o.x;
      y += w * o.y;
    }
  return { x, y };
}

/** Output-normalised position of slice-normalised (a, b). */
export function warpPoint(out: Pick<OutputConfig, "corners" | "mesh">, a: number, b: number, h?: Mat3): Vec2 {
  const p = applyH(h ?? cornerHomography(out), { x: a, y: b });
  const o = meshOffset(out.mesh, a, b);
  return { x: p.x + o.x, y: p.y + o.y };
}

/** Output-normalised positions of the mesh control points (for drawing handles). */
export function meshControlPoints(out: Pick<OutputConfig, "corners" | "mesh">): Vec2[] {
  const h = cornerHomography(out);
  const pts: Vec2[] = [];
  for (let j = 0; j < out.mesh.rows; j++)
    for (let i = 0; i < out.mesh.cols; i++) {
      const a = i / (out.mesh.cols - 1);
      const b = j / (out.mesh.rows - 1);
      const p = applyH(h, { x: a, y: b });
      const o = out.mesh.offsets[j * out.mesh.cols + i];
      pts.push({ x: p.x + o.x, y: p.y + o.y });
    }
  return pts;
}

/** Change the grid size, keeping the current shape. */
export function resampleMesh(m: Mesh, cols: number, rows: number): Mesh {
  const offsets: Vec2[] = [];
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) offsets.push(meshOffset(m, i / (cols - 1), j / (rows - 1)));
  return { cols, rows, offsets };
}

/**
 * Triangle mesh for rendering: `n` x `n` quads. Positions are output-normalised
 * (0..1, y down); texcoords are slice-normalised (0..1).
 */
export function buildRenderMesh(out: Pick<OutputConfig, "corners" | "mesh">, n = 48): { positions: Float32Array; texcoords: Float32Array; indices: Uint16Array } {
  const h = cornerHomography(out);
  const verts = (n + 1) * (n + 1);
  const positions = new Float32Array(verts * 2);
  const texcoords = new Float32Array(verts * 2);
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const a = i / n;
      const b = j / n;
      const p = warpPoint(out, a, b, h);
      const k = (j * (n + 1) + i) * 2;
      positions[k] = p.x;
      positions[k + 1] = p.y;
      texcoords[k] = a;
      texcoords[k + 1] = b;
    }
  const indices = new Uint16Array(n * n * 6);
  let q = 0;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      const b = a + 1;
      const c = a + n + 1;
      const d = c + 1;
      indices.set([a, b, c, b, d, c], q);
      q += 6;
    }
  return { positions, texcoords, indices };
}

/**
 * Blend ramp shape. x in 0..1 across the ramp (0 = outer edge of the image).
 * The S-curve is symmetric, so two overlapping ramps sum to exactly 1 before gamma.
 */
export function blendCurve(x: number, curve: number): number {
  const t = Math.min(Math.max(x, 0), 1);
  const p = Math.max(curve, 0.1);
  return t < 0.5 ? 0.5 * Math.pow(2 * t, p) : 1 - 0.5 * Math.pow(2 * (1 - t), p);
}

/** Pixel multiplier for one blend edge, given distance (feet) from the slice edge. */
export function blendFactor(distFromEdge: number, e: BlendEdge): number {
  if (e.width <= 0) return 1;
  const lin = blendCurve(distFromEdge / e.width, e.curve);
  // Light adds linearly but pixel values are gamma encoded, so encode the ramp.
  return Math.pow(lin, 1 / Math.max(e.gamma, 0.1));
}

/** Combined blend multiplier at a wall-canvas point inside an output's slice. */
export function blendAt(out: Pick<OutputConfig, "blend" | "slice">, x: number, y: number): number {
  const s: Rect = out.slice;
  return (
    blendFactor(x - s.x0, out.blend.left) *
    blendFactor(s.x1 - x, out.blend.right) *
    blendFactor(y - s.y0, out.blend.top) *
    blendFactor(s.y1 - y, out.blend.bottom)
  );
}
