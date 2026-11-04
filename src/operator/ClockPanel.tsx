// Master clock panel shown in the operator window.
//
// Shows the show timecode that every wall computer follows, Play / Pause / Reset,
// and each wall computer's sync state, so the operator can see at a glance that
// both sides of the auditorium are locked before the house opens.
//
// Props:
//  - status: the latest {type:"clockStatus"} from main (clock.status()), about every 250 ms.
//  - now: local time, kept for compatibility; the panel animates on its own.
//  - onCommand: sends play / pause / reset / seek to clock.command() in main.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  formatTimecode,
  type ClockCommand,
  type ClockNodeStatus,
  type ClockStatus,
  type SyncState,
  type WallSyncSummary,
} from "../shared/clock";

const STATE_LABEL: Record<SyncState, string> = { locked: "Locked", syncing: "Syncing", lost: "Lost" };
const STATE_COLOR: Record<SyncState, string> = { locked: "#2fbf71", syncing: "#e0a526", lost: "#e5484d" };

/** Shows the show time, moving smoothly between status updates. */
function useLiveShowTime(status: ClockStatus | null): number {
  const received = useRef({ at: performance.now(), status });
  const [, setTick] = useState(0);
  if (received.current.status !== status) received.current = { at: performance.now(), status };

  const running = !!status?.show?.running;
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const loop = () => {
      setTick((t) => t + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  const base = status?.showTimeMs ?? 0;
  return running ? base + (performance.now() - received.current.at) : base;
}

function fmtMs(ms: number | undefined, digits = 1): string {
  return ms === undefined || !Number.isFinite(ms) ? "-" : `${ms.toFixed(digits)} ms`;
}

function Pill({ state, children }: { state: SyncState; children?: ReactNode }) {
  return (
    <span style={{ ...s.pill, color: STATE_COLOR[state], borderColor: STATE_COLOR[state] }}>
      <span style={{ ...s.dot, background: STATE_COLOR[state] }} />
      {children ?? STATE_LABEL[state]}
    </span>
  );
}

const WALLS_PILL: Record<WallSyncSummary["state"], { state: SyncState; text: string }> = {
  idle: { state: "syncing", text: "Nothing on the walls" },
  "in-step": { state: "locked", text: "Walls in step" },
  drifting: { state: "syncing", text: "Walls drifting" },
  "out-of-step": { state: "lost", text: "Walls out of step" },
};

/** Are both walls showing the same thing at the same moment? */
function WallsInStep({ walls }: { walls: WallSyncSummary }) {
  const pill = WALLS_PILL[walls.state];
  return (
    <div style={s.walls}>
      <div style={s.wallsRow}>
        <Pill state={pill.state}>{pill.text}</Pill>
        {walls.compared > 0 && (
          <span style={s.muted}>
            {walls.worstMs < 1 ? "under 1 ms apart" : `${Math.round(walls.worstMs)} ms apart`}
          </span>
        )}
      </div>
      {walls.issues.slice(0, 3).map((i) => (
        <div key={i.key + i.text} style={{ ...s.issue, color: STATE_COLOR[WALLS_PILL[i.state].state] }}>
          Cue {i.cue}: {i.text}
        </div>
      ))}
    </div>
  );
}

function summary(nodes: ClockNodeStatus[]): { state: SyncState; text: string } {
  if (!nodes.length) return { state: "syncing", text: "No wall computers connected" };
  const lost = nodes.filter((n) => n.state === "lost");
  const syncing = nodes.filter((n) => n.state === "syncing");
  if (lost.length) return { state: "lost", text: `${lost.map((n) => n.name).join(", ")} not responding` };
  if (syncing.length) return { state: "syncing", text: `${syncing.map((n) => n.name).join(", ")} still syncing` };
  return { state: "locked", text: `${nodes.length === 1 ? "Wall clock" : `All ${nodes.length} wall clocks`} locked` };
}

export function ClockPanel(props: {
  status: ClockStatus | null;
  now: number;
  onCommand?: (cmd: ClockCommand) => void;
}) {
  const { status, onCommand } = props;
  const showMs = useLiveShowTime(status);
  const show = status?.show;
  const nodes = status?.nodes ?? [];
  const isMaster = status?.role !== "follower";
  const sum = isMaster ? summary(nodes) : null;
  const runState = !show ? "No clock" : show.running ? "Running" : showMs === 0 ? "Stopped" : "Paused";

  const reset = () => {
    if (!show?.running || window.confirm("Reset the show clock to 00:00:00:00 on every computer?")) {
      onCommand?.({ type: "reset" });
    }
  };

  return (
    <section style={s.panel} className="clock-panel" aria-label="Master clock">
      <div style={s.header}>
        <span style={s.title}>Master clock</span>
        {status && !isMaster && <Pill state={status.state ?? (status.synced ? "locked" : "syncing")} />}
        {sum && <Pill state={sum.state}>{sum.text}</Pill>}
      </div>

      <div style={s.clockRow}>
        <span className="clock-time" style={s.timecode}>
          {formatTimecode(showMs)}
        </span>
        <span style={{ ...s.runState, color: show?.running ? "#2fbf71" : "#9aa3b2" }}>{runState}</span>
      </div>

      {isMaster && onCommand && (
        <div style={s.buttons}>
          {show?.running ? (
            <button style={s.button} onClick={() => onCommand({ type: "pause" })}>
              Pause
            </button>
          ) : (
            <button style={{ ...s.button, ...s.primary }} onClick={() => onCommand({ type: "play" })}>
              {showMs > 0 ? "Resume" : "Play"}
            </button>
          )}
          <button style={s.button} onClick={reset}>
            Reset
          </button>
        </div>
      )}

      {isMaster && status?.walls && <WallsInStep walls={status.walls} />}

      {isMaster ? (
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Computer</th>
              <th style={s.th}>Sync</th>
              <th style={s.th} title="Estimated worst-case timing difference from the master clock">
                Accuracy
              </th>
              <th style={s.th} title="Network round trip">
                Network
              </th>
            </tr>
          </thead>
          <tbody>
            {nodes.length === 0 && (
              <tr>
                <td style={{ ...s.td, color: "#9aa3b2" }} colSpan={4}>
                  Waiting for wall computers to connect…
                </td>
              </tr>
            )}
            {nodes.map((n) => (
              <tr key={n.peerId}>
                <td style={s.td}>{n.name}</td>
                <td style={s.td}>
                  <Pill state={n.state} />
                </td>
                <td style={s.td}>{n.state === "lost" ? "-" : `± ${fmtMs(n.errorMs)}`}</td>
                <td style={s.td}>{n.state === "lost" ? "-" : fmtMs(n.rttMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        status && (
          <div style={s.followerInfo}>
            Accuracy ± {fmtMs(status.errorMs)} · Network {fmtMs(status.rttMs)}
          </div>
        )
      )}
    </section>
  );
}

const s: Record<string, CSSProperties> = {
  panel: {
    background: "#151922",
    color: "#e8ebf1",
    border: "1px solid #262c38",
    borderRadius: 10,
    padding: 16,
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
    minWidth: 320,
  },
  header: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 },
  title: { fontSize: 13, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", color: "#9aa3b2", marginRight: "auto" },
  clockRow: { display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" },
  timecode: { fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace", fontSize: 48, fontWeight: 600, fontVariantNumeric: "tabular-nums", letterSpacing: 1 },
  runState: { fontSize: 14, fontWeight: 600, textTransform: "uppercase" },
  buttons: { display: "flex", gap: 8, margin: "12px 0" },
  button: { background: "#232a37", color: "#e8ebf1", border: "1px solid #343c4c", borderRadius: 6, padding: "8px 18px", fontSize: 15, cursor: "pointer" },
  primary: { background: "#1f7a4a", borderColor: "#2fbf71" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14, marginTop: 4 },
  th: { textAlign: "left", fontWeight: 500, color: "#9aa3b2", borderBottom: "1px solid #262c38", padding: "6px 8px 6px 0" },
  td: { padding: "6px 8px 6px 0", borderBottom: "1px solid #1e2430", fontVariantNumeric: "tabular-nums" },
  pill: { display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid", borderRadius: 999, padding: "1px 9px", fontSize: 12, fontWeight: 600 },
  dot: { width: 7, height: 7, borderRadius: "50%" },
  walls: { margin: "4px 0 10px", display: "flex", flexDirection: "column", gap: 4 },
  wallsRow: { display: "flex", alignItems: "center", gap: 10 },
  muted: { fontSize: 13, color: "#9aa3b2" },
  issue: { fontSize: 13, paddingLeft: 2 },
  followerInfo: { fontSize: 13, color: "#9aa3b2", marginTop: 6 },
};
