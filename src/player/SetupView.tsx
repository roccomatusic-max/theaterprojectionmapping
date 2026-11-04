import { useEffect, useState } from "react";
import type { OutputConfig, Show, TestPattern } from "../shared/types";
import { WALL_IDS } from "../shared/types";
import { defaultOutput, PROJECTOR_COLORS, uid } from "../shared/defaults";
import { api, AppSettings } from "../ui/api";
import { Check, NumField, Section, Select, TextField } from "../ui/fields";
import { outputStatus, UiStatus } from "./types";

export const TEST_PATTERNS: { value: TestPattern; label: string }[] = [
  { value: "grid", label: "Grid" },
  { value: "crosshatch", label: "Crosshatch" },
  { value: "bars", label: "Colour bars" },
  { value: "white", label: "White" },
  { value: "black", label: "Black" },
  { value: "label", label: "Name" },
];

const WINDOWED = -1;

export function SetupView(props: {
  show: Show;
  setShow: (s: Show) => void;
  showPath: string;
  status: UiStatus;
  testPatterns: Record<string, TestPattern | null>;
  locked: boolean;
  onImportPlan: () => void;
  reloadShow: () => void;
}) {
  const { show, setShow, status, locked } = props;
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [backups, setBackups] = useState<{ name: string; time: number }[]>([]);
  useEffect(() => {
    api.settings().then(setSettings);
  }, []);

  const upOut = (id: string, patch: Partial<OutputConfig>) => setShow({ ...show, outputs: show.outputs.map((o) => (o.id === id ? { ...o, ...patch } : o)) });
  const machines = [{ value: "local", label: "This computer (booth)" }, ...show.nodes.map((n) => ({ value: n.id, label: n.name || n.host }))];

  const displayOptions = (o: OutputConfig) => {
    const displays = o.node === "local" ? status.local.displays : status.nodes.find((n) => n.id === o.node)?.displays ?? [];
    const opts: { value: number | "none"; label: string }[] = [{ value: "none", label: "Not assigned (off)" }];
    for (const d of displays) {
      const takenBy = show.outputs.find((x) => x.id !== o.id && x.node === o.node && x.displayId === d.id);
      opts.push({ value: d.id, label: `${d.label}${takenBy ? ` — also used by ${takenBy.name}` : ""}` });
    }
    opts.push({ value: WINDOWED, label: "Window on the main screen (testing)" });
    if (o.displayId !== null && o.displayId !== WINDOWED && !displays.some((d) => d.id === o.displayId))
      opts.push({ value: o.displayId, label: "⚠ Display not found (unplugged?)" });
    return opts;
  };

  const allIds = show.outputs.map((o) => o.id);

  return (
    <div className="main">
      <aside className="sidebar">
        <Section title="Show file">
          <div className="muted" style={{ fontSize: 12, wordBreak: "break-all" }}>
            {props.showPath}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Saved automatically after every change. The last 10 versions are kept.
          </div>
          <div className="hstack">
            <button disabled={locked} onClick={async () => (await api.openShow()) && props.reloadShow()}>
              Open…
            </button>
            <button onClick={async () => (await api.saveShowAs()) && props.reloadShow()}>Save as…</button>
            <button
              disabled={locked}
              onClick={async () => {
                if (confirm("Start a new, empty show? The current one stays in its backups.")) {
                  await api.newShow();
                  props.reloadShow();
                }
              }}
            >
              New
            </button>
            <button onClick={async () => setBackups(await api.backups())}>Backups…</button>
          </div>
          {backups.length > 0 && (
            <div className="card">
              {backups.map((b) => (
                <div key={b.name} className="hstack">
                  <span className="grow">{new Date(b.time).toLocaleString()}</span>
                  <button
                    className="small"
                    disabled={locked}
                    onClick={async () => {
                      if (confirm(`Go back to the version from ${new Date(b.time).toLocaleString()}?`)) {
                        await api.restoreBackup(b.name);
                        props.reloadShow();
                        setBackups([]);
                      }
                    }}
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Media folder">
          <div className="muted" style={{ fontSize: 12, wordBreak: "break-all" }}>
            {settings?.mediaFolder}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Videos and images you pick for cues are copied here. Copy this whole folder to the same place on each side-wall computer before the show.
          </div>
          <div className="hstack">
            <button
              disabled={locked}
              onClick={async () => {
                await api.chooseMediaFolder();
                setSettings(await api.settings());
              }}
            >
              Change…
            </button>
            <button onClick={() => api.openMediaFolder()}>Open folder</button>
          </div>
          {status.local.missingMedia.length > 0 && <div className="bad">Missing here: {status.local.missingMedia.join(", ")}</div>}
        </Section>

        <Section
          title="Side-wall computers"
          right={
            <button
              className="small"
              disabled={locked}
              onClick={() => setShow({ ...show, nodes: [...show.nodes, { id: uid("node"), name: `Side ${show.nodes.length + 1}`, host: "", port: 47800 }] })}
            >
              + Add
            </button>
          }
        >
          <div className="muted" style={{ fontSize: 12 }}>
            On each side computer, start the app and choose “Make this a side-wall computer” at the bottom of this panel. It shows its IP address; type that here.
            This computer's addresses: {status.local.addresses.join(", ") || "none found"}
          </div>
          {show.nodes.map((n) => {
            const st = status.nodes.find((x) => x.id === n.id);
            return (
              <div key={n.id} className="card">
                <div className="head">
                  <span className={st?.connected ? "pill ok" : "pill bad"}>{st?.connected ? "connected" : "not connected"}</span>
                  <TextField value={n.name} width={120} disabled={locked} onChange={(v) => setShow({ ...show, nodes: show.nodes.map((x) => (x.id === n.id ? { ...x, name: v } : x)) })} />
                  <span className="grow" />
                  <button
                    className="small"
                    disabled={locked}
                    onClick={() =>
                      confirm(`Remove ${n.name}? Its outputs move back to this computer.`) &&
                      setShow({
                        ...show,
                        nodes: show.nodes.filter((x) => x.id !== n.id),
                        outputs: show.outputs.map((o) => (o.node === n.id ? { ...o, node: "local", displayId: null } : o)),
                      })
                    }
                  >
                    ✕
                  </button>
                </div>
                <div className="hstack">
                  <span className="muted">IP address</span>
                  <TextField value={n.host} width={130} placeholder="192.168.1.21" disabled={locked} onChange={(v) => setShow({ ...show, nodes: show.nodes.map((x) => (x.id === n.id ? { ...x, host: v } : x)) })} />
                  <span className="muted">port</span>
                  <NumField value={n.port} width={70} min={1} max={65535} disabled={locked} onChange={(v) => setShow({ ...show, nodes: show.nodes.map((x) => (x.id === n.id ? { ...x, port: v } : x)) })} />
                </div>
                {st && !st.connected && st.error && <div className="bad" style={{ fontSize: 12 }}>{st.error}</div>}
                {st && st.missingMedia.length > 0 && <div className="bad" style={{ fontSize: 12 }}>Missing media: {st.missingMedia.join(", ")}</div>}
                {st?.connected && <div className="muted" style={{ fontSize: 12 }}>{st.displays.length} display(s) found</div>}
              </div>
            );
          })}
        </Section>

        <Section title="OSC remote control" open={false}>
          <Check label="Listen for OSC (/go, /back, /blackout, /cue/5)" checked={show.osc.enabled} disabled={locked} onChange={(v) => setShow({ ...show, osc: { ...show.osc, enabled: v } })} />
          <div className="hstack">
            <span className="muted">UDP port</span>
            <NumField value={show.osc.port} min={1} max={65535} disabled={locked} onChange={(v) => setShow({ ...show, osc: { ...show.osc, port: v } })} />
            <span className={status.osc.listening ? "pill ok" : "pill"}>{status.osc.listening ? "listening" : "off"}</span>
          </div>
          {status.osc.error && <div className="bad">{status.osc.error}</div>}
          {status.osc.last && <div className="muted">Last message: {status.osc.last}</div>}
        </Section>

        <Section title="This computer's role" open={false}>
          <div className="muted" style={{ fontSize: 12 }}>
            This is the booth (operator) computer: it runs the Planner, the cue list and the master clock. Side-wall computers only show their projectors.
          </div>
          <button
            disabled={locked}
            onClick={() => confirm("Restart this computer's app as a side-wall computer? The booth needs to run on another computer.") && api.switchRole("node")}
          >
            Make this a side-wall computer
          </button>
        </Section>
      </aside>

      <div className="content">
        <div className="hstack">
          <button className="primary" disabled={locked} onClick={props.onImportPlan}>
            Import projectors from the Planner
          </button>
          <button
            disabled={locked}
            onClick={() =>
              setShow({
                ...show,
                outputs: [
                  ...show.outputs,
                  defaultOutput({
                    name: `Output ${show.outputs.length + 1}`,
                    color: PROJECTOR_COLORS[show.outputs.length % PROJECTOR_COLORS.length],
                    slice: { x0: 0, y0: 0, x1: show.walls.left.width / 2, y1: show.walls.left.height },
                  }),
                ],
              })
            }
          >
            + Add output by hand
          </button>
          <span className="grow" />
          <span className="muted">All outputs:</span>
          {TEST_PATTERNS.map((p) => (
            <button key={p.value} className="small" disabled={locked} onClick={() => api.testPattern(allIds, p.value)}>
              {p.label}
            </button>
          ))}
          <button className="small" onClick={() => api.testPattern(allIds, null)}>
            Show content
          </button>
        </div>

        <div className="panel">
          <h3>Outputs (one per projector)</h3>
          {show.outputs.length === 0 && <div className="muted">No outputs yet. Use “Import projectors from the Planner” or add one by hand.</div>}
          <table className="grid">
            <thead>
              <tr>
                <th>Name</th>
                <th>Wall</th>
                <th>Computer</th>
                <th>Display (projector)</th>
                <th>Resolution</th>
                <th>Status</th>
                <th>Test pattern</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {show.outputs.map((o) => {
                const st = outputStatus(status, o.id, o.node);
                const tp = props.testPatterns[o.id] ?? null;
                return (
                  <tr key={o.id}>
                    <td>
                      <span className="swatch" style={{ background: o.color }} /> <TextField value={o.name} width={190} disabled={locked} onChange={(v) => upOut(o.id, { name: v })} />
                    </td>
                    <td>
                      <Select value={o.wall} disabled={locked} options={WALL_IDS.map((w) => ({ value: w, label: w }))} onChange={(v) => upOut(o.id, { wall: v })} />
                    </td>
                    <td>
                      <Select value={o.node} disabled={locked} options={machines} onChange={(v) => upOut(o.id, { node: v, displayId: null })} />
                    </td>
                    <td>
                      <Select<number | "none">
                        value={o.displayId ?? "none"}
                        disabled={locked}
                        options={displayOptions(o)}
                        onChange={(v) => upOut(o.id, { displayId: v === "none" ? null : v })}
                      />
                    </td>
                    <td>
                      <NumField value={o.width} width={64} min={64} disabled={locked} onChange={(v) => upOut(o.id, { width: v })} />×
                      <NumField value={o.height} width={64} min={64} disabled={locked} onChange={(v) => upOut(o.id, { height: v })} />
                    </td>
                    <td>
                      {o.displayId === null ? (
                        <span className="muted">off</span>
                      ) : st?.open ? (
                        <span className={st.fps >= 50 ? "ok" : st.fps >= 24 ? "warn" : "bad"}>
                          {st.fps} fps · {st.droppedFrames} dropped
                          {st.missingMedia.length > 0 && <span className="bad"> · missing media</span>}
                        </span>
                      ) : (
                        <span className="bad">not open</span>
                      )}
                    </td>
                    <td>
                      <Select<TestPattern | "none">
                        value={tp ?? "none"}
                        disabled={locked && !tp}
                        options={[{ value: "none", label: "Off (content)" }, ...TEST_PATTERNS]}
                        onChange={(v) => api.testPattern([o.id], v === "none" ? null : v)}
                      />
                    </td>
                    <td>
                      <button
                        className="small"
                        disabled={locked}
                        onClick={() => confirm(`Remove output ${o.name}?`) && setShow({ ...show, outputs: show.outputs.filter((x) => x.id !== o.id) })}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h3>Wall canvases</h3>
          <div className="muted" style={{ marginBottom: 6 }}>
            Each wall is one big image. Make content at this shape (for example {Math.round(show.walls.left.width * 40)} × {Math.round(show.walls.left.height * 40)} pixels for the left
            wall) and every projector on that wall shows its own part of it, lined up across the blend.
          </div>
          {WALL_IDS.map((w) => (
            <div key={w} className="hstack">
              <b style={{ width: 80 }}>{w} wall</b>
              <span className="muted">width</span>
              <NumField value={show.walls[w].width} step={0.5} min={1} suffix="ft" disabled={locked} onChange={(v) => setShow({ ...show, walls: { ...show.walls, [w]: { ...show.walls[w], width: v } } })} />
              <span className="muted">height</span>
              <NumField value={show.walls[w].height} step={0.5} min={1} suffix="ft" disabled={locked} onChange={(v) => setShow({ ...show, walls: { ...show.walls, [w]: { ...show.walls[w], height: v } } })} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
