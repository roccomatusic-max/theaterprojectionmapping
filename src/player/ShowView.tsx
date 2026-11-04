import { useEffect, useState } from "react";
import type { Cue, Fit, MediaType, PlaybackState, PlayMode, Show, WallId } from "../shared/types";
import { WALL_IDS } from "../shared/types";
import { uid } from "../shared/defaults";
import type { ClockStatus } from "../shared/clock";
import { ClockPanel } from "../operator/ClockPanel";
import { api } from "../ui/api";
import { Check, NumField, Row, Select, TextField, typingInField } from "../ui/fields";
import { outputStatus, UiStatus } from "./types";

export function ShowView(props: {
  show: Show;
  setShow: (s: Show) => void;
  state: PlaybackState;
  status: UiStatus;
  thumbs: Record<string, string>;
  clock: ClockStatus | null;
  locked: boolean;
}) {
  const { show, setShow, state, status, locked } = props;
  const [selId, setSelId] = useState<string | null>(show.cues[0]?.id ?? null);
  const found = show.cues.findIndex((c) => c.id === selId);
  const selIndex = found >= 0 ? found : show.cues.length ? 0 : -1;
  const sel = show.cues[selIndex];

  // Hotkeys: Space = GO, Backspace = Back, Esc = Panic (blackout).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typingInField()) return;
      if (e.key === "Escape") {
        e.preventDefault();
        api.panic();
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) api.go();
      } else if (e.key === "Backspace") {
        e.preventDefault();
        api.back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const upCue = (id: string, patch: Partial<Cue>) => setShow({ ...show, cues: show.cues.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= show.cues.length) return;
    const cues = [...show.cues];
    [cues[i], cues[j]] = [cues[j], cues[i]];
    setShow({ ...show, cues });
  };
  const addCue = () => {
    const last = show.cues[show.cues.length - 1];
    const n = last ? String((parseFloat(last.number) || show.cues.length) + 1) : "1";
    const c: Cue = {
      id: uid("cue"),
      number: n,
      name: "New cue",
      walls: ["left", "right"],
      media: { type: "color", color: "#202040" },
      playMode: "hold",
      fit: "cover",
      fadeIn: 2,
      fadeOut: 2,
      autoFollow: false,
      followDelay: 0,
    };
    const cues = [...show.cues];
    cues.splice(selIndex >= 0 ? selIndex + 1 : cues.length, 0, c);
    setShow({ ...show, cues });
    setSelId(c.id);
  };

  const standby = show.cues[state.standbyIndex];
  const live = show.cues[state.currentIndex];

  // Problems the operator must see.
  const alerts: { bad: boolean; text: string }[] = [];
  if (state.blackout) alerts.push({ bad: true, text: "BLACKOUT is on. Press GO to continue the show." });
  for (const f of status.local.missingMedia) alerts.push({ bad: true, text: `Missing on this computer: ${f}` });
  for (const n of status.nodes) {
    if (!n.connected) alerts.push({ bad: true, text: `${n.name} is not connected${n.error ? ` (${n.error})` : ""}. Its projectors keep their last look.` });
    for (const f of n.missingMedia) alerts.push({ bad: true, text: `Missing on ${n.name}: ${f}` });
  }
  for (const o of show.outputs) {
    const st = outputStatus(status, o.id, o.node);
    if (o.displayId !== null && st && !st.open) alerts.push({ bad: false, text: `${o.name} has a display assigned but its window is not open.` });
    if (st?.open && st.missingMedia.length) alerts.push({ bad: true, text: `${o.name} cannot load: ${st.missingMedia.join(", ")} (showing black)` });
  }
  const anyTest = Object.values(state.testPatterns).some(Boolean);
  if (anyTest) alerts.push({ bad: false, text: "A test pattern is showing on at least one output." });

  return (
    <div className="main">
      <div className="content" style={{ flex: 1.4 }}>
        <div className="hstack">
          <b>Cue list</b>
          <span className="grow" />
          <button className="small" disabled={locked} onClick={addCue}>
            + Add cue
          </button>
          <button
            className="small"
            disabled={locked || !sel}
            onClick={() => {
              if (!sel) return;
              const c = { ...sel, id: uid("cue"), number: `${sel.number}.5`, name: `${sel.name} copy` };
              const cues = [...show.cues];
              cues.splice(selIndex + 1, 0, c);
              setShow({ ...show, cues });
              setSelId(c.id);
            }}
          >
            Duplicate
          </button>
          <button className="small" disabled={locked || selIndex <= 0} onClick={() => move(selIndex, -1)}>
            ↑
          </button>
          <button className="small" disabled={locked || selIndex < 0 || selIndex >= show.cues.length - 1} onClick={() => move(selIndex, 1)}>
            ↓
          </button>
          <button
            className="small"
            disabled={locked || !sel}
            onClick={() => sel && confirm(`Delete cue ${sel.number} “${sel.name}”?`) && setShow({ ...show, cues: show.cues.filter((c) => c.id !== sel.id) })}
          >
            Delete
          </button>
        </div>
        <div className="panel" style={{ padding: 0, maxHeight: "48vh", overflow: "auto" }}>
          <table className="grid">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Walls</th>
                <th>Media</th>
                <th>Mode</th>
                <th>Fade in / out</th>
                <th>Follow</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {show.cues.map((c, i) => (
                <tr
                  key={c.id}
                  className={[i === selIndex ? "sel" : "", i === state.standbyIndex ? "standby" : "", i === state.currentIndex ? "live" : ""].join(" ")}
                  onClick={() => setSelId(c.id)}
                  onDoubleClick={() => api.standby(i)}
                >
                  <td>{c.number}</td>
                  <td>
                    {c.name}
                    {i === state.standbyIndex && <span className="pill warn" style={{ marginLeft: 6 }}>next</span>}
                    {i === state.currentIndex && <span className="pill ok" style={{ marginLeft: 6 }}>live</span>}
                  </td>
                  <td>{c.walls.join(" + ")}</td>
                  <td>{mediaLabel(c, status)}</td>
                  <td>{c.media.type === "video" ? c.playMode : "—"}</td>
                  <td>
                    {c.fadeIn}s / {c.fadeOut}s
                  </td>
                  <td>{c.autoFollow ? `auto +${c.followDelay}s` : ""}</td>
                  <td>
                    <button className="small" title="Fire this cue now" onClick={(e) => (e.stopPropagation(), api.fire(i))}>
                      ▶
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sel && <CueEditor cue={sel} upCue={(p) => upCue(sel.id, p)} locked={locked} />}
      </div>

      <div className="content" style={{ flex: 1, minWidth: 560, borderLeft: "1px solid var(--line)" }}>
        <ClockPanel status={props.clock} now={Date.now()} onCommand={(c) => api.clockCommand(c)} />
        <div className="panel">
          <div className="muted">Next (standby)</div>
          <div style={{ fontSize: 18, fontWeight: 700, minHeight: 26 }}>{standby ? `${standby.number} · ${standby.name}` : "End of cue list"}</div>
          <div className="muted" style={{ marginTop: 4 }}>
            Live: {live ? `${live.number} · ${live.name}` : "nothing yet"}
          </div>
        </div>
        <button className="go" disabled={!standby} onClick={() => api.go()}>
          GO <span style={{ fontSize: 14, fontWeight: 400 }}>(Space)</span>
        </button>
        <div className="hstack" style={{ flexWrap: "nowrap" }}>
          <button style={{ flex: 1, padding: 10 }} onClick={() => api.back()}>
            ◀ Back <span className="kbd">Backspace</span>
          </button>
          <button style={{ flex: 1, padding: 10 }} onClick={() => api.fadeAll(3)}>
            Fade all out (3 s)
          </button>
        </div>
        <button className="panic" onClick={() => api.panic()}>
          PANIC / BLACKOUT <span style={{ fontSize: 12, fontWeight: 400 }}>(Esc)</span>
        </button>
        {alerts.length > 0 && (
          <div className="alerts">
            {alerts.map((a, i) => (
              <div key={i} className={a.bad ? "alert bad" : "alert"}>
                {a.text}
              </div>
            ))}
          </div>
        )}
        <div className="previews">
          {show.outputs.map((o) => {
            const st = outputStatus(status, o.id, o.node);
            const node = o.node === "local" ? "booth" : show.nodes.find((n) => n.id === o.node)?.name ?? "?";
            return (
              <div key={o.id} className="preview">
                {props.thumbs[o.id] ? <img src={props.thumbs[o.id]} /> : <div className="blank" />}
                <div className="cap">
                  <span className="swatch" style={{ background: o.color }} />
                  <b>{o.name}</b>
                  <span className="muted">{node}</span>
                  {st?.open ? (
                    <span className={st.fps >= 50 ? "ok" : st.fps >= 24 ? "warn" : "bad"}>
                      {st.fps} fps · {st.droppedFrames} dropped{st.driftMs > 0 ? ` · video ±${st.driftMs} ms` : ""}
                    </span>
                  ) : (
                    <span className="bad">{o.displayId === null ? "no display" : "not open"}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function mediaLabel(c: Cue, status: UiStatus): JSX.Element {
  const m = c.media;
  if (m.type === "black") return <span className="muted">black (fade out)</span>;
  if (m.type === "color")
    return (
      <span>
        <span className="swatch" style={{ background: m.color }} /> colour
      </span>
    );
  const missing = m.file && status.local.missingMedia.includes(m.file);
  return <span className={missing ? "bad" : ""}>{missing ? "⚠ " : ""}{m.file || "(no file)"}</span>;
}

function CueEditor({ cue, upCue, locked }: { cue: Cue; upCue: (p: Partial<Cue>) => void; locked: boolean }) {
  const toggleWall = (w: WallId, on: boolean) => {
    const walls = on ? [...new Set([...cue.walls, w])] : cue.walls.filter((x) => x !== w);
    upCue({ walls: WALL_IDS.filter((x) => walls.includes(x)) });
  };
  return (
    <div className="panel vstack">
      <h3 style={{ margin: 0 }}>
        Cue {cue.number}: {cue.name}
      </h3>
      <Row label="Number / name">
        <TextField value={cue.number} width={60} disabled={locked} onChange={(v) => upCue({ number: v })} />
        <TextField value={cue.name} width={280} disabled={locked} onChange={(v) => upCue({ name: v })} />
      </Row>
      <Row label="Walls">
        {WALL_IDS.map((w) => (
          <Check key={w} label={`${w} wall`} checked={cue.walls.includes(w)} disabled={locked} onChange={(v) => toggleWall(w, v)} />
        ))}
      </Row>
      <Row label="Media">
        <Select<MediaType>
          value={cue.media.type}
          disabled={locked}
          options={[
            { value: "image", label: "Still image" },
            { value: "video", label: "Video" },
            { value: "color", label: "Solid colour" },
            { value: "black", label: "Black (fade out)" },
          ]}
          onChange={(t) => upCue({ media: { ...cue.media, type: t, color: cue.media.color ?? "#202040" } })}
        />
        {(cue.media.type === "video" || cue.media.type === "image") && (
          <>
            <span>{cue.media.file || <span className="muted">no file chosen</span>}</span>
            <button
              className="small"
              disabled={locked}
              onClick={async () => {
                const m = await api.pickMedia();
                if (m) upCue({ media: m });
              }}
            >
              Choose file…
            </button>
          </>
        )}
        {cue.media.type === "color" && (
          <input type="color" value={cue.media.color ?? "#000000"} disabled={locked} onChange={(e) => upCue({ media: { ...cue.media, color: e.target.value } })} />
        )}
      </Row>
      {cue.media.type === "video" && (
        <Row label="When the video ends">
          <Select<PlayMode>
            value={cue.playMode}
            disabled={locked}
            options={[
              { value: "loop", label: "Loop" },
              { value: "hold", label: "Hold last frame" },
              { value: "once", label: "Play once, then black" },
            ]}
            onChange={(v) => upCue({ playMode: v })}
          />
        </Row>
      )}
      {(cue.media.type === "video" || cue.media.type === "image") && (
        <Row label="Fit to wall">
          <Select<Fit>
            value={cue.fit}
            disabled={locked}
            options={[
              { value: "cover", label: "Fill the wall (crop edges)" },
              { value: "contain", label: "Fit inside the wall (black bars)" },
              { value: "stretch", label: "Stretch to the wall" },
            ]}
            onChange={(v) => upCue({ fit: v })}
          />
        </Row>
      )}
      <Row label="Fade in / out" hint="Fade in: this cue's look. Fade out: the look it replaces on the same walls.">
        <NumField value={cue.fadeIn} step={0.5} min={0} suffix="s in" width={60} disabled={locked} onChange={(v) => upCue({ fadeIn: v })} />
        <NumField value={cue.fadeOut} step={0.5} min={0} suffix="s out" width={60} disabled={locked} onChange={(v) => upCue({ fadeOut: v })} />
      </Row>
      <Row label="Auto-follow">
        <Check label="Fire the next cue automatically" checked={cue.autoFollow} disabled={locked} onChange={(v) => upCue({ autoFollow: v })} />
        {cue.autoFollow && <NumField value={cue.followDelay} step={0.5} min={0} suffix="s after this one" width={60} disabled={locked} onChange={(v) => upCue({ followDelay: v })} />}
      </Row>
      <Row label="Notes">
        <TextField value={cue.notes ?? ""} width={360} disabled={locked} onChange={(v) => upCue({ notes: v })} />
      </Row>
    </div>
  );
}
