import { describe, expect, it } from "vitest";
import {
  aimAt,
  analyzePlan,
  analyzeProjector,
  beamBlocked,
  footLamberts,
  footprint,
  imageToCanvas,
  intersectWall,
  pixelsPerInch,
  projectorBasis,
  v3,
  wallFrame,
} from "../src/shared/geometry";
import { applyH } from "../src/shared/homography";
import { boxPlan, squareProjector } from "./helpers";
import { defaultPlan } from "../src/shared/defaults";

describe("walls", () => {
  it("builds a trapezoid room with inward normals", () => {
    const plan = defaultPlan();
    const r = wallFrame(plan.room, "right");
    const l = wallFrame(plan.room, "left");
    expect(r.inward.x).toBeLessThan(0);
    expect(l.inward.x).toBeGreaterThan(0);
    // 48 ft front, 56 ft back, 72 ft long: each wall leans out 4 ft over 72 ft.
    expect(r.length).toBeCloseTo(Math.hypot(4, 72), 6);
  });
});

describe("frustum–wall intersection (hand-checked)", () => {
  // Lens 20 ft from the wall, throw ratio 2 => image 10 ft wide; 16:9 => 5.625 ft tall.
  it("square-on projector: footprint is a 10 ft x 5.625 ft rectangle centred on the aim point", () => {
    const plan = boxPlan();
    const fp = footprint(squareProjector(), plan.room)!;
    expect(fp).not.toBeNull();
    const [tl, tr, br, bl] = fp.corners;
    // Right wall: canvas x = distance from the stage end (y), canvas y = 20 - height.
    expect(tl.x).toBeCloseTo(25, 6);
    expect(tl.y).toBeCloseTo(20 - (10 + 2.8125), 6);
    expect(tr.x).toBeCloseTo(35, 6);
    expect(br.y).toBeCloseTo(20 - (10 - 2.8125), 6);
    expect(bl.x).toBeCloseTo(25, 6);
  });

  it("vertical lens shift of +50% raises the image by half its height", () => {
    const plan = boxPlan();
    const p = { ...squareProjector(), lensShiftV: 50 };
    const b = projectorBasis(p);
    const c = imageToCanvas(b, wallFrame(plan.room, "right"), 0.5, 0.5)!;
    expect(c.y).toBeCloseTo(20 - (10 + 5.625 / 2), 6);
  });

  it("oblique ray: panned 60° from the stage hits the wall at y = 30 - 20·tan30°", () => {
    const plan = boxPlan();
    const f = wallFrame(plan.room, "right");
    const hit = intersectWall(v3(0, 30, 10), v3(Math.sin(Math.PI / 3), -Math.cos(Math.PI / 3), 0), f)!;
    expect(hit.point.x).toBeCloseTo(20, 6);
    expect(hit.point.y).toBeCloseTo(30 - 20 * Math.tan(Math.PI / 6), 6);
    expect(hit.t).toBeCloseTo(20 / Math.cos(Math.PI / 6), 6);
  });

  it("a ray pointing away from the wall misses", () => {
    const plan = boxPlan();
    expect(intersectWall(v3(0, 30, 10), v3(-1, 0, 0), wallFrame(plan.room, "right"))).toBeNull();
    expect(footprint({ ...squareProjector(), pan: -90 }, plan.room)).toBeNull();
  });

  it("left wall canvas runs back-to-stage (stage end on the right)", () => {
    const plan = boxPlan();
    const p = { ...squareProjector(), pan: -90, targetWall: "left" as const };
    const fp = footprint(p, plan.room)!;
    // Wall is 60 ft long; image centre at y=30 => canvas x = 60 - 30 = 30.
    const c = applyH(fp.imageToWall, { x: 0.5, y: 0.5 });
    expect(c.x).toBeCloseTo(30, 6);
    // Image is not mirrored: image-left is canvas-left.
    expect(fp.corners[0].x).toBeLessThan(fp.corners[1].x);
  });

  it("aimAt lands the shifted image centre on the target", () => {
    const plan = boxPlan();
    const p = { ...squareProjector(), x: -18, y: 58, mountHeight: 16, lensShiftV: -20 };
    const target = { x: 20, y: 10 };
    const a = aimAt(p, plan.room, target);
    const fp = footprint({ ...p, ...a }, plan.room)!;
    const c = applyH(fp.imageToWall, { x: 0.5, y: 0.5 });
    expect(c.x).toBeCloseTo(target.x, 3);
    expect(c.y).toBeCloseTo(target.y, 3);
  });
});

describe("brightness and sharpness (hand-checked)", () => {
  it("footLamberts = lumens × gain × derate ÷ area", () => {
    expect(footLamberts(8000, 0.8, 0.8, 512)).toBeCloseTo(10, 9);
  });
  it("pixelsPerInch: 1920 px across 10 ft = 16 ppi", () => {
    expect(pixelsPerInch(1920 * 1080, 10 * 5.625)).toBeCloseTo(16, 6);
  });
  it("square-on projector is uniform: 5000 lm over 56.25 ft² = 88.9 fL everywhere", () => {
    const plan = boxPlan();
    const a = analyzeProjector(plan, squareProjector());
    expect(a.ok).toBe(true);
    expect(a.averageFL).toBeCloseTo(5000 / 56.25, 4);
    expect(a.minFL).toBeCloseTo(5000 / 56.25, 4);
    expect(a.maxFL).toBeCloseTo(5000 / 56.25, 4);
    expect(a.minPPI).toBeCloseTo(16, 4);
    expect(a.throwDistance).toBeCloseTo(20, 6);
  });
  it("oblique projection spreads light: far end is dimmer and softer than near end", () => {
    const plan = boxPlan();
    const p = { ...squareProjector(), y: 50, pan: 60 };
    const a = analyzeProjector(plan, p);
    expect(a.ok).toBe(true);
    expect(a.maxFL).toBeGreaterThan(a.minFL * 1.2);
    expect(a.averageFL).toBeLessThan(5000 / 56.25);
    // Gain and derate scale linearly.
    const plan2 = { ...plan, derate: 0.5 };
    expect(analyzeProjector(plan2, p).averageFL).toBeCloseTo(a.averageFL / 2, 6);
  });
});

describe("shadows", () => {
  it("a beam dropping to 1 ft over the seats is blocked by seated heads", () => {
    const plan = boxPlan();
    expect(beamBlocked(v3(0, 30, 10), v3(20, 30, 1), plan.audience.outline, 4)).toBe(true);
  });
  it("a beam that stays above 6 ft is clear", () => {
    const plan = boxPlan();
    expect(beamBlocked(v3(0, 30, 10), v3(20, 30, 8), plan.audience.outline, 6)).toBe(false);
  });
  it("a beam between 4 and 6 ft is a standing-only risk", () => {
    const plan = boxPlan();
    // z = 10 - 5x/20: at the outline edge x = 18 z = 5.5 (above seated 4, below standing 6).
    const a = beamBlocked(v3(0, 30, 10), v3(20, 30, 5), plan.audience.outline, 4);
    const b = beamBlocked(v3(0, 30, 10), v3(20, 30, 5), plan.audience.outline, 6);
    expect(a).toBe(false);
    expect(b).toBe(true);
  });
});

describe("blend overlap", () => {
  it("two side-by-side 10 ft images 8 ft apart overlap by 2 ft (20%)", () => {
    const plan = boxPlan();
    plan.projectors = [
      { ...squareProjector(), id: "a", y: 25 },
      { ...squareProjector(), id: "b", y: 33 },
    ];
    const res = analyzePlan(plan);
    expect(res.overlaps.length).toBe(1);
    const o = res.overlaps[0];
    expect(o.width).toBeCloseTo(2, 6);
    expect(o.pctOfA).toBeCloseTo(20, 4);
    expect(o.pctOfB).toBeCloseTo(20, 4);
  });
  it("projectors on different walls never overlap", () => {
    const plan = boxPlan();
    plan.projectors = [squareProjector(), { ...squareProjector(), id: "b", pan: -90, targetWall: "left" }];
    expect(analyzePlan(plan).overlaps.length).toBe(0);
  });
});

describe("obstructions", () => {
  it("flags a never-project exit sign inside the footprint", () => {
    const plan = boxPlan();
    plan.obstructions = [
      { id: "exit", wall: "right", kind: "exit-sign", label: "Exit", fromStage: 29, bottom: 9, width: 1, height: 0.5, neverProject: true },
      { id: "far", wall: "right", kind: "door", label: "Door", fromStage: 50, bottom: 0, width: 3, height: 7, neverProject: false },
    ];
    const a = analyzeProjector(plan, squareProjector());
    expect(a.obstructionHits.map((h) => h.obstructionId)).toEqual(["exit"]);
    expect(a.obstructionHits[0].area).toBeCloseTo(0.5, 6);
  });
});

describe("default plan", () => {
  it("starts with four projectors that all land on their target walls", () => {
    const plan = defaultPlan();
    const res = analyzePlan(plan);
    expect(plan.projectors.length).toBe(4);
    for (const a of res.projectors) {
      expect(a.ok).toBe(true);
      expect(a.onWallArea).toBeGreaterThan(50);
    }
    // Front and back units on each wall overlap so they can be blended.
    expect(res.overlaps.filter((o) => o.wall === "left").length).toBe(1);
    expect(res.overlaps.filter((o) => o.wall === "right").length).toBe(1);
  });
});
