// Canvas drawing for the Planner views.

import type { Plan, Vec2, WallId } from "../shared/types";
import { brightnessBand, canvasToWallPoint, obstructionRect, PlanAnalysis, wallLine } from "../shared/geometry";
import { formatLength } from "../shared/units";

export type HeatMode = "none" | "brightness" | "sharpness" | "shadow-seated" | "shadow-standing";

export const HEAT_COLORS = { good: "rgba(47,191,113,0.55)", ok: "rgba(224,165,38,0.6)", low: "rgba(229,72,77,0.6)" };
export const PPI_SCALE_MAX = 15;

/** Red (soft) -> yellow -> green (sharp). */
export function ppiColor(ppi: number): string {
  const t = Math.max(0, Math.min(1, ppi / PPI_SCALE_MAX));
  const r = t < 0.5 ? 229 : Math.round(229 - (t - 0.5) * 2 * (229 - 47));
  const g = t < 0.5 ? Math.round(72 + t * 2 * (190 - 72)) : Math.round(190 + (t - 0.5) * 2 * (191 - 190));
  const b = t < 0.5 ? 77 : Math.round(38 + (t - 0.5) * 2 * (113 - 38));
  return `rgba(${r},${g},${b},0.6)`;
}

interface Xform {
  s: number;
  ox: number;
  oy: number;
}

function poly(ctx: CanvasRenderingContext2D, pts: Vec2[], t: Xform): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(t.ox + p.x * t.s, t.oy + p.y * t.s) : ctx.moveTo(t.ox + p.x * t.s, t.oy + p.y * t.s)));
  ctx.closePath();
}

export function setupCanvas(c: HTMLCanvasElement, cssH: number): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  const cssW = c.clientWidth || 600;
  c.width = Math.round(cssW * dpr);
  c.height = Math.round(cssH * dpr);
  c.style.height = `${cssH}px`;
  const ctx = c.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  return ctx;
}

// ---------------------------------------------------------------------------
// Top-down room view
// ---------------------------------------------------------------------------
export function drawTopDown(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  plan: Plan,
  a: PlanAnalysis,
  selected: string | null,
): void {
  const r = plan.room;
  const L = wallLine(r, "left");
  const R = wallLine(r, "right");
  const xs = [L.start.x, L.end.x, R.start.x, R.end.x, ...plan.projectors.map((p) => p.x)];
  const ys = [0, r.length, ...plan.projectors.map((p) => p.y)];
  const minX = Math.min(...xs) - 4;
  const maxX = Math.max(...xs) + 4;
  const minY = Math.min(...ys) - 9;
  const maxY = Math.max(...ys) + 4;
  const s = Math.min(w / (maxX - minX), h / (maxY - minY));
  const t: Xform = { s, ox: (w - (maxX - minX) * s) / 2 - minX * s, oy: (h - (maxY - minY) * s) / 2 - minY * s };
  const P = (p: Vec2) => ({ x: t.ox + p.x * s, y: t.oy + p.y * s });

  // Stage
  ctx.fillStyle = "#2a2340";
  const st0 = P({ x: L.start.x, y: -8 });
  const st1 = P({ x: R.start.x, y: 0 });
  ctx.fillRect(st0.x, st0.y, st1.x - st0.x, st1.y - st0.y);
  ctx.fillStyle = "#b9a9e8";
  ctx.font = "bold 12px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("STAGE", (st0.x + st1.x) / 2, (st0.y + st1.y) / 2 + 4);

  // Floor
  ctx.fillStyle = "#1a1d24";
  poly(ctx, [L.start, R.start, R.end, L.end], t);
  ctx.fill();

  // Audience
  ctx.fillStyle = "rgba(120,130,160,0.18)";
  ctx.strokeStyle = "rgba(150,160,190,0.6)";
  ctx.setLineDash([4, 4]);
  poly(ctx, plan.audience.outline, t);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  const ac = plan.audience.outline.reduce((acc, p) => ({ x: acc.x + p.x / plan.audience.outline.length, y: acc.y + p.y / plan.audience.outline.length }), { x: 0, y: 0 });
  ctx.fillStyle = "rgba(170,180,210,0.7)";
  ctx.font = "12px system-ui";
  ctx.fillText("audience", P(ac).x, P(ac).y);

  // Walls
  ctx.lineWidth = 4;
  for (const [wl, name] of [
    [L, "LEFT WALL"],
    [R, "RIGHT WALL"],
  ] as const) {
    ctx.strokeStyle = "#8a90a0";
    ctx.beginPath();
    ctx.moveTo(P(wl.start).x, P(wl.start).y);
    ctx.lineTo(P(wl.end).x, P(wl.end).y);
    ctx.stroke();
    const m = P({ x: (wl.start.x + wl.end.x) / 2, y: (wl.start.y + wl.end.y) / 2 });
    ctx.save();
    ctx.translate(m.x + (wl === L ? -14 : 14), m.y);
    ctx.rotate(Math.PI / 2 * (wl === L ? -1 : 1));
    ctx.fillStyle = "#8a90a0";
    ctx.font = "bold 11px system-ui";
    ctx.fillText(name, 0, 0);
    ctx.restore();
  }
  ctx.strokeStyle = "#555b6a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(P(L.end).x, P(L.end).y);
  ctx.lineTo(P(R.end).x, P(R.end).y);
  ctx.stroke();

  // Obstructions along the walls
  for (const o of plan.obstructions) {
    const f = a.walls[o.wall];
    const rc = obstructionRect(f, o);
    const p0 = canvasToWallPoint(f, { x: rc.x0, y: 0 });
    const p1 = canvasToWallPoint(f, { x: rc.x1, y: 0 });
    ctx.strokeStyle = o.neverProject ? "#ff4f4f" : "#d0d0d0";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(P(p0).x, P(p0).y);
    ctx.lineTo(P(p1).x, P(p1).y);
    ctx.stroke();
  }

  // Beams and footprints
  for (const p of plan.projectors) {
    const pa = a.projectors.find((x) => x.projectorId === p.id);
    const lens = P({ x: p.x, y: p.y });
    const sel = selected === p.id;
    if (pa?.ok && pa.footprint) {
      const f = a.walls[p.targetWall];
      const pts = pa.footprint.corners.map((c) => canvasToWallPoint(f, c));
      const minS = pts.reduce((m, q) => (q.y < m.y ? q : m));
      const maxS = pts.reduce((m, q) => (q.y > m.y ? q : m));
      ctx.fillStyle = p.color + (sel ? "44" : "22");
      ctx.beginPath();
      ctx.moveTo(lens.x, lens.y);
      ctx.lineTo(P(minS).x, P(minS).y);
      ctx.lineTo(P(maxS).x, P(maxS).y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = p.color;
      ctx.lineWidth = sel ? 1.5 : 0.8;
      ctx.stroke();
      // footprint on the wall line
      ctx.lineWidth = sel ? 9 : 6;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(P(minS).x, P(minS).y);
      ctx.lineTo(P(maxS).x, P(maxS).y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(lens.x, lens.y, sel ? 7 : 5, 0, Math.PI * 2);
    ctx.fill();
    if (pa && !pa.ok) {
      ctx.fillStyle = "#e5484d";
      ctx.fillText("⚠", lens.x + 10, lens.y - 8);
    }
  }

  // Scale bar
  const bar = 10;
  ctx.strokeStyle = "#9aa1b2";
  ctx.fillStyle = "#9aa1b2";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(12, h - 12);
  ctx.lineTo(12 + bar * s, h - 12);
  ctx.stroke();
  ctx.textAlign = "left";
  ctx.font = "11px system-ui";
  ctx.fillText(formatLength(bar, plan.units), 12, h - 18);
}

// ---------------------------------------------------------------------------
// Wall elevation view (seen from inside the room)
// ---------------------------------------------------------------------------
export function drawWall(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  plan: Plan,
  a: PlanAnalysis,
  wall: WallId,
  mode: HeatMode,
  selected: string | null,
): void {
  const f = a.walls[wall];
  const pad = { l: 36, r: 16, t: 22, b: 26 };
  const s = Math.min((w - pad.l - pad.r) / f.length, (h - pad.t - pad.b) / f.height);
  const t: Xform = { s, ox: pad.l, oy: pad.t };
  const X = (x: number) => t.ox + x * s;
  const Y = (y: number) => t.oy + y * s;

  // Wall
  ctx.fillStyle = plan.surfaces[wall].color + "30";
  ctx.fillRect(X(0), Y(0), f.length * s, f.height * s);

  // Heat maps (clipped to the wall)
  ctx.save();
  ctx.beginPath();
  ctx.rect(X(0), Y(0), f.length * s, f.height * s);
  ctx.clip();
  const onWall = a.projectors.filter((p) => p.wall === wall && p.ok);
  for (const pa of onWall) {
    if (mode !== "none") {
      for (const c of pa.cells) {
        let color: string | null = null;
        if (mode === "brightness") color = HEAT_COLORS[brightnessBand(c.fL, plan.goodFL, plan.okFL)];
        else if (mode === "sharpness") color = ppiColor(c.ppi);
        else if (mode === "shadow-seated") color = c.shadow === "seated" ? "rgba(229,72,77,0.75)" : null;
        else if (mode === "shadow-standing") color = c.shadow !== "clear" ? "rgba(229,120,40,0.7)" : null;
        if (!color) continue;
        ctx.fillStyle = color;
        poly(ctx, c.poly, t);
        ctx.fill();
      }
    }
  }
  // Overlaps
  for (const o of a.overlaps.filter((o) => o.wall === wall)) {
    ctx.save();
    poly(ctx, o.poly, t);
    ctx.clip();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    for (let k = -h; k < w + h; k += 8) {
      ctx.beginPath();
      ctx.moveTo(k, 0);
      ctx.lineTo(k + h, h);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();

  // Grid every 5 ft
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= f.length; x += 5) {
    ctx.beginPath();
    ctx.moveTo(X(x), Y(0));
    ctx.lineTo(X(x), Y(f.height));
    ctx.stroke();
  }
  for (let y = 0; y <= f.height; y += 5) {
    ctx.beginPath();
    ctx.moveTo(X(0), Y(f.height - y));
    ctx.lineTo(X(f.length), Y(f.height - y));
    ctx.stroke();
  }

  // Obstructions
  for (const o of plan.obstructions.filter((o) => o.wall === wall)) {
    const r = obstructionRect(f, o);
    ctx.fillStyle = o.neverProject ? "rgba(255,40,40,0.85)" : "rgba(200,200,200,0.55)";
    ctx.fillRect(X(r.x0), Y(r.y0), (r.x1 - r.x0) * s, (r.y1 - r.y0) * s);
    ctx.strokeStyle = o.neverProject ? "#fff" : "#888";
    ctx.lineWidth = 1;
    ctx.strokeRect(X(r.x0), Y(r.y0), (r.x1 - r.x0) * s, (r.y1 - r.y0) * s);
    ctx.fillStyle = "#fff";
    ctx.font = "10px system-ui";
    ctx.textAlign = "left";
    ctx.fillText(o.label, X(r.x0), Y(r.y0) - 3);
  }

  // Footprints
  for (const pa of a.projectors.filter((p) => p.wall === wall)) {
    const p = plan.projectors.find((q) => q.id === pa.projectorId)!;
    if (!pa.ok || !pa.footprint) continue;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = selected === p.id ? 3 : 1.5;
    ctx.setLineDash(selected === p.id ? [] : [6, 3]);
    poly(ctx, pa.footprint.corners, t);
    ctx.stroke();
    ctx.setLineDash([]);
    const cx = pa.onWall.length ? pa.onWall.reduce((m, q) => m + q.x, 0) / pa.onWall.length : 0;
    const cy = pa.onWall.length ? pa.onWall.reduce((m, q) => m + q.y, 0) / pa.onWall.length : 0;
    ctx.fillStyle = p.color;
    ctx.font = "bold 11px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(p.name, X(cx), Y(cy));
  }

  // Wall outline + labels
  ctx.strokeStyle = "#8a90a0";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(X(0), Y(0), f.length * s, f.height * s);
  ctx.fillStyle = "#9aa1b2";
  ctx.font = "11px system-ui";
  ctx.textAlign = "left";
  const stageLeft = wall === "right";
  ctx.fillText(stageLeft ? "◀ stage end" : "back of room", X(0), Y(0) - 6);
  ctx.textAlign = "right";
  ctx.fillText(stageLeft ? "back of room" : "stage end ▶", X(f.length), Y(0) - 6);
  ctx.textAlign = "center";
  ctx.fillText(`${formatLength(f.length, plan.units)} long`, X(f.length / 2), Y(f.height) + 16);
  ctx.save();
  ctx.translate(14, Y(f.height / 2));
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(`${formatLength(f.height, plan.units)} high`, 0, 0);
  ctx.restore();
}
