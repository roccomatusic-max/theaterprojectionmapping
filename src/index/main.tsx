// Operator window: Planner + Player (Setup, Align, Show).
import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../ui/styles.css";
import type { PlaybackState, Plan, Show } from "../shared/types";
import type { ClockStatus } from "../shared/clock";
import { defaultPlan, emptyShow } from "../shared/defaults";
import { initialPlayback } from "../shared/cueEngine";
import { planToShow } from "../shared/planToShow";
import { api } from "../ui/api";
import { PlannerView } from "../planner/PlannerView";
import { SetupView } from "../player/SetupView";
import { AlignView } from "../player/AlignView";
import { ShowView } from "../player/ShowView";
import { EMPTY_STATUS, UiStatus } from "../player/types";

type Tab = "planner" | "setup" | "align" | "show";
const PLAN_KEY = "matilda.plan.v1";

function loadPlan(): Plan {
  try {
    const p = JSON.parse(localStorage.getItem(PLAN_KEY) ?? "null");
    if (p && p.version === 1 && p.room) return p;
  } catch {
    /* ignore */
  }
  return defaultPlan();
}

function App() {
  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem("matilda.tab") as Tab) || "planner");
  const [plan, setPlanState] = useState<Plan>(loadPlan);
  const [planPath, setPlanPath] = useState<string | null>(() => localStorage.getItem("matilda.planPath"));
  const [show, setShowState] = useState<Show>(emptyShow);
  const [showPath, setShowPath] = useState("");
  const [state, setState] = useState<PlaybackState>(initialPlayback);
  const [status, setStatus] = useState<UiStatus>(EMPTY_STATUS);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [clock, setClock] = useState<ClockStatus | null>(null);
  const [showMode, setShowModeState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pushTimer = useRef<number | null>(null);
  const pending = useRef<Show | null>(null);

  useEffect(() => localStorage.setItem("matilda.tab", tab), [tab]);
  const setPlan = (p: Plan) => {
    setPlanState(p);
    try {
      localStorage.setItem(PLAN_KEY, JSON.stringify(p));
    } catch {
      /* storage full: the file save still works */
    }
  };

  const reloadShow = useCallback(async () => {
    const r = await api.getShow();
    if (!r) return;
    setShowState(r.show);
    setShowPath(r.path);
    setState(r.state);
    setShowModeState(r.showMode);
  }, []);

  useEffect(() => {
    reloadShow();
    const offs = [
      api.on("state", setState),
      api.on("status", setStatus),
      api.on("thumbs", setThumbs),
      api.on("clockStatus", setClock),
    ];
    return () => offs.forEach((f) => f());
  }, [reloadShow]);

  // Edits are applied locally at once and sent to the main process (which autosaves
  // and updates every output) at most ~30 times a second.
  const setShow = useCallback((s: Show) => {
    setShowState(s);
    pending.current = s;
    if (pushTimer.current !== null) return;
    pushTimer.current = window.setTimeout(async () => {
      pushTimer.current = null;
      const next = pending.current;
      pending.current = null;
      if (!next) return;
      const r = await api.updateShow(next);
      if (r && !r.ok) setError(r.error ?? "Could not save");
    }, 33);
  }, []);

  const setShowMode = async (on: boolean) => {
    if (!on && !confirm("Turn show mode off? Editing will be possible again.")) return;
    setShowModeState(await api.setShowMode(on));
  };

  const importPlan = (onlyOutput?: string) => {
    const { show: next, warnings } = planToShow(plan, show);
    if (onlyOutput) {
      const o = next.outputs.find((x) => x.id === onlyOutput);
      if (!o) {
        alert("This output did not come from the Planner, so there is nothing to reset it to.");
        return;
      }
      setShow({ ...show, outputs: show.outputs.map((x) => (x.id === onlyOutput ? { ...x, slice: o.slice, corners: o.corners, mesh: o.mesh, blend: o.blend } : x)) });
      return;
    }
    if (show.outputs.length && !confirm("Bring the Planner's projectors, walls and exit-sign masks into the Player? Warps for these projectors are reset to the Planner's numbers. Cues and display assignments are kept.")) return;
    setShow(next);
    if (warnings.length) alert(warnings.join("\n"));
    setTab("setup");
  };

  const locked = showMode;
  return (
    <div className="app">
      {showMode && <div className="showmode-banner">SHOW MODE: editing is locked. GO, Back and Panic still work.</div>}
      <div className="topbar">
        <span className="brand">Matilda Projection</span>
        <div className="tabs">
          {(
            [
              ["planner", "Planner"],
              ["setup", "Player: Setup"],
              ["align", "Player: Align"],
              ["show", "Player: Show"],
            ] as [Tab, string][]
          ).map(([t, l]) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {l}
            </button>
          ))}
        </div>
        <span className="grow" />
        {tab !== "show" && (
          <span className="hstack">
            <span className={clock?.synced ? "pill ok" : "pill warn"}>{clockSummary(clock)}</span>
          </span>
        )}
        <button className={showMode ? "danger" : ""} onClick={() => setShowMode(!showMode)}>
          {showMode ? "🔒 Show mode ON" : "Show mode off"}
        </button>
      </div>
      {error && (
        <div className="alert bad" onClick={() => setError(null)}>
          {error} (click to dismiss)
        </div>
      )}
      {!api.available && <div className="alert bad">Running outside the desktop app: saving, outputs and cues are disabled.</div>}
      {tab === "planner" && (
        <PlannerView
          plan={plan}
          setPlan={setPlan}
          planPath={planPath}
          locked={locked}
          onOpen={async () => {
            const r = await api.openPlan();
            if (r) {
              setPlan(r.plan);
              setPlanPath(r.path);
              localStorage.setItem("matilda.planPath", r.path);
            }
          }}
          onSave={async (saveAs) => {
            const p = await api.savePlan(plan, saveAs ? null : planPath);
            if (p) {
              setPlanPath(p);
              localStorage.setItem("matilda.planPath", p);
            }
          }}
          onSendToPlayer={() => (locked ? alert("Turn show mode off first.") : importPlan())}
        />
      )}
      {tab === "setup" && (
        <SetupView
          show={show}
          setShow={setShow}
          showPath={showPath}
          status={status}
          testPatterns={state.testPatterns}
          locked={locked}
          onImportPlan={() => importPlan()}
          reloadShow={reloadShow}
        />
      )}
      {tab === "align" && (
        <AlignView show={show} setShow={setShow} status={status} thumbs={thumbs} testPatterns={state.testPatterns} locked={locked} resetFromPlanner={(id) => importPlan(id)} />
      )}
      {tab === "show" && <ShowView show={show} setShow={setShow} state={state} status={status} thumbs={thumbs} clock={clock} locked={locked} />}
    </div>
  );
}

function clockSummary(c: ClockStatus | null): string {
  if (!c) return "clock starting";
  const nodes = c.nodes ?? [];
  if (!nodes.length) return "master clock";
  const bad = nodes.filter((n) => n.state !== "locked");
  return bad.length ? `${bad.length} wall computer(s) not in sync` : `${nodes.length} wall computer(s) in sync`;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
