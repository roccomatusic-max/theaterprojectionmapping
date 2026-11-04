import { describe, expect, it } from "vitest";
import { applyH, homographyFrom4, invertH, UNIT_SQUARE } from "../src/shared/homography";
import { blendAt, blendCurve, blendFactor, buildRenderMesh, meshOffset, resampleMesh, warpPoint } from "../src/shared/warp";
import { defaultOutput, identityMesh } from "../src/shared/defaults";

describe("homography", () => {
  const dst = [
    { x: 0.1, y: 0.05 },
    { x: 0.9, y: 0.12 },
    { x: 0.85, y: 0.95 },
    { x: 0.05, y: 0.9 },
  ];
  it("maps the four corners exactly and inverts", () => {
    const h = homographyFrom4(UNIT_SQUARE, dst)!;
    UNIT_SQUARE.forEach((p, i) => {
      const q = applyH(h, p);
      expect(q.x).toBeCloseTo(dst[i].x, 9);
      expect(q.y).toBeCloseTo(dst[i].y, 9);
    });
    const inv = invertH(h)!;
    const back = applyH(inv, applyH(h, { x: 0.3, y: 0.7 }));
    expect(back.x).toBeCloseTo(0.3, 9);
    expect(back.y).toBeCloseTo(0.7, 9);
  });
});

describe("mesh warp", () => {
  it("identity corners + zero mesh leaves points unchanged", () => {
    const out = defaultOutput();
    const p = warpPoint(out, 0.25, 0.6);
    expect(p.x).toBeCloseTo(0.25, 9);
    expect(p.y).toBeCloseTo(0.6, 9);
  });
  it("interpolation passes through control points and is smooth between", () => {
    const m = identityMesh(3, 3);
    m.offsets[4] = { x: 0.1, y: -0.05 }; // centre point
    const c = meshOffset(m, 0.5, 0.5);
    expect(c.x).toBeCloseTo(0.1, 9);
    expect(c.y).toBeCloseTo(-0.05, 9);
    expect(meshOffset(m, 0, 0).x).toBeCloseTo(0, 9);
    const q = meshOffset(m, 0.25, 0.5).x;
    expect(q).toBeGreaterThan(0);
    expect(q).toBeLessThan(0.1);
  });
  it("resampling a mesh keeps its shape", () => {
    const m = identityMesh(3, 3);
    m.offsets[4] = { x: 0.1, y: 0 };
    const r = resampleMesh(m, 5, 5);
    expect(r.offsets.length).toBe(25);
    expect(r.offsets[12].x).toBeCloseTo(0.1, 9);
  });
  it("render mesh has (n+1)^2 vertices and 6n^2 indices", () => {
    const r = buildRenderMesh(defaultOutput(), 8);
    expect(r.positions.length).toBe(81 * 2);
    expect(r.indices.length).toBe(6 * 64);
  });
});

describe("edge blending", () => {
  it("S-curve ramps from two overlapping projectors sum to 1 in linear light", () => {
    for (const curve of [1, 2, 3]) {
      for (let x = 0; x <= 1; x += 0.1) {
        expect(blendCurve(x, curve) + blendCurve(1 - x, curve)).toBeCloseTo(1, 9);
      }
    }
  });
  it("gamma-encodes the ramp so that projected light adds up", () => {
    const e = { width: 4, curve: 2, gamma: 2.2 };
    const a = blendFactor(1, e); // 1 ft into a 4 ft ramp
    const b = blendFactor(3, e); // the other projector at the same wall point
    expect(Math.pow(a, 2.2) + Math.pow(b, 2.2)).toBeCloseTo(1, 9);
  });
  it("blendAt is 1 away from edges and 0 at a blended edge", () => {
    const out = defaultOutput({ slice: { x0: 0, y0: 0, x1: 30, y1: 20 } });
    out.blend.right.width = 5;
    expect(blendAt(out, 10, 10)).toBe(1);
    expect(blendAt(out, 30, 10)).toBeCloseTo(0, 9);
  });
});
