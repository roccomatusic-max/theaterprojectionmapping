// Export a Planner plan into the Player: wall canvases, exit-sign/obstruction masks,
// and one output per projector with its warp roughed in from the projection math.

import type { MaskPolygon, OutputConfig, Plan, Show, WallId } from "./types";
import { WALL_IDS } from "./types";
import { analyzePlan, obstructionRect } from "./geometry";
import { applyH, invertH } from "./homography";
import { bounds, rectPoly } from "./polygon";
import { DEFAULT_BLEND, defaultOutput, identityMesh } from "./defaults";

export const OBSTRUCTION_MARGIN_FT = 0.25;

export function outputIdFor(projectorId: string): string {
  return `out-${projectorId}`;
}

export function planToShow(plan: Plan, show: Show): { show: Show; warnings: string[] } {
  const analysis = analyzePlan(plan);
  const warnings: string[] = [];

  const walls = { ...show.walls };
  const wallMasks: Record<WallId, MaskPolygon[]> = { left: [], right: [] };
  for (const w of WALL_IDS) {
    const f = analysis.walls[w];
    walls[w] = { ...walls[w], width: round(f.length), height: round(f.height) };
    // Keep masks the operator drew by hand; replace the ones that came from the Planner.
    wallMasks[w] = (show.wallMasks[w] ?? []).filter((m) => !m.fromObstruction);
    for (const o of plan.obstructions.filter((o) => o.wall === w)) {
      const r = obstructionRect(f, o);
      const m = o.neverProject ? OBSTRUCTION_MARGIN_FT : 0;
      wallMasks[w].push({
        id: `mask-${o.id}`,
        name: `${o.label} (${o.kind})`,
        points: rectPoly({ x0: r.x0 - m, y0: r.y0 - m, x1: r.x1 + m, y1: r.y1 + m }),
        fromObstruction: o.id,
        locked: o.neverProject,
        enabled: true,
      });
    }
  }

  const outputs: OutputConfig[] = [];
  for (const p of plan.projectors) {
    const a = analysis.projectors.find((x) => x.projectorId === p.id)!;
    const id = outputIdFor(p.id);
    const existing = show.outputs.find((o) => o.id === id);
    const out = defaultOutput({
      id,
      name: p.name,
      wall: p.targetWall,
      width: p.resolutionW,
      height: p.resolutionH,
      color: p.color,
      node: existing?.node ?? "local",
      displayId: existing?.displayId ?? null,
      brightness: existing?.brightness ?? 1,
      rgb: existing?.rgb ?? [1, 1, 1],
      masks: existing?.masks ?? [],
      mesh: identityMesh(),
    });
    if (!a.ok || !a.footprint || !a.onWall.length) {
      warnings.push(`${p.name}: no usable footprint on the ${p.targetWall} wall, so it starts un-warped.`);
      outputs.push(out);
      continue;
    }
    const b = bounds(a.onWall);
    out.slice = { x0: round(b.x0), y0: round(b.y0), x1: round(b.x1), y1: round(b.y1) };
    const inv = invertH(a.footprint.imageToWall);
    if (inv) {
      const cs = rectPoly(out.slice).map((c) => applyH(inv, c));
      out.corners = [cs[0], cs[1], cs[2], cs[3]];
    }
    outputs.push(out);
  }

  // Edge blends: where two outputs on the same wall overlap side by side, both ramps
  // span exactly the same strip of wall so they add up to full brightness.
  for (const w of WALL_IDS) {
    const onWall = outputs.filter((o) => o.wall === w).sort((a, b) => a.slice.x0 - b.slice.x0);
    for (let i = 0; i + 1 < onWall.length; i++) {
      const A = onWall[i];
      const B = onWall[i + 1];
      const width = A.slice.x1 - B.slice.x0;
      if (width > 0) {
        A.blend.right = { ...DEFAULT_BLEND, width: round(width) };
        B.blend.left = { ...DEFAULT_BLEND, width: round(width) };
      }
    }
  }

  // Keep outputs that don't belong to a planner projector (added by hand in the Player).
  const manual = show.outputs.filter((o) => !plan.projectors.some((p) => outputIdFor(p.id) === o.id));
  return { show: { ...show, walls, wallMasks, outputs: [...outputs, ...manual] }, warnings };
}

const round = (v: number) => Math.round(v * 1000) / 1000;
