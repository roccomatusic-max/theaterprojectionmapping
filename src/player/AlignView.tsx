import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BlendEdge, MaskPolygon, OutputConfig, Show, TestPattern, Vec2 } from "../shared/types";
import { identityMesh, uid } from "../shared/defaults";
import { meshControlPoints, resampleMesh, warpPoint } from "../shared/warp";
import { api } from "../ui/api";
import { Check, NumField, Row, Section, Select, typingInField } from "../ui/fields";
import { TEST_PATTERNS } from "./SetupView";
import { outputStatus, UiStatus } from "./types";

type Mode = "corners" | "mesh" | "masks";

export function AlignView(props: {
  show: Show;
  setShow: (s: Show) => void;
  status: UiStatus;
  thumbs: Record<string, string>;
  testPatterns: Record<string, TestPattern | null>;
  locked: boolean;
  resetFromPlanner: (outputId: string) => void;
}) {
  const { show, setShow, locked } = props;
  const [outId, setOutId] = useState<string>(show.outputs[0]?.id ?? "");
  const out = show.outputs.find((o) => o.id === outId) ?? show.outputs[0];
  const [mode, setMode] = useState<Mode>("corners");
  const [sel, setSel] = useState<number[]>([]);
  const [draft, setDraft] = useState<Vec2[] | null>(null);
  const [fineStep, setFineStep] = useState(1);

  useEffect(() => setSel([]), [outId, mode]);

  const upOut = useCallback(
    (patch: Partial<OutputConfig>) => {
      if (!out) return;
      setShow({ ...show, outputs: show.outputs.map((o) => (o.id === out.id ? { ...o, ...patch } : o)) });
    },
    [show, out, setShow],
  );

  // Arrow-key nudging of the selected handles.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!out || locked || typingInField() || !sel.length) return;
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!d) return;
      e.preventDefault();
      const px = e.shiftKey ? 10 : fineStep;
      moveHandles(sel, (d[0] * px) / out.width, (d[1] * px) / out.height);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function moveHandles(idx: number[], dx: number, dy: number) {
    if (!out) return;
    if (mode === "corners") {
      const corners = out.corners.map((c, i) => (idx.includes(i) ? { x: c.x + dx, y: c.y + dy } : c)) as OutputConfig["corners"];
      upOut({ corners });
    } else if (mode === "mesh") {
      const offsets = out.mesh.offsets.map((o, i) => (idx.includes(i) ? { x: o.x + dx, y: o.y + dy } : o));
      upOut({ mesh: { ...out.mesh, offsets } });
    } else if (mode === "masks") {
      // indices encode mask*1000 + point
      const masks = out.masks.map((m, mi) => ({
        ...m,
        points: m.points.map((p, pi) => (idx.includes(mi * 1000 + pi) ? { x: p.x + dx, y: p.y + dy } : p)),
      }));
      upOut({ masks });
    }
  }

  if (!out) {
    return (
      <div className="content">
        <div className="panel">No outputs yet. Go to Setup and import projectors from the Planner, or add an output by hand.</div>
      </div>
    );
  }

  const st = outputStatus(props.status, out.id, out.node);
  const tp = props.testPatterns[out.id] ?? null;
  const setBlend = (edge: keyof OutputConfig["blend"], patch: Partial<BlendEdge>) => upOut({ blend: { ...out.blend, [edge]: { ...out.blend[edge], ...patch } } });
  const wallMasks = show.wallMasks[out.wall] ?? [];
  const setWallMasks = (m: MaskPolygon[]) => setShow({ ...show, wallMasks: { ...show.wallMasks, [out.wall]: m } });

  return (
    <div className="main">
      <aside className="sidebar">
        <Section title="Output">
          <Select value={out.id} options={show.outputs.map((o) => ({ value: o.id, label: `${o.name} (${o.wall} wall)` }))} onChange={setOutId} />
          <div className="hstack">
            <span className="muted">Test pattern:</span>
            {TEST_PATTERNS.map((p) => (
              <button key={p.value} className={tp === p.value ? "small on" : "small"} disabled={locked} onClick={() => api.testPattern([out.id], p.value)}>
                {p.label}
              </button>
            ))}
            <button className={!tp ? "small on" : "small"} onClick={() => api.testPattern([out.id], null)}>
              Content
            </button>
          </div>
          {st && (
            <div className="muted">
              {st.open ? `${st.fps} fps · ${st.droppedFrames} dropped frames` : "Output window is not open (assign a display in Setup)."}
            </div>
          )}
        </Section>

        <Section title="Warp">
          <div className="hstack">
            {(["corners", "mesh", "masks"] as Mode[]).map((m) => (
              <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
                {m === "corners" ? "Corner pin" : m === "mesh" ? "Mesh" : "Output masks"}
              </button>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Click a handle (Shift-click for several), drag it, or nudge with the arrow keys: {fineStep} px per press, 10 px with Shift held. Watch the real wall while you
            move them.
          </div>
          <Row label="Fine step">
            <Select value={fineStep} options={[0.25, 0.5, 1, 2].map((v) => ({ value: v, label: `${v} px` }))} onChange={setFineStep} />
          </Row>
          {mode === "mesh" && (
            <Row label="Mesh points">
              <Select
                value={out.mesh.cols}
                disabled={locked}
                options={[2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => ({ value: v, label: `${v} across` }))}
                onChange={(v) => upOut({ mesh: resampleMesh(out.mesh, v, out.mesh.rows) })}
              />
              <Select
                value={out.mesh.rows}
                disabled={locked}
                options={[2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => ({ value: v, label: `${v} down` }))}
                onChange={(v) => upOut({ mesh: resampleMesh(out.mesh, out.mesh.cols, v) })}
              />
            </Row>
          )}
          <div className="hstack">
            <button className="small" disabled={locked} onClick={() => confirm("Put the mesh back flat?") && upOut({ mesh: identityMesh(out.mesh.cols, out.mesh.rows) })}>
              Reset mesh
            </button>
            <button className="small" disabled={locked} onClick={() => confirm("Reset the corners and mesh to what the Planner calculated?") && props.resetFromPlanner(out.id)}>
              Reset from Planner
            </button>
            <button
              className="small"
              disabled={locked}
              onClick={() =>
                confirm("Stretch the slice to the full projector frame?") &&
                upOut({ corners: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], mesh: identityMesh(out.mesh.cols, out.mesh.rows) })
              }
            >
              Full frame
            </button>
          </div>
        </Section>

        <Section title="Part of the wall this projector shows" open={false}>
          <div className="muted" style={{ fontSize: 12 }}>
            Feet on the wall canvas, measured from the wall's top-left corner as seen from inside the room.
          </div>
          <Row label="Left / right">
            <NumField value={out.slice.x0} step={0.25} disabled={locked} onChange={(v) => upOut({ slice: { ...out.slice, x0: v } })} />
            <NumField value={out.slice.x1} step={0.25} disabled={locked} onChange={(v) => upOut({ slice: { ...out.slice, x1: v } })} />
          </Row>
          <Row label="Top / bottom">
            <NumField value={out.slice.y0} step={0.25} disabled={locked} onChange={(v) => upOut({ slice: { ...out.slice, y0: v } })} />
            <NumField value={out.slice.y1} step={0.25} disabled={locked} onChange={(v) => upOut({ slice: { ...out.slice, y1: v } })} />
          </Row>
        </Section>

        <Section title="Edge blend">
          <div className="muted" style={{ fontSize: 12 }}>
            Width is in feet on the wall. Two projectors that overlap should have the same width on their touching edges. Curve 2 is a smooth S; gamma 2.2 suits most
            projectors.
          </div>
          {(["left", "right", "top", "bottom"] as const).map((edge) => (
            <Row key={edge} label={edge}>
              <NumField value={out.blend[edge].width} step={0.25} min={0} width={60} suffix="ft" disabled={locked} onChange={(v) => setBlend(edge, { width: v })} />
              <NumField value={out.blend[edge].curve} step={0.1} min={0.5} max={4} width={52} disabled={locked} onChange={(v) => setBlend(edge, { curve: v })} />
              <NumField value={out.blend[edge].gamma} step={0.1} min={1} max={3} width={52} disabled={locked} onChange={(v) => setBlend(edge, { gamma: v })} />
            </Row>
          ))}
          <div className="muted" style={{ fontSize: 11 }}>
            columns: width · curve · gamma
          </div>
        </Section>

        <Section title="Brightness and colour match">
          <Row label="Brightness">
            <input type="range" min={0} max={1.5} step={0.01} value={out.brightness} disabled={locked} onChange={(e) => upOut({ brightness: parseFloat(e.target.value) })} />
            <span>{Math.round(out.brightness * 100)}%</span>
          </Row>
          {(["Red", "Green", "Blue"] as const).map((c, i) => (
            <Row key={c} label={c}>
              <input
                type="range"
                min={0.5}
                max={1.2}
                step={0.01}
                value={out.rgb[i]}
                disabled={locked}
                onChange={(e) => {
                  const rgb = [...out.rgb] as [number, number, number];
                  rgb[i] = parseFloat(e.target.value);
                  upOut({ rgb });
                }}
              />
              <span>{Math.round(out.rgb[i] * 100)}%</span>
            </Row>
          ))}
        </Section>

        <Section title={`Wall masks (${out.wall} wall)`}>
          <div className="muted" style={{ fontSize: 12 }}>
            Masked areas are pure black on every projector that covers them. Exit-sign masks from the Planner can't be switched off.
          </div>
          {wallMasks.map((m) => (
            <div key={m.id} className="hstack">
              <Check
                label={m.name}
                checked={m.enabled || !!m.locked}
                disabled={locked || !!m.locked}
                onChange={(v) => setWallMasks(wallMasks.map((x) => (x.id === m.id ? { ...x, enabled: v } : x)))}
              />
              {m.locked && <span className="pill bad">never project</span>}
              <span className="grow" />
              {!m.fromObstruction && (
                <button className="small" disabled={locked} onClick={() => setWallMasks(wallMasks.filter((x) => x.id !== m.id))}>
                  ✕
                </button>
              )}
            </div>
          ))}
          <AddWallMask disabled={locked} onAdd={(m) => setWallMasks([...wallMasks, m])} />
        </Section>

        {mode === "masks" && (
          <Section title="Output masks">
            <div className="muted" style={{ fontSize: 12 }}>
              Click “New mask”, then click points on the preview around the area to black out, then “Finish”. Drag points to adjust.
            </div>
            <div className="hstack">
              {!draft ? (
                <button disabled={locked} onClick={() => setDraft([])}>
                  New mask
                </button>
              ) : (
                <>
                  <button
                    className="primary"
                    disabled={draft.length < 3}
                    onClick={() => {
                      upOut({ masks: [...out.masks, { id: uid("mask"), name: `Mask ${out.masks.length + 1}`, points: draft, enabled: true }] });
                      setDraft(null);
                    }}
                  >
                    Finish ({draft.length} points)
                  </button>
                  <button onClick={() => setDraft(null)}>Cancel</button>
                </>
              )}
            </div>
            {out.masks.map((m) => (
              <div key={m.id} className="hstack">
                <Check label={m.name} checked={m.enabled} disabled={locked} onChange={(v) => upOut({ masks: out.masks.map((x) => (x.id === m.id ? { ...x, enabled: v } : x)) })} />
                <span className="grow" />
                <button className="small" disabled={locked} onClick={() => upOut({ masks: out.masks.filter((x) => x.id !== m.id) })}>
                  ✕
                </button>
              </div>
            ))}
          </Section>
        )}
      </aside>
      <div className="content">
        <WarpEditor
          out={out}
          show={show}
          mode={mode}
          sel={sel}
          setSel={setSel}
          thumb={props.thumbs[out.id]}
          locked={locked}
          draft={draft}
          onDraftPoint={(p) => setDraft((d) => (d ? [...d, p] : d))}
          onMove={moveHandles}
        />
        <div className="muted">
          The preview shows the projector frame. Light grey lines are the warped wall grid; red shapes are masks. The picture behind is a live capture of the output,
          about once a second.
        </div>
      </div>
    </div>
  );
}

function AddWallMask(props: { disabled: boolean; onAdd: (m: MaskPolygon) => void }) {
  const [r, setR] = useState({ x: 10, y: 10, w: 2, h: 2 });
  return (
    <div className="card">
      <div className="muted" style={{ fontSize: 12 }}>
        Add a rectangle (feet from the wall's top-left, seen from inside):
      </div>
      <div className="hstack">
        x <NumField value={r.x} width={56} step={0.25} onChange={(v) => setR({ ...r, x: v })} />
        y <NumField value={r.y} width={56} step={0.25} onChange={(v) => setR({ ...r, y: v })} />
        w <NumField value={r.w} width={56} step={0.25} min={0.1} onChange={(v) => setR({ ...r, w: v })} />
        h <NumField value={r.h} width={56} step={0.25} min={0.1} onChange={(v) => setR({ ...r, h: v })} />
        <button
          className="small"
          disabled={props.disabled}
          onClick={() =>
            props.onAdd({
              id: uid("mask"),
              name: `Mask at ${r.x}', ${r.y}'`,
              enabled: true,
              points: [
                { x: r.x, y: r.y },
                { x: r.x + r.w, y: r.y },
                { x: r.x + r.w, y: r.y + r.h },
                { x: r.x, y: r.y + r.h },
              ],
            })
          }
        >
          Add
        </button>
      </div>
    </div>
  );
}

function WarpEditor(props: {
  out: OutputConfig;
  show: Show;
  mode: Mode;
  sel: number[];
  setSel: (s: number[]) => void;
  thumb?: string;
  locked: boolean;
  draft: Vec2[] | null;
  onDraftPoint: (p: Vec2) => void;
  onMove: (idx: number[], dx: number, dy: number) => void;
}) {
  const { out, mode, sel } = props;
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{ last: Vec2; idx: number[] } | null>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      const w = wrap.current?.clientWidth ?? 800;
      const maxH = window.innerHeight - 200;
      let cw = w;
      let ch = (w * out.height) / out.width;
      if (ch > maxH) {
        ch = maxH;
        cw = (ch * out.width) / out.height;
      }
      setSize({ w: Math.round(cw), h: Math.round(ch) });
    });
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [out.width, out.height]);

  useEffect(() => {
    if (!props.thumb) return;
    const i = new Image();
    i.onload = () => {
      img.current = i;
      draw();
    };
    i.src = props.thumb;
  });

  const handles = useMemo((): Vec2[] => {
    if (mode === "corners") return out.corners;
    if (mode === "mesh") return meshControlPoints(out);
    return out.masks.flatMap((m) => m.points);
  }, [mode, out]);
  const handleIds = useMemo((): number[] => {
    if (mode !== "masks") return handles.map((_, i) => i);
    return out.masks.flatMap((m, mi) => m.points.map((_, pi) => mi * 1000 + pi));
  }, [mode, handles, out.masks]);

  function draw() {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size.w * dpr;
    c.height = size.h * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = size.w;
    const H = size.h;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    if (img.current) {
      ctx.globalAlpha = 0.85;
      ctx.drawImage(img.current, 0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    const P = (p: Vec2) => ({ x: p.x * W, y: p.y * H });
    const s = out.slice;
    const sw = s.x1 - s.x0;
    const sh = s.y1 - s.y0;
    // Warped wall grid every 5 ft
    ctx.strokeStyle = "rgba(220,220,220,0.35)";
    ctx.lineWidth = 1;
    const line = (fn: (t: number) => Vec2) => {
      ctx.beginPath();
      for (let k = 0; k <= 40; k++) {
        const q = P(fn(k / 40));
        k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
      }
      ctx.stroke();
    };
    for (let x = Math.ceil(s.x0 / 5) * 5; x <= s.x1; x += 5) line((t) => warpPoint(out, (x - s.x0) / sw, t));
    for (let y = Math.ceil(s.y0 / 5) * 5; y <= s.y1; y += 5) line((t) => warpPoint(out, t, (y - s.y0) / sh));
    // Slice outline
    ctx.strokeStyle = out.color;
    ctx.lineWidth = 2;
    line((t) => warpPoint(out, t, 0));
    line((t) => warpPoint(out, 1, t));
    line((t) => warpPoint(out, 1 - t, 1));
    line((t) => warpPoint(out, 0, 1 - t));
    // Wall masks
    for (const m of props.show.wallMasks[out.wall] ?? []) {
      if (!m.enabled && !m.locked) continue;
      ctx.fillStyle = "rgba(229,72,77,0.45)";
      ctx.strokeStyle = "#ff6b6b";
      ctx.beginPath();
      m.points.forEach((p, i) => {
        const q = P(warpPoint(out, (p.x - s.x0) / sw, (p.y - s.y0) / sh));
        i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    // Output masks
    for (const m of out.masks) {
      ctx.fillStyle = m.enabled ? "rgba(229,72,77,0.45)" : "rgba(120,120,120,0.3)";
      ctx.strokeStyle = "#ff9b9b";
      ctx.beginPath();
      m.points.forEach((p, i) => (i ? ctx.lineTo(p.x * W, p.y * H) : ctx.moveTo(p.x * W, p.y * H)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    if (props.draft) {
      ctx.strokeStyle = "#ffd23d";
      ctx.beginPath();
      props.draft.forEach((p, i) => (i ? ctx.lineTo(p.x * W, p.y * H) : ctx.moveTo(p.x * W, p.y * H)));
      ctx.stroke();
      for (const p of props.draft) {
        ctx.fillStyle = "#ffd23d";
        ctx.fillRect(p.x * W - 3, p.y * H - 3, 6, 6);
      }
    }
    // Handles
    handles.forEach((h, i) => {
      const q = P(h);
      const isSel = sel.includes(handleIds[i]);
      ctx.fillStyle = isSel ? "#ffd23d" : "#fff";
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1.5;
      if (mode === "corners") {
        ctx.fillRect(q.x - 7, q.y - 7, 14, 14);
        ctx.strokeRect(q.x - 7, q.y - 7, 14, 14);
      } else {
        ctx.beginPath();
        ctx.arc(q.x, q.y, mode === "mesh" ? 5 : 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    });
    ctx.strokeStyle = "#555";
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }
  useEffect(draw);

  const toNorm = (e: React.PointerEvent): Vec2 => {
    const r = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  return (
    <div ref={wrap} style={{ width: "100%" }}>
      <canvas
        ref={ref}
        style={{ width: size.w, height: size.h, border: "1px solid #333", borderRadius: 6, cursor: props.locked ? "default" : "crosshair", touchAction: "none" }}
        onPointerDown={(e) => {
          if (props.locked) return;
          const p = toNorm(e);
          if (props.draft) {
            props.onDraftPoint(p);
            return;
          }
          let best = -1;
          let bestD = 14; // pixels
          handles.forEach((h, i) => {
            const d = Math.hypot((h.x - p.x) * size.w, (h.y - p.y) * size.h);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          });
          if (best < 0) {
            if (!e.shiftKey) props.setSel([]);
            return;
          }
          const id = handleIds[best];
          const next = e.shiftKey ? (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]) : sel.includes(id) ? sel : [id];
          props.setSel(next);
          drag.current = { last: p, idx: next };
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const p = toNorm(e);
          const dx = p.x - drag.current.last.x;
          const dy = p.y - drag.current.last.y;
          drag.current.last = p;
          props.onMove(drag.current.idx, dx, dy);
        }}
        onPointerUp={() => (drag.current = null)}
      />
    </div>
  );
}
