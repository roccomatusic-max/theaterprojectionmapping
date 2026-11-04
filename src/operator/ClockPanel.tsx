// Master clock panel shown in the operator window. Filled in by the master clock work.
import type { ClockStatus } from "../shared/clock";

export function ClockPanel(props: { status: ClockStatus | null; now: number }) {
  const d = new Date(props.now);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return (
    <div className="clock-panel" title="Master clock">
      <span className="clock-time">
        {hh}:{mm}:{ss}
      </span>
      <span className={props.status?.synced ? "pill ok" : "pill warn"}>
        {props.status ? (props.status.synced ? "clock master" : "clock not synced") : "clock"}
      </span>
    </div>
  );
}
