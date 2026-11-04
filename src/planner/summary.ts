// One-page printable summary per wall (exported to PDF by the main process).

import type { Plan, WallId } from "../shared/types";
import { WALL_IDS } from "../shared/types";
import type { PlanAnalysis } from "../shared/geometry";
import { formatArea, formatLength } from "../shared/units";
import { drawWall } from "./draw";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function wallImage(plan: Plan, a: PlanAnalysis, wall: WallId): string {
  const c = document.createElement("canvas");
  const w = 1500;
  const h = 520;
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#0d0f14";
  ctx.fillRect(0, 0, w, h);
  ctx.scale(1, 1);
  drawWall(ctx, w, h, plan, a, wall, "brightness", null);
  return c.toDataURL("image/png");
}

export function buildSummaryHtml(plan: Plan, a: PlanAnalysis): string {
  const u = plan.units;
  const pages = WALL_IDS.map((wall) => {
    const f = a.walls[wall];
    const projs = plan.projectors.filter((p) => p.targetWall === wall);
    const rows = projs
      .map((p) => {
        const r = a.projectors.find((x) => x.projectorId === p.id)!;
        if (!r.ok) return `<tr><td>${esc(p.name)}</td><td colspan="8">${esc(r.error ?? "No footprint")}</td></tr>`;
        return `<tr>
          <td><span class="sw" style="background:${p.color}"></span>${esc(p.name)}</td>
          <td>${formatLength(p.x, u)}, ${formatLength(p.y, u)}<br/>mount ${formatLength(p.mountHeight, u)}</td>
          <td>pan ${p.pan.toFixed(1)}°<br/>tilt ${p.tilt.toFixed(1)}° · roll ${p.roll.toFixed(1)}°</td>
          <td>${p.lumens.toLocaleString()} lm<br/>${p.resolutionW}×${p.resolutionH}</td>
          <td>throw ratio ${p.throwRatio.toFixed(2)}<br/>shift V ${p.lensShiftV}% H ${p.lensShiftH}%</td>
          <td>${formatLength(r.throwDistance, u)}</td>
          <td>top ${formatLength(r.edges[0], u)}<br/>bottom ${formatLength(r.edges[2], u)}<br/>left ${formatLength(r.edges[3], u)} · right ${formatLength(r.edges[1], u)}<br/>${formatArea(r.onWallArea, u)} on wall</td>
          <td>${r.minFL.toFixed(1)}–${r.maxFL.toFixed(1)} fL<br/>avg ${r.averageFL.toFixed(1)}</td>
          <td>${r.minPPI.toFixed(1)}–${r.maxPPI.toFixed(1)} ppi<br/>shadow ${r.seatedShadowPct.toFixed(0)}% seated / ${r.standingShadowPct.toFixed(0)}% standing</td>
        </tr>`;
      })
      .join("");
    const overlaps = a.overlaps
      .filter((o) => o.wall === wall)
      .map((o) => {
        const A = plan.projectors.find((p) => p.id === o.a)!;
        const B = plan.projectors.find((p) => p.id === o.b)!;
        return `<li>${esc(A.name)} + ${esc(B.name)}: overlap ${formatLength(o.width, u)} wide (${o.pctOfA.toFixed(0)}% / ${o.pctOfB.toFixed(0)}%)</li>`;
      })
      .join("");
    const obs = plan.obstructions
      .filter((o) => o.wall === wall)
      .map((o) => `<li>${esc(o.label)} (${o.kind}${o.neverProject ? ", never project" : ""}): ${formatLength(o.fromStage, u)} from stage end, bottom ${formatLength(o.bottom, u)}, ${formatLength(o.width, u)} × ${formatLength(o.height, u)}</li>`)
      .join("");
    return `<section class="page">
      <h1>${esc(plan.name)} — ${wall.toUpperCase()} WALL</h1>
      <div class="sub">Wall ${formatLength(f.length, u)} long × ${formatLength(f.height, u)} high · gain ${plan.surfaces[wall].gain} · derate ${plan.derate} · brightness heat map: green ≥ ${plan.goodFL} fL, yellow ≥ ${plan.okFL} fL, red below</div>
      <img src="${wallImage(plan, a, wall)}" />
      <table><thead><tr><th>Projector</th><th>Position</th><th>Aim</th><th>Unit</th><th>Lens</th><th>Throw</th><th>Footprint</th><th>Brightness</th><th>Sharpness / shadows</th></tr></thead><tbody>${rows || `<tr><td colspan="9">No projectors aimed at this wall.</td></tr>`}</tbody></table>
      <div class="cols"><div><b>Blend overlaps</b><ul>${overlaps || "<li>none</li>"}</ul></div><div><b>Obstructions</b><ul>${obs || "<li>none</li>"}</ul></div></div>
    </section>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(plan.name)}</title><style>
    @page { size: Letter landscape; margin: 0.4in; }
    body { font: 10px/1.3 system-ui, sans-serif; color: #111; margin: 0; }
    .page { page-break-after: always; }
    h1 { font-size: 16px; margin: 0 0 2px; }
    .sub { color: #555; margin-bottom: 6px; }
    img { width: 100%; border: 1px solid #ccc; border-radius: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    th, td { border: 1px solid #ccc; padding: 3px 4px; text-align: left; vertical-align: top; }
    th { background: #eee; }
    .sw { display: inline-block; width: 9px; height: 9px; margin-right: 4px; border-radius: 2px; }
    .cols { display: flex; gap: 24px; margin-top: 6px; }
    ul { margin: 2px 0; padding-left: 16px; }
  </style></head><body>${pages}</body></html>`;
}
