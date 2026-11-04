import { describe, expect, it } from "vitest";
import { encodeOsc, oscToAction, parseOsc } from "../src/shared/osc";
import { formatLength, parseLength } from "../src/shared/units";
import { planToShow } from "../src/shared/planToShow";
import { emptyShow } from "../src/shared/defaults";
import { boxPlan, squareProjector } from "./helpers";
import { warpPoint } from "../src/shared/warp";
import { footprint } from "../src/shared/geometry";
import { applyH } from "../src/shared/homography";

describe("units", () => {
  it("formats feet and inches", () => {
    expect(formatLength(12.5, "imperial")).toBe(`12' 6"`);
    expect(formatLength(3.2808399, "metric")).toBe("1.00 m");
    expect(formatLength(1, "metric")).toBe("30 cm");
  });
  it("parses common ways of typing a length", () => {
    expect(parseLength(`12' 6"`, "imperial")).toBeCloseTo(12.5, 9);
    expect(parseLength("12ft 6in", "imperial")).toBeCloseTo(12.5, 9);
    expect(parseLength("6in", "imperial")).toBeCloseTo(0.5, 9);
    expect(parseLength("12.25", "imperial")).toBeCloseTo(12.25, 9);
    expect(parseLength("1 m", "imperial")).toBeCloseTo(3.2808399, 6);
    expect(parseLength("2", "metric")).toBeCloseTo(6.5616798, 6);
    expect(parseLength("banana", "imperial")).toBeNull();
  });
});

describe("OSC", () => {
  it("decodes /go, /cue/5, /cue 7 and /blackout", () => {
    expect(oscToAction(parseOsc(encodeOsc("/go"))[0])).toEqual({ kind: "go" });
    expect(oscToAction(parseOsc(encodeOsc("/cue/5"))[0])).toEqual({ kind: "cue", number: "5" });
    expect(oscToAction(parseOsc(encodeOsc("/cue", [7]))[0])).toEqual({ kind: "cue", number: "7" });
    expect(oscToAction(parseOsc(encodeOsc("/blackout", [1.5, "x"]))[0])).toEqual({ kind: "blackout" });
    expect(parseOsc(encodeOsc("/blackout", [1.5, "x"]))[0].args).toEqual([1.5, "x"]);
    expect(oscToAction({ address: "/nonsense", args: [] })).toBeNull();
  });
  it("ignores garbage", () => {
    expect(parseOsc(new Uint8Array([1, 2, 3, 4, 5]))).toEqual([]);
  });
});

describe("export Planner -> Player", () => {
  it("roughs in each output's warp so the image lands where the math says", () => {
    const plan = boxPlan();
    plan.projectors = [
      { ...squareProjector(), id: "a", y: 25 },
      { ...squareProjector(), id: "b", y: 33, pan: 80 },
    ];
    plan.obstructions = [{ id: "x", wall: "right", kind: "exit-sign", label: "Exit", fromStage: 29, bottom: 9, width: 1, height: 0.5, neverProject: true }];
    const { show } = planToShow(plan, emptyShow());
    expect(show.outputs.length).toBe(2);
    expect(show.walls.right.width).toBeCloseTo(60, 6);
    expect(show.wallMasks.right.length).toBe(1);
    // Output b: a wall point at slice-normalised (a, b) must be lit by the projector
    // pixel the warp sends it to.
    const out = show.outputs[1];
    const fp = footprint(plan.projectors[1], plan.room)!;
    for (const [a, b] of [
      [0.3, 0.4],
      [0.7, 0.8],
    ]) {
      const wallX = out.slice.x0 + a * (out.slice.x1 - out.slice.x0);
      const wallY = out.slice.y0 + b * (out.slice.y1 - out.slice.y0);
      const pix = warpPoint(out, a, b);
      const lit = applyH(fp.imageToWall, pix);
      expect(lit.x).toBeCloseTo(wallX, 3);
      expect(lit.y).toBeCloseTo(wallY, 3);
    }
    // Side-by-side outputs get matching blend ramps.
    const [A, B] = show.outputs;
    expect(A.blend.right.width).toBeGreaterThan(0);
    expect(A.blend.right.width).toBeCloseTo(B.blend.left.width, 9);
  });
});
