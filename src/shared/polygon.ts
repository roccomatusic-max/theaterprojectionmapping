import type { Rect, Vec2 } from "./types";

/** Signed area (shoelace). Positive for counter-clockwise in a y-up system. */
export function signedArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function area(poly: Vec2[]): number {
  return Math.abs(signedArea(poly));
}

export function bounds(poly: Vec2[]): Rect {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

export function rectPoly(r: Rect): Vec2[] {
  return [
    { x: r.x0, y: r.y0 },
    { x: r.x1, y: r.y0 },
    { x: r.x1, y: r.y1 },
    { x: r.x0, y: r.y1 },
  ];
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function ensureCCW(poly: Vec2[]): Vec2[] {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly;
}

/**
 * Intersection of a polygon with a CONVEX clip polygon (Sutherland–Hodgman).
 * Footprints of a projector on a flat wall are always convex quads.
 */
export function clipConvex(subject: Vec2[], clip: Vec2[]): Vec2[] {
  if (subject.length < 3 || clip.length < 3) return [];
  const c = ensureCCW(clip);
  let out = subject;
  for (let i = 0; i < c.length; i++) {
    const a = c[i];
    const b = c[(i + 1) % c.length];
    const input = out;
    out = [];
    if (!input.length) break;
    const inside = (p: Vec2) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= -1e-12;
    const inter = (p: Vec2, q: Vec2): Vec2 => {
      const a1 = q.y - p.y,
        b1 = p.x - q.x,
        c1 = a1 * p.x + b1 * p.y;
      const a2 = b.y - a.y,
        b2 = a.x - b.x,
        c2 = a2 * a.x + b2 * a.y;
      const det = a1 * b2 - a2 * b1;
      if (Math.abs(det) < 1e-15) return p;
      return { x: (b2 * c1 - b1 * c2) / det, y: (a1 * c2 - a2 * c1) / det };
    };
    for (let j = 0; j < input.length; j++) {
      const cur = input[j];
      const prev = input[(j + input.length - 1) % input.length];
      const curIn = inside(cur);
      const prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) out.push(inter(prev, cur));
        out.push(cur);
      } else if (prevIn) {
        out.push(inter(prev, cur));
      }
    }
  }
  return out.length >= 3 ? out : [];
}

export function centroid(poly: Vec2[]): Vec2 {
  let x = 0,
    y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}
