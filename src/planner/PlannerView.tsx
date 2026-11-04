import { useEffect, useMemo, useRef, useState } from "react";
import type { Obstruction, ObstructionKind, Plan, Projector, Vec2, WallId } from "../shared/types";
import { WALL_IDS } from "../shared/types";
import { analyzePlan, defaultWallLine, fitZoom, PlanAnalysis, ProjectorAnalysis, wallLine } from "../shared/geometry";
import { aimProjectorAtHalf, baseProjector, defaultPlan, PROJECTOR_COLORS, uid } from "../shared/defaults";
import { formatArea, formatLength } from "../shared/units";
import { Check, LengthField, NumField, Row, Section, Select, TextField, round } from "../ui/fields";
import { drawTopDown, drawWall, HEAT_COLORS, HeatMode, PPI_SCALE_MAX, ppiColor, setupCanvas } from "./draw";
import { HelpPanel } from "./HelpPanel";
import { buildSummaryHtml } from "./summary";

interface Props {
  plan: Plan;
  setPlan: (p: Plan) => void;
  planPath: string | null;
  onOpen: () => void;
  onSave: (saveAs: boolean) => void;
  onSendToPlayer: () => void;
  locked: boolean;
}

export function PlannerView({ plan, setPlan, planPath, onOpen, onSave, onSendToPlayer, locked }: Props) {
  const analysis = useMemo(() => analyzePlan(plan), [plan]);
  const [selected, setSelected] = useState<string | null>(plan.projectors[0]?.id ?? null);
  const [mode, setMode] = useState<HeatMode>("brightness");
  const [help, setHelp] = useState(false);
  const u = plan.units;

  const up = (patch: Partial<Plan>) => setPlan({ ...plan, ...patch });
  const upRoom = (patch: Partial<Plan["room"]>) => up({ room: { ...plan.room, ...patch } });
  const upProj = (id: string, patch: Partial<Projector>) =>
    up({ projectors: plan.projectors.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const upObs = (id: string, patch: Partial<Obstruction>) =>
    up({ obstructions: plan.obstructions.map((o) => (o.id === id ? { ...o, ...patch } : o)) });

  const exportSummary = async () => {
    const html = buildSummaryHtml(plan, analysis);
    await window.api?.invoke("export:pdf", html, `${plan.name || "Plan"} - wall summary.pdf`);
  };

  return (
    <div className="main">
      <aside className="sidebar">
        <Section
          title="Plan"
          right={
            <span className="hstack">
              <button className="small" onClick={() => setHelp(true)}>
                How the numbers work
              </button>
            </span>
          }
        >
          <Row label="Name">
            <TextField value={plan.name} onChange={(v) => up({ name: v })} disabled={locked} />
          </Row>
          <Row label="Units">
            <Select
              value={plan.units}
              options={[
                { value: "imperial", label: "Feet and inches" },
                { value: "metric", label: "Metric" },
              ]}
              onChange={(v) => up({ units: v })}
            />
          </Row>
          <div className="hstack">
            <button onClick={onOpen}>Open…</button>
            <button onClick={() => onSave(false)}>Save</button>
            <button onClick={() => onSave(true)}>Save as…</button>
            <button
              disabled={locked}
              onClick={() => {
                if (confirm("Start over with the default room and four projectors? Save first if you want to keep this plan.")) setPlan(defaultPlan());
              }}
            >
              Reset
            </button>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {planPath ? `File: ${planPath}` : "Not saved to a file yet (it is kept automatically on this computer)."}
          </div>
        </Section>

        <Section title="Room">
          <Row label="Front width" hint="Wall to wall at the stage edge">
            <LengthField value={plan.room.frontWidth} units={u} min={1} onChange={(v) => upRoom({ frontWidth: v })} disabled={locked} />
          </Row>
          <Row label="Back width" hint="Wall to wall at the back of the room">
            <LengthField value={plan.room.backWidth} units={u} min={1} onChange={(v) => upRoom({ backWidth: v })} disabled={locked} />
          </Row>
          <Row label="Length" hint="Stage edge to back wall">
            <LengthField value={plan.room.length} units={u} min={1} onChange={(v) => upRoom({ length: v })} disabled={locked} />
          </Row>
          <Row label="Wall height">
            <LengthField value={plan.room.wallHeight} units={u} min={1} onChange={(v) => upRoom({ wallHeight: v })} disabled={locked} />
          </Row>
          {WALL_IDS.map((w) => {
            const ov = plan.room.wallOverrides[w];
            const line = wallLine(plan.room, w);
            const setLine = (k: "start" | "end", axis: "x" | "y", v: number) =>
              upRoom({ wallOverrides: { ...plan.room.wallOverrides, [w]: { ...line, [k]: { ...line[k], [axis]: v } } } });
            return (
              <div key={w} className="card">
                <Check
                  label={`Adjust ${w} wall ends by hand`}
                  checked={!!ov}
                  disabled={locked}
                  onChange={(on) => upRoom({ wallOverrides: { ...plan.room.wallOverrides, [w]: on ? defaultWallLine(plan.room, w) : null } })}
                />
                {ov && (
                  <>
                    <div className="muted" style={{ fontSize: 12 }}>
                      x = across the room (+ is house right), y = distance back from the stage edge.
                    </div>
                    <Row label="Stage end x / y">
                      <LengthField value={line.start.x} units={u} onChange={(v) => setLine("start", "x", v)} disabled={locked} />
                      <LengthField value={line.start.y} units={u} onChange={(v) => setLine("start", "y", v)} disabled={locked} />
                    </Row>
                    <Row label="Back end x / y">
                      <LengthField value={line.end.x} units={u} onChange={(v) => setLine("end", "x", v)} disabled={locked} />
                      <LengthField value={line.end.y} units={u} onChange={(v) => setLine("end", "y", v)} disabled={locked} />
                    </Row>
                  </>
                )}
              </div>
            );
          })}
        </Section>

        <Section title="Audience" open={false}>
          <Row label="Seated head height">
            <LengthField value={plan.audience.seatedHeadHeight} units={u} min={0} onChange={(v) => up({ audience: { ...plan.audience, seatedHeadHeight: v } })} disabled={locked} />
          </Row>
          <Row label="Standing height">
            <LengthField value={plan.audience.standingHeadHeight} units={u} min={0} onChange={(v) => up({ audience: { ...plan.audience, standingHeadHeight: v } })} disabled={locked} />
          </Row>
          <div className="muted" style={{ fontSize: 12 }}>
            Seating outline corners (x across, y back from the stage edge):
          </div>
          {plan.audience.outline.map((p, i) => (
            <Row key={i} label={`Corner ${i + 1}`}>
              <LengthField value={p.x} units={u} onChange={(v) => setOutline(plan, up, i, { ...p, x: v })} disabled={locked} />
              <LengthField value={p.y} units={u} onChange={(v) => setOutline(plan, up, i, { ...p, y: v })} disabled={locked} />
              <button
                className="small"
                disabled={locked || plan.audience.outline.length <= 3}
                onClick={() => up({ audience: { ...plan.audience, outline: plan.audience.outline.filter((_, j) => j !== i) } })}
              >
                ✕
              </button>
            </Row>
          ))}
          <div className="hstack">
            <button
              className="small"
              disabled={locked}
              onClick={() => {
                const o = plan.audience.outline;
                const a = o[o.length - 1];
                const b = o[0];
                up({ audience: { ...plan.audience, outline: [...o, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }] } });
              }}
            >
              Add corner
            </button>
            <button className="small" disabled={locked} onClick={() => up({ audience: { ...plan.audience, outline: insetOutline(plan) } })}>
              Fit to room
            </button>
          </div>
        </Section>

        <Section title="Wall surface and light loss" open={false}>
          {WALL_IDS.map((w) => (
            <Row key={w} label={`${cap(w)} wall`}>
              <NumField
                value={plan.surfaces[w].gain}
                step={0.05}
                min={0.1}
                max={3}
                suffix="gain"
                disabled={locked}
                onChange={(v) => up({ surfaces: { ...plan.surfaces, [w]: { ...plan.surfaces[w], gain: v } } })}
              />
              <input
                type="color"
                value={plan.surfaces[w].color}
                disabled={locked}
                onChange={(e) => up({ surfaces: { ...plan.surfaces, [w]: { ...plan.surfaces[w], color: e.target.value } } })}
              />
            </Row>
          ))}
          <Row label="Derate" hint="Real-world loss: aged lamp, lens, dust. 0.8 = 80% of rated lumens.">
            <NumField value={plan.derate} step={0.05} min={0.1} max={1} onChange={(v) => up({ derate: v })} disabled={locked} />
          </Row>
          <Row label="Good / OK (fL)">
            <NumField value={plan.goodFL} step={0.5} min={0} onChange={(v) => up({ goodFL: v })} disabled={locked} />
            <NumField value={plan.okFL} step={0.5} min={0} onChange={(v) => up({ okFL: v })} disabled={locked} />
          </Row>
        </Section>

        <Section
          title={`Projectors (${plan.projectors.length})`}
          right={
            <button
              className="small"
              disabled={locked}
              onClick={() => {
                const p = baseProjector({
                  name: `Projector ${plan.projectors.length + 1}`,
                  x: -plan.room.backWidth / 2 + 1.5,
                  y: plan.room.length - 1.5,
                  color: PROJECTOR_COLORS[plan.projectors.length % PROJECTOR_COLORS.length],
                });
                aimProjectorAtHalf(plan, p, "front", 0.15);
                up({ projectors: [...plan.projectors, p] });
                setSelected(p.id);
              }}
            >
              + Add
            </button>
          }
        >
          {plan.projectors.map((p) => (
            <ProjectorCard
              key={p.id}
              p={p}
              plan={plan}
              analysis={analysis.projectors.find((a) => a.projectorId === p.id)}
              selected={selected === p.id}
              onSelect={() => setSelected(p.id)}
              onChange={(patch) => upProj(p.id, patch)}
              onDuplicate={() => {
                const c = { ...p, id: uid("proj"), name: `${p.name} copy`, color: PROJECTOR_COLORS[(plan.projectors.length) % PROJECTOR_COLORS.length] };
                up({ projectors: [...plan.projectors, c] });
                setSelected(c.id);
              }}
              onRemove={() => confirm(`Remove ${p.name}?`) && up({ projectors: plan.projectors.filter((q) => q.id !== p.id) })}
              locked={locked}
            />
          ))}
        </Section>

        <Section
          title={`Obstructions (${plan.obstructions.length})`}
          right={
            <button
              className="small"
              disabled={locked}
              onClick={() =>
                up({
                  obstructions: [
                    ...plan.obstructions,
                    { id: uid("obs"), wall: "left", kind: "exit-sign", label: "Exit sign", fromStage: 10, bottom: 8, width: 1.25, height: 0.75, neverProject: true },
                  ],
                })
              }
            >
              + Add
            </button>
          }
        >
          <div className="muted" style={{ fontSize: 12 }}>
            “From stage end” is the distance along the wall from its stage end to the edge of the item nearest the stage. Red items are “never project here”.
          </div>
          {plan.obstructions.map((o) => (
            <div key={o.id} className="card">
              <div className="head">
                <TextField value={o.label} onChange={(v) => upObs(o.id, { label: v })} disabled={locked} width={130} />
                <Select
                  value={o.kind}
                  disabled={locked}
                  options={(["exit-sign", "door", "speaker", "sconce", "other"] as ObstructionKind[]).map((k) => ({ value: k, label: k }))}
                  onChange={(v) => upObs(o.id, { kind: v, neverProject: v === "exit-sign" ? true : o.neverProject })}
                />
                <Select value={o.wall} disabled={locked} options={WALL_IDS.map((w) => ({ value: w, label: `${w} wall` }))} onChange={(v) => upObs(o.id, { wall: v })} />
                <span className="grow" />
                <button className="small" disabled={locked} onClick={() => up({ obstructions: plan.obstructions.filter((x) => x.id !== o.id) })}>
                  ✕
                </button>
              </div>
              <Row label="From stage end">
                <LengthField value={o.fromStage} units={u} min={0} onChange={(v) => upObs(o.id, { fromStage: v })} disabled={locked} />
              </Row>
              <Row label="Bottom above floor">
                <LengthField value={o.bottom} units={u} min={0} onChange={(v) => upObs(o.id, { bottom: v })} disabled={locked} />
              </Row>
              <Row label="Width / height">
                <LengthField value={o.width} units={u} min={0.01} onChange={(v) => upObs(o.id, { width: v })} disabled={locked} />
                <LengthField value={o.height} units={u} min={0.01} onChange={(v) => upObs(o.id, { height: v })} disabled={locked} />
              </Row>
              <Check
                label="Never project here"
                checked={o.neverProject}
                disabled={locked || o.kind === "exit-sign"}
                onChange={(v) => upObs(o.id, { neverProject: v })}
              />
            </div>
          ))}
        </Section>
      </aside>

      <div className="content">
        <div className="hstack">
          <span className="muted">Heat map:</span>
          {(
            [
              ["none", "None"],
              ["brightness", "Brightness"],
              ["sharpness", "Sharpness"],
              ["shadow-seated", "Shadows (seated)"],
              ["shadow-standing", "Shadows (standing)"],
            ] as [HeatMode, string][]
          ).map(([m, l]) => (
            <button key={m} className={mode === m ? "on small" : "small"} onClick={() => setMode(m)}>
              {l}
            </button>
          ))}
          <span className="grow" />
          <button onClick={exportSummary}>Export wall summary (PDF)</button>
          <button className="primary" onClick={onSendToPlayer}>
            Send to Player →
          </button>
        </div>
        <Legend mode={mode} plan={plan} />
        <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1fr) 2fr", gap: 12 }}>
          <div className="panel">
            <h3>Top-down view</h3>
            <CanvasView height={460} draw={(ctx, w, h) => drawTopDown(ctx, w, h, plan, analysis, selected)} deps={[plan, analysis, selected]} />
          </div>
          <div className="vstack">
            {(["left", "right"] as WallId[]).map((w) => (
              <div key={w} className="panel">
                <h3>{cap(w)} wall, as seen from inside the room</h3>
                <CanvasView height={210} draw={(ctx, cw, ch) => drawWall(ctx, cw, ch, plan, analysis, w, mode, selected)} deps={[plan, analysis, mode, selected]} />
              </div>
            ))}
          </div>
        </div>
        <ResultsTable plan={plan} analysis={analysis} selected={selected} onSelect={setSelected} />
      </div>
      {help && <HelpPanel onClose={() => setHelp(false)} />}
    </div>
  );
}

function setOutline(plan: Plan, up: (p: Partial<Plan>) => void, i: number, p: Vec2) {
  up({ audience: { ...plan.audience, outline: plan.audience.outline.map((q, j) => (j === i ? p : q)) } });
}

function insetOutline(plan: Plan): Vec2[] {
  const r = plan.room;
  const front = 8;
  const back = r.length - 6;
  const lerp = (y: number) => r.frontWidth / 2 + ((r.backWidth - r.frontWidth) / 2) * (y / r.length) - 4;
  return [
    { x: -lerp(front), y: front },
    { x: lerp(front), y: front },
    { x: lerp(back), y: back },
    { x: -lerp(back), y: back },
  ].map((p) => ({ x: round(p.x, 2), y: round(p.y, 2) }));
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function CanvasView(props: { height: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; deps: unknown[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = setupCanvas(c, props.height);
    props.draw(ctx, c.clientWidth, props.height);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...props.deps, props.height]);
  useEffect(() => {
    const ro = new ResizeObserver(() => force((n) => n + 1));
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = setupCanvas(c, props.height);
    props.draw(ctx, c.clientWidth, props.height);
  });
  return <canvas ref={ref} className="view" />;
}

function Legend({ mode, plan }: { mode: HeatMode; plan: Plan }) {
  if (mode === "none") return null;
  return (
    <div className="legend">
      {mode === "brightness" && (
        <>
          <span>
            <i style={{ background: HEAT_COLORS.good }} />≥ {plan.goodFL} fL
          </span>
          <span>
            <i style={{ background: HEAT_COLORS.ok }} />
            {plan.okFL}–{plan.goodFL} fL
          </span>
          <span>
            <i style={{ background: HEAT_COLORS.low }} />&lt; {plan.okFL} fL
          </span>
        </>
      )}
      {mode === "sharpness" &&
        [0, 3, 6, 9, 12, PPI_SCALE_MAX].map((v) => (
          <span key={v}>
            <i style={{ background: ppiColor(v) }} />
            {v}
            {v === PPI_SCALE_MAX ? "+" : ""} px/in
          </span>
        ))}
      {mode === "shadow-seated" && (
        <span>
          <i style={{ background: "rgba(229,72,77,0.75)" }} />
          beam passes through seated heads ({formatLength(plan.audience.seatedHeadHeight, plan.units)})
        </span>
      )}
      {mode === "shadow-standing" && (
        <span>
          <i style={{ background: "rgba(229,120,40,0.7)" }} />
          beam passes through standing heads ({formatLength(plan.audience.standingHeadHeight, plan.units)})
        </span>
      )}
      <span>Hatched = blend overlap. Red boxes = never project here.</span>
    </div>
  );
}

function ResultsTable({ plan, analysis, selected, onSelect }: { plan: Plan; analysis: PlanAnalysis; selected: string | null; onSelect: (id: string) => void }) {
  const u = plan.units;
  return (
    <div className="panel">
      <h3>Results</h3>
      <table className="grid">
        <thead>
          <tr>
            <th>Projector</th>
            <th>Wall</th>
            <th>Throw</th>
            <th>Image on wall (top / bottom width)</th>
            <th>Brightness (min · avg · max)</th>
            <th>Sharpness</th>
            <th>Shadow risk</th>
            <th>Warnings</th>
          </tr>
        </thead>
        <tbody>
          {plan.projectors.map((p) => {
            const a = analysis.projectors.find((x) => x.projectorId === p.id)!;
            return (
              <tr key={p.id} className={selected === p.id ? "sel" : ""} onClick={() => onSelect(p.id)}>
                <td>
                  <span className="swatch" style={{ background: p.color }} /> {p.name}
                </td>
                <td>{p.targetWall}</td>
                {a.ok ? (
                  <>
                    <td>{formatLength(a.throwDistance, u)}</td>
                    <td>
                      {formatLength(a.edges[0], u)} / {formatLength(a.edges[2], u)} · {formatArea(a.onWallArea, u)}
                    </td>
                    <td>
                      <span className={band(a.minFL, plan)}>{a.minFL.toFixed(1)}</span> · {a.averageFL.toFixed(1)} · {a.maxFL.toFixed(1)} fL
                    </td>
                    <td>
                      {a.minPPI.toFixed(1)}–{a.maxPPI.toFixed(1)} px/in
                    </td>
                    <td>
                      <span className={a.seatedShadowPct > 0 ? "bad" : "ok"}>{a.seatedShadowPct.toFixed(0)}% seated</span> ·{" "}
                      <span className={a.standingShadowPct > 0 ? "warn" : "ok"}>{a.standingShadowPct.toFixed(0)}% standing</span>
                    </td>
                    <td>{warnings(plan, a).join(" ") || <span className="ok">—</span>}</td>
                  </>
                ) : (
                  <td colSpan={6} className="bad">
                    {a.error}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {analysis.overlaps.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <b>Blend overlaps:</b>{" "}
          {analysis.overlaps.map((o) => {
            const A = plan.projectors.find((p) => p.id === o.a)!;
            const B = plan.projectors.find((p) => p.id === o.b)!;
            return (
              <div key={o.a + o.b}>
                {o.wall} wall: {A.name} + {B.name} overlap {formatLength(o.width, u)} wide ({o.pctOfA.toFixed(0)}% / {o.pctOfB.toFixed(0)}% of each image)
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function band(fL: number, plan: Plan) {
  return fL >= plan.goodFL ? "ok" : fL >= plan.okFL ? "warn" : "bad";
}

function warnings(plan: Plan, a: ProjectorAnalysis): string[] {
  const w: string[] = [];
  for (const h of a.obstructionHits) {
    const o = plan.obstructions.find((x) => x.id === h.obstructionId);
    if (!o) continue;
    w.push(h.neverProject ? `⛔ covers ${o.label} (will be masked)` : `covers ${o.label}`);
  }
  if (a.onWallArea < a.footprintArea * 0.97) w.push(`${Math.round(100 - (100 * a.onWallArea) / a.footprintArea)}% spills off the wall`);
  return w;
}

function ProjectorCard(props: {
  p: Projector;
  plan: Plan;
  analysis?: ProjectorAnalysis;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<Projector>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  locked: boolean;
}) {
  const { p, plan, onChange, locked } = props;
  const u = plan.units;
  const [open, setOpen] = useState(props.selected);
  useEffect(() => {
    if (props.selected) setOpen(true);
  }, [props.selected]);
  const aimHalf = (half: "front" | "back") => {
    const c = { ...p };
    aimProjectorAtHalf(plan, c, half, 0.15);
    onChange({ pan: c.pan, tilt: c.tilt, throwRatio: c.throwRatio });
  };
  return (
    <div className="card" style={{ borderColor: props.selected ? p.color : undefined }} onClick={props.onSelect}>
      <div className="head">
        <span className="swatch" style={{ background: p.color }} />
        <b style={{ flex: 1, cursor: "pointer" }} onClick={() => setOpen(!open)}>
          {open ? "▾" : "▸"} {p.name}
        </b>
        {props.analysis && !props.analysis.ok && <span className="bad">⚠</span>}
        <button className="small" onClick={props.onDuplicate} disabled={locked} title="Duplicate">
          ⧉
        </button>
        <button className="small" onClick={props.onRemove} disabled={locked} title="Remove">
          ✕
        </button>
      </div>
      {open && (
        <>
          <Row label="Name">
            <TextField value={p.name} onChange={(v) => onChange({ name: v })} disabled={locked} />
            <input type="color" value={p.color} onChange={(e) => onChange({ color: e.target.value })} disabled={locked} />
          </Row>
          <Row label="Target wall">
            <Select value={p.targetWall} disabled={locked} options={WALL_IDS.map((w) => ({ value: w, label: `${w} wall` }))} onChange={(v) => onChange({ targetWall: v })} />
          </Row>
          <Row label="Position x / y" hint="x across the room (+ = house right), y back from the stage edge">
            <LengthField value={p.x} units={u} onChange={(v) => onChange({ x: v })} disabled={locked} />
            <LengthField value={p.y} units={u} onChange={(v) => onChange({ y: v })} disabled={locked} />
          </Row>
          <Row label="Mount height" hint="Lens height above the floor">
            <LengthField value={p.mountHeight} units={u} onChange={(v) => onChange({ mountHeight: v })} disabled={locked} />
          </Row>
          <Row label="Pan / tilt / roll" hint="Degrees. Pan 0 = facing the stage, +90 = facing house right. Tilt + = up.">
            <NumField value={p.pan} step={0.5} suffix="°" width={64} onChange={(v) => onChange({ pan: v })} disabled={locked} />
            <NumField value={p.tilt} step={0.5} suffix="°" width={64} onChange={(v) => onChange({ tilt: v })} disabled={locked} />
            <NumField value={p.roll} step={0.5} suffix="°" width={56} onChange={(v) => onChange({ roll: v })} disabled={locked} />
          </Row>
          <Row label="Aim helpers">
            <button className="small" disabled={locked} onClick={() => aimHalf("front")}>
              Cover front half
            </button>
            <button className="small" disabled={locked} onClick={() => aimHalf("back")}>
              Cover back half
            </button>
          </Row>
          <Row label="Lumens">
            <NumField value={p.lumens} step={500} min={100} onChange={(v) => onChange({ lumens: v })} disabled={locked} />
          </Row>
          <Row label="Resolution">
            <NumField value={p.resolutionW} min={320} width={70} onChange={(v) => onChange({ resolutionW: v })} disabled={locked} />×
            <NumField value={p.resolutionH} min={200} width={70} onChange={(v) => onChange({ resolutionH: v })} disabled={locked} />
          </Row>
          <Row label="Throw ratio" hint="Throw distance ÷ image width. Min–max is the zoom range of the lens.">
            <NumField value={p.throwRatio} step={0.01} min={0.1} width={64} onChange={(v) => onChange({ throwRatio: v })} disabled={locked} />
            <span className="muted">zoom</span>
            <NumField value={p.throwRatioMin} step={0.05} min={0.1} width={56} onChange={(v) => onChange({ throwRatioMin: v })} disabled={locked} />–
            <NumField value={p.throwRatioMax} step={0.05} min={0.1} width={56} onChange={(v) => onChange({ throwRatioMax: v })} disabled={locked} />
          </Row>
          {(p.throwRatio < p.throwRatioMin - 1e-6 || p.throwRatio > p.throwRatioMax + 1e-6) && (
            <div className="warn">Throw ratio is outside this lens's zoom range.</div>
          )}
          <Row label="Fit zoom to width">
            {[0.4, 0.5, 0.6].map((k) => (
              <button
                key={k}
                className="small"
                disabled={locked}
                onClick={() => {
                  const len = (props.analysis?.ok ? 1 : 1) * wallLength(plan, p.targetWall);
                  onChange({ throwRatio: round(fitZoom(p, plan.room, len * k), 3) });
                }}
              >
                {Math.round(k * 100)}% of wall
              </button>
            ))}
          </Row>
          <Row label="Lens shift V / H" hint="% of image height / width. +V moves the image up.">
            <NumField value={p.lensShiftV} step={1} suffix="%" width={60} onChange={(v) => onChange({ lensShiftV: v })} disabled={locked} />
            <NumField value={p.lensShiftH} step={1} suffix="%" width={60} onChange={(v) => onChange({ lensShiftH: v })} disabled={locked} />
          </Row>
        </>
      )}
    </div>
  );
}

function wallLength(plan: Plan, w: WallId): number {
  const l = wallLine(plan.room, w);
  return Math.hypot(l.end.x - l.start.x, l.end.y - l.start.y);
}
