// Output windows: one borderless full-screen window per projector on this computer.
//
// Rules for a live show:
//  - windows open black and stay black until content is drawn;
//  - Escape, Alt+F4 and Cmd+W never close an output (only quitting the app does);
//  - a missing display just leaves that output closed and reported in the status.

import { BrowserWindow, ipcMain, screen } from "electron";
import path from "node:path";
import type { DisplayInfo, OutputConfig, OutputStatus, PlaybackState, Show } from "../src/shared/types";
import type { PlaybackReport } from "../src/shared/clock-playback";

/** displayId value meaning "open as a normal window on this screen" (rehearsing without projectors). */
export const WINDOWED_DISPLAY_ID = -1;

export function listDisplays(): DisplayInfo[] {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: `${d.label || `Display ${i + 1}`} — ${d.size.width}×${d.size.height}${d.id === primary ? " (main screen)" : ""}`,
    bounds: d.bounds,
    size: { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) },
    scaleFactor: d.scaleFactor,
    primary: d.id === primary,
  }));
}

interface OutWin {
  win: BrowserWindow;
  config: OutputConfig;
  displayId: number;
  status: OutputStatus;
  ready: boolean;
  playback: PlaybackReport[];
}

export class OutputManager {
  private wins = new Map<string, OutWin>();
  private show: Show | null = null;
  private mediaBase = "";
  private state: PlaybackState | null = null;
  private clockOffset = 0;
  quitting = false;

  constructor(private readonly distDir: string, private readonly preload: string) {
    ipcMain.on("output:status", (e, st: OutputStatus) => {
      for (const w of this.wins.values()) if (w.win.webContents.id === e.sender.id) w.status = { ...st, open: true };
    });
    ipcMain.on("output:playback", (e, reports: PlaybackReport[]) => {
      for (const w of this.wins.values()) if (w.win.webContents.id === e.sender.id) w.playback = Array.isArray(reports) ? reports : [];
    });
    ipcMain.on("output:ready", (e) => {
      for (const w of this.wins.values())
        if (w.win.webContents.id === e.sender.id) {
          w.ready = true;
          this.sendInit(w);
        }
    });
    screen.on("display-added", () => this.sync());
    screen.on("display-removed", () => this.sync());
    screen.on("display-metrics-changed", () => this.sync());
  }

  /** Update which outputs this computer should show. `mine` filters the outputs for this machine. */
  setShow(show: Show, mine: (o: OutputConfig) => boolean, mediaBase: string): void {
    this.show = { ...show, outputs: show.outputs.filter(mine) };
    this.mediaBase = mediaBase;
    this.sync();
  }

  setState(state: PlaybackState): void {
    this.state = state;
    for (const w of this.wins.values()) if (w.ready) w.win.webContents.send("output:state", state);
  }

  setClockOffset(offset: number): void {
    this.clockOffset = offset;
    for (const w of this.wins.values()) if (w.ready) w.win.webContents.send("output:clock", offset);
  }

  statuses(): OutputStatus[] {
    const out: OutputStatus[] = [];
    for (const o of this.show?.outputs ?? []) {
      const w = this.wins.get(o.id);
      out.push(
        w
          ? w.status
          : { outputId: o.id, fps: 0, droppedFrames: 0, missingMedia: [], open: false, driftMs: 0 },
      );
    }
    return out;
  }

  /** What this computer's outputs are showing (one report per layer and wall). */
  playbackReports(): PlaybackReport[] {
    const seen = new Set<string>();
    const out: PlaybackReport[] = [];
    for (const w of this.wins.values())
      for (const r of w.playback) {
        const k = `${r.key}|${r.wall}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(r);
      }
    return out;
  }

  async thumbnails(width = 320): Promise<Record<string, string>> {
    const res: Record<string, string> = {};
    await Promise.all(
      [...this.wins.entries()].map(async ([id, w]) => {
        if (!w.ready || w.win.isDestroyed()) return;
        try {
          const img = await w.win.webContents.capturePage();
          if (img.isEmpty()) return;
          res[id] = "data:image/jpeg;base64," + img.resize({ width }).toJPEG(60).toString("base64");
        } catch {
          /* window busy; skip this round */
        }
      }),
    );
    return res;
  }

  private sendInit(w: OutWin): void {
    if (!this.show) return;
    w.win.webContents.send("output:init", { outputId: w.config.id, show: this.show, mediaBase: this.mediaBase });
    if (this.state) w.win.webContents.send("output:state", this.state);
    w.win.webContents.send("output:clock", this.clockOffset);
  }

  sync(): void {
    const show = this.show;
    const displays = screen.getAllDisplays();
    const wanted = new Map<string, { config: OutputConfig; display: Electron.Display | null }>();
    for (const o of show?.outputs ?? []) {
      if (o.displayId === null) continue;
      if (o.displayId === WINDOWED_DISPLAY_ID) {
        wanted.set(o.id, { config: o, display: null });
        continue;
      }
      const d = displays.find((x) => x.id === o.displayId);
      if (d) wanted.set(o.id, { config: o, display: d });
    }
    // Close outputs that are no longer wanted.
    for (const [id, w] of this.wins) {
      const want = wanted.get(id);
      const wantDisplayId = want ? (want.display ? want.display.id : WINDOWED_DISPLAY_ID) : null;
      if (!want || wantDisplayId !== w.displayId) {
        this.destroy(id);
      }
    }
    // Open or update the rest.
    for (const [id, want] of wanted) {
      const existing = this.wins.get(id);
      if (existing) {
        existing.config = want.config;
        if (existing.ready) this.sendInit(existing);
        continue;
      }
      this.open(want.config, want.display);
    }
  }

  private open(config: OutputConfig, display: Electron.Display | null): void {
    const windowed = display === null;
    const b = display?.bounds ?? { x: 80, y: 80, width: 960, height: 600 };
    const win = new BrowserWindow({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      frame: windowed,
      title: `Output: ${config.name}`,
      backgroundColor: "#000000",
      show: false,
      fullscreen: !windowed && process.platform !== "darwin",
      alwaysOnTop: !windowed,
      skipTaskbar: !windowed,
      autoHideMenuBar: true,
      resizable: windowed,
      movable: windowed,
      minimizable: windowed,
      closable: true,
      hasShadow: windowed,
      enableLargerThanScreen: true,
      webPreferences: {
        preload: this.preload,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    if (!windowed) {
      win.setAlwaysOnTop(true, "screen-saver");
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      if (process.platform === "darwin") win.setBounds(b);
    }
    win.setMenu(null);
    // Escape and the usual close shortcuts must never close or un-fullscreen an output.
    win.webContents.on("before-input-event", (e, input) => {
      const k = input.key.toLowerCase();
      if (k === "escape" || (input.alt && k === "f4") || ((input.meta || input.control) && (k === "w" || k === "q")))
        e.preventDefault();
    });
    win.on("close", (e) => {
      if (!this.quitting && !windowed) e.preventDefault();
    });
    win.on("closed", () => {
      const w = this.wins.get(config.id);
      if (w && w.win === win) this.wins.delete(config.id);
    });
    // If the renderer ever crashes, reload it: it comes back black and picks up the show again.
    win.webContents.on("render-process-gone", () => {
      const w = this.wins.get(config.id);
      if (w) w.ready = false;
      setTimeout(() => !win.isDestroyed() && win.reload(), 500);
    });
    win.once("ready-to-show", () => win.showInactive());
    win.loadFile(path.join(this.distDir, "output.html"), { query: { id: config.id } });
    this.wins.set(config.id, {
      win,
      config,
      displayId: display ? display.id : WINDOWED_DISPLAY_ID,
      ready: false,
      playback: [],
      status: { outputId: config.id, fps: 0, droppedFrames: 0, missingMedia: [], open: true, driftMs: 0 },
    });
  }

  private destroy(id: string): void {
    const w = this.wins.get(id);
    if (!w) return;
    this.wins.delete(id);
    if (!w.win.isDestroyed()) w.win.destroy();
  }

  closeAll(): void {
    this.quitting = true;
    for (const id of [...this.wins.keys()]) this.destroy(id);
  }
}
