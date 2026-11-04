// Side-wall computer (render node) status window.
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../ui/styles.css";
import type { DisplayInfo, OutputConfig, OutputStatus } from "../shared/types";
import type { ClockStatus } from "../shared/clock";
import { api, AppSettings } from "../ui/api";
import { NumField, Row, TextField } from "../ui/fields";

interface NodeInfo {
  connected: boolean;
  operatorAddress: string;
  nodeId: string | null;
  port: number;
  serverError: string;
  addresses: string[];
  clock: ClockStatus;
  outputs: OutputConfig[];
  outputStatus: OutputStatus[];
  missingMedia: string[];
  displays: DisplayInfo[];
}

function NodeApp() {
  const [info, setInfo] = useState<NodeInfo | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
    api.settings().then(setSettings);
    return api.on("node:status", setInfo);
  }, []);
  const save = async (p: Partial<AppSettings>) => {
    await api.setSettings(p);
    setSettings(await api.settings());
  };
  const clockState = info?.clock.state ?? (info?.clock.synced ? "locked" : "syncing");
  return (
    <div className="content" style={{ height: "100%" }}>
      <h2 style={{ margin: 0 }}>Side-wall computer</h2>
      <div className="panel vstack">
        <div style={{ fontSize: 16 }}>
          Type this address into the booth computer (Player: Setup → Side-wall computers):
          <div style={{ fontSize: 26, fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{info?.addresses.join("  or  ") || "…"}</div>
          <span className="muted">port {info?.port ?? settings?.nodePort}</span>
        </div>
        {info?.serverError && <div className="alert bad">Network problem: {info.serverError}</div>}
        <div className="hstack">
          <span className={info?.connected ? "pill ok" : "pill bad"}>{info?.connected ? `Booth connected (${info.operatorAddress})` : "Waiting for the booth computer"}</span>
          <span className={clockState === "locked" ? "pill ok" : clockState === "lost" ? "pill bad" : "pill warn"}>
            Clock {clockState}
            {info?.clock.errorMs !== undefined ? ` · ±${info.clock.errorMs.toFixed(1)} ms` : ""}
          </span>
        </div>
      </div>
      <div className="panel vstack">
        <h3>Projectors on this computer</h3>
        {!info?.outputs.length && <div className="muted">None assigned yet. Assign outputs to this computer on the booth computer.</div>}
        {info?.outputs.map((o) => {
          const st = info.outputStatus.find((s) => s.outputId === o.id);
          const d = info.displays.find((x) => x.id === o.displayId);
          return (
            <div key={o.id} className="hstack">
              <span className="swatch" style={{ background: o.color }} />
              <b>{o.name}</b>
              <span className="muted">{o.displayId === -1 ? "test window" : d ? d.label : o.displayId === null ? "no display chosen" : "display not found"}</span>
              <span className={st?.open ? "ok" : "bad"}>{st?.open ? `${st.fps} fps · ${st.droppedFrames} dropped` : "not open"}</span>
            </div>
          );
        })}
        {!!info?.missingMedia.length && <div className="alert bad">Missing media on this computer: {info.missingMedia.join(", ")}</div>}
      </div>
      <div className="panel vstack">
        <h3>Settings</h3>
        <Row label="Name">
          <TextField value={settings?.nodeName ?? ""} onChange={(v) => save({ nodeName: v })} />
        </Row>
        <Row label="Media folder">
          <span style={{ wordBreak: "break-all" }}>{settings?.mediaFolder}</span>
          <button className="small" onClick={async () => (await api.chooseMediaFolder(), setSettings(await api.settings()))}>
            Change…
          </button>
          <button className="small" onClick={() => api.openMediaFolder()}>
            Open
          </button>
        </Row>
        <Row label="Port">
          <NumField value={settings?.nodePort ?? 47800} min={1} max={65535} onChange={(v) => save({ nodePort: v })} />
          <span className="muted">(restart the app after changing)</span>
        </Row>
        <div className="muted">Displays found: {info?.displays.map((d) => d.label).join("; ")}</div>
        <button onClick={() => confirm("Restart this app as the booth (operator) computer?") && api.switchRole("operator")}>Make this the booth computer instead</button>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NodeApp />
  </StrictMode>,
);
