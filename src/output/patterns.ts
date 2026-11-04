// Test patterns. They are drawn in wall feet across the output's slice, so the grid
// is a real 1-foot grid on the wall and lines up across a blend seam.

import type { OutputConfig, TestPattern } from "../shared/types";

export function drawTestPattern(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  out: OutputConfig,
  pattern: TestPattern,
): void {
  const s = out.slice;
  const sw = s.x1 - s.x0;
  const sh = s.y1 - s.y0;
  const px = (x: number) => ((x - s.x0) / sw) * w;
  const py = (y: number) => ((y - s.y0) / sh) * h;
  const perFoot = w / sw;
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);

  const label = (size: number) => {
    ctx.fillStyle = out.color;
    ctx.font = `bold ${Math.round(size)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lines = [out.name, `${out.wall.toUpperCase()} WALL`];
    lines.forEach((t, i) => {
      ctx.lineWidth = Math.max(2, size / 12);
      ctx.strokeStyle = "#000";
      ctx.strokeText(t, w / 2, h / 2 + (i - 0.5) * size * 1.2);
      ctx.fillText(t, w / 2, h / 2 + (i - 0.5) * size * 1.2);
    });
  };

  const gridLines = (stepFt: number, color: string, lw: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    for (let x = Math.ceil(s.x0 / stepFt) * stepFt; x <= s.x1 + 1e-6; x += stepFt) {
      ctx.moveTo(px(x), 0);
      ctx.lineTo(px(x), h);
    }
    for (let y = Math.ceil(s.y0 / stepFt) * stepFt; y <= s.y1 + 1e-6; y += stepFt) {
      ctx.moveTo(0, py(y));
      ctx.lineTo(w, py(y));
    }
    ctx.stroke();
  };

  switch (pattern) {
    case "white":
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      break;
    case "black":
      break;
    case "bars": {
      const cols = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"];
      cols.forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.fillRect((i * w) / cols.length, 0, w / cols.length + 1, h * 0.75);
      });
      for (let i = 0; i < 8; i++) {
        const v = Math.round((i / 7) * 255);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect((i * w) / 8, h * 0.75, w / 8 + 1, h * 0.25);
      }
      label(Math.min(w, h) / 10);
      break;
    }
    case "grid": {
      gridLines(1, "#3a3a3a", Math.max(1, perFoot / 40));
      gridLines(5, "#ffffff", Math.max(2, perFoot / 15));
      ctx.strokeStyle = out.color;
      ctx.lineWidth = Math.max(3, perFoot / 8);
      ctx.strokeRect(2, 2, w - 4, h - 4);
      // Centre cross
      ctx.beginPath();
      ctx.moveTo(w / 2 - perFoot, h / 2);
      ctx.lineTo(w / 2 + perFoot, h / 2);
      ctx.moveTo(w / 2, h / 2 - perFoot);
      ctx.lineTo(w / 2, h / 2 + perFoot);
      ctx.stroke();
      // Foot numbers along the top, measured on the wall canvas
      ctx.fillStyle = "#ffffff";
      ctx.font = `${Math.max(12, perFoot / 2.5)}px system-ui, sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      for (let x = Math.ceil(s.x0 / 5) * 5; x <= s.x1; x += 5) ctx.fillText(`${x}'`, px(x) + 4, py(Math.ceil(s.y0 / 5) * 5) + 4);
      label(Math.min(w, h) / 14);
      break;
    }
    case "crosshatch": {
      gridLines(2, "#ffffff", Math.max(1.5, perFoot / 25));
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(1.5, perFoot / 25);
      const r = Math.min(sw, sh) / 2;
      for (const k of [1, 0.66, 0.33]) {
        ctx.beginPath();
        ctx.ellipse(w / 2, h / 2, r * k * perFoot, r * k * (h / sh), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Small circles in the corners show lens focus and keystone at the edges.
      for (const [cx, cy] of [
        [0.12, 0.15],
        [0.88, 0.15],
        [0.12, 0.85],
        [0.88, 0.85],
      ]) {
        ctx.beginPath();
        ctx.arc(cx * w, cy * h, Math.min(w, h) * 0.08, 0, Math.PI * 2);
        ctx.stroke();
      }
      label(Math.min(w, h) / 16);
      break;
    }
    case "label":
      label(Math.min(w / 8, h / 3));
      break;
  }
  ctx.restore();
}
