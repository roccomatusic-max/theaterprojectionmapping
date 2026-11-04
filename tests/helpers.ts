import type { Plan } from "../src/shared/types";
import { baseProjector } from "../src/shared/defaults";

/** A rectangular test room: walls at x = ±20 ft, 60 ft long, 20 ft high. */
export function boxPlan(): Plan {
  return {
    version: 1,
    name: "test",
    units: "imperial",
    room: { frontWidth: 40, backWidth: 40, length: 60, wallHeight: 20, wallOverrides: { left: null, right: null } },
    audience: {
      outline: [
        { x: -18, y: 5 },
        { x: 18, y: 5 },
        { x: 18, y: 55 },
        { x: -18, y: 55 },
      ],
      seatedHeadHeight: 4,
      standingHeadHeight: 6,
    },
    projectors: [],
    surfaces: { left: { gain: 1, color: "#fff" }, right: { gain: 1, color: "#fff" } },
    obstructions: [],
    derate: 1,
    goodFL: 8,
    okFL: 5,
  };
}

/** Projector in the middle of the room aimed square at the right wall, 20 ft away. */
export function squareProjector() {
  return baseProjector({
    id: "p1",
    x: 0,
    y: 30,
    mountHeight: 10,
    pan: 90,
    tilt: 0,
    roll: 0,
    lumens: 5000,
    resolutionW: 1920,
    resolutionH: 1080,
    throwRatio: 2,
    targetWall: "right",
  });
}
