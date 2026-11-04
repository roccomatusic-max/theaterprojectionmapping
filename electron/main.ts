// Electron main process.
//
// Two roles, chosen per computer (Setup screen, or --node / --operator on the command line):
//  - operator: the booth machine. Runs the Planner and the Player's cue list, holds the
//    master clock, drives any projectors plugged into it, and sends cues to the walls.
//  - node: a side-wall computer. Renders only. It listens for the operator on the
//    network, follows the master clock, and shows its projector outputs.

import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ClockCommand } from "../src/shared/clock";
import { CUE_LEAD_MS } from "../src/shared/clock";
import { back, expectedLayers, fadeAll, fireCue, go, initialPlayback, panic, prune, setStandby } from "../src/shared/cueEngine";
import type { NodeStatus, OutputStatus, PlaybackState, Plan, Show, TestPattern } from "../src/shared/types";
import { FollowerShowClock, MasterShowClock } from "./clock";
import { importMedia, IMAGE_EXT, mediaBaseUrl, mediaTypeOf, missingMedia, VIDEO_EXT } from "./media";
import { listen, Link, Msg, NodeConnection } from "./net/link";
import { OscListener } from "./osc";
import { listDisplays, OutputManager } from "./outputs";
import { loadSettings, saveSettings, writeFileAtomic } from "./settings";
import { readShow, ShowStore } from "./showStore";
import { emptyShow } from "../src/shared/defaults";

const DIST = path.join(__dirname, "../../dist");
const PRELOAD = path.join(__dirname, "preload.js");

const argRole = process.argv.includes("--node") ? "node" : process.argv.includes("--operator") ? "operator" : null;
// A render node started from the command line on the same computer as an operator
// (handy for testing) keeps its own settings folder.
if (argRole === "node" && process.argv.includes("--separate-profile")) {
  app.setPath("userData", app.getPath("userData") + "-node");
}
// For automated tests: keep everything in a throwaway folder.
if (process.env.MATILDA_USER_DATA) app.setPath("userData", process.env.MATILDA_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(start);
}

app.on("window-all-closed", () => app.quit());

function start(): void {
  Menu.setApplicationMenu(null);
  const settings = loadSettings();
  const role = argRole ?? settings.role;
  if (role === "node") startNode();
  else startOperator();
}

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) out.push(a.address);
  return out;
}

function relaunchAs(role: "operator" | "node"): void {
  saveSettings({ role });
  const args = process.argv.slice(1).filter((a) => a !== "--node" && a !== "--operator");
  app.relaunch({ args });
  app.exit(0);
}

function commonIpc(getWin: () => BrowserWindow | null, onMediaFolderChanged: () => void): void {
  ipcMain.handle("settings:get", () => ({ ...loadSettings(), addresses: lanAddresses(), hostname: os.hostname(), version: app.getVersion() }));
  ipcMain.handle("settings:set", (_e, patch) => saveSettings(patch));
  ipcMain.handle("role:switch", (_e, role: "operator" | "node") => relaunchAs(role));
  ipcMain.handle("displays:list", () => listDisplays());
  ipcMain.handle("media:chooseFolder", async () => {
    const win = getWin();
    const r = await dialog.showOpenDialog(win!, {
      title: "Choose the media folder",
      defaultPath: loadSettings().mediaFolder,
      properties: ["openDirectory", "createDirectory"],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    saveSettings({ mediaFolder: r.filePaths[0] });
    onMediaFolderChanged();
    return r.filePaths[0];
  });
  ipcMain.handle("media:openFolder", () => shell.openPath(loadSettings().mediaFolder));
}

// ===========================================================================
// Operator
// ===========================================================================

function startOperator(): void {
  const settings = loadSettings();
  const store = new ShowStore(settings.showPath);
  const clock = new MasterShowClock();
  const outputs = new OutputManager(DIST, PRELOAD);
  let playback: PlaybackState = initialPlayback();
  let showMode = false;
  let followTimer: NodeJS.Timeout | null = null;

  interface NodeEntry {
    conn: NodeConnection;
    status: NodeStatus;
    outputs: OutputStatus[];
    missingMedia: string[];
    thumbs: Record<string, string>;
  }
  const nodes = new Map<string, NodeEntry>();

  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1100,
    minHeight: 700,
    title: "Matilda Projection — Operator",
    backgroundColor: "#15171c",
    webPreferences: { preload: PRELOAD, contextIsolation: true, backgroundThrottling: false },
  });
  win.loadFile(path.join(DIST, "index.html"));
  win.on("close", (e) => {
    const r = dialog.showMessageBoxSync(win, {
      type: "warning",
      buttons: ["Keep running", "Quit"],
      defaultId: 0,
      cancelId: 0,
      message: "Quit Matilda Projection?",
      detail: "Every projector on this computer will go dark. Side-wall computers keep showing their last look.",
    });
    if (r === 0) e.preventDefault();
    else outputs.closeAll();
  });
  const ui = (channel: string, payload: unknown) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };

  const osc = new OscListener((a, raw) => {
    ui("osc", raw);
    if (a.kind === "go") doGo();
    else if (a.kind === "back") doBack();
    else if (a.kind === "blackout") doPanic();
    else if (a.kind === "cue") {
      const i = store.show.cues.findIndex((c) => c.number.trim() === a.number.trim());
      if (i >= 0) doFire(i);
    }
  });

  // ---- pushing show + state out ----------------------------------------
  function pushConfig(): void {
    const s = loadSettings();
    outputs.setShow(store.show, (o) => o.node === "local", mediaBaseUrl(s.mediaFolder));
    for (const [id, n] of nodes) n.conn.send({ type: "config", nodeId: id, show: store.show });
    osc.configure(store.show.osc.enabled, store.show.osc.port);
  }

  function pushState(): void {
    clock.setExpectedLayers(expectedLayers(playback));
    outputs.setState(playback);
    for (const n of nodes.values()) n.conn.send({ type: "state", state: playback });
    ui("state", playback);
  }

  function syncNodeConnections(): void {
    const wanted = new Map(store.show.nodes.map((n) => [n.id, n]));
    for (const [id, entry] of nodes) {
      const cfg = wanted.get(id);
      if (!cfg || cfg.host !== entry.conn.host || cfg.port !== entry.conn.port) {
        entry.conn.stop();
        clock.peerDisconnected?.(id);
        nodes.delete(id);
      }
    }
    for (const cfg of store.show.nodes) {
      if (nodes.has(cfg.id) || !cfg.host.trim()) continue;
      const conn = new NodeConnection(cfg.id, cfg.host.trim(), cfg.port);
      const entry: NodeEntry = {
        conn,
        status: { id: cfg.id, name: cfg.name, host: cfg.host, connected: false, displays: [], lastSeen: null },
        outputs: [],
        missingMedia: [],
        thumbs: {},
      };
      nodes.set(cfg.id, entry);
      conn.on("up", (link: Link) => {
        entry.status.connected = true;
        entry.status.error = undefined;
        link.onMessage((msg) => onNodeMessage(entry, msg, link));
        link.send({ type: "config", nodeId: cfg.id, show: store.show });
        link.send({ type: "state", state: playback });
      });
      conn.on("down", () => {
        entry.status.connected = false;
        clock.peerDisconnected?.(cfg.id);
      });
    }
  }

  function onNodeMessage(entry: NodeEntry, msg: Msg, link: Link): void {
    if (msg.type.startsWith("clock.")) {
      clock.handleMessage?.(msg, (m) => link.send(m), entry.conn.nodeId);
      return;
    }
    entry.status.lastSeen = Date.now();
    switch (msg.type) {
      case "hello":
      case "status":
        entry.status.displays = (msg.displays as NodeStatus["displays"]) ?? entry.status.displays;
        entry.outputs = (msg.outputs as OutputStatus[]) ?? entry.outputs;
        entry.missingMedia = (msg.missingMedia as string[]) ?? [];
        break;
      case "thumbs":
        entry.thumbs = (msg.thumbs as Record<string, string>) ?? {};
        break;
    }
  }

  // ---- playback ---------------------------------------------------------
  function cancelFollow(): void {
    if (followTimer) clearTimeout(followTimer);
    followTimer = null;
  }

  function afterFire(): void {
    cancelFollow();
    const cue = store.show.cues[playback.currentIndex];
    if (cue?.autoFollow && playback.standbyIndex < store.show.cues.length) {
      const expect = playback.seq;
      followTimer = setTimeout(() => {
        followTimer = null;
        // Only auto-follow if nobody pressed anything in between.
        if (playback.seq === expect) doGo();
      }, Math.max(0, cue.followDelay) * 1000);
    }
    pushState();
  }

  const at = () => clock.now() + CUE_LEAD_MS;
  function doGo(): void {
    const next = go(playback, store.show, at());
    if (next === playback) return;
    playback = next;
    afterFire();
  }
  function doBack(): void {
    playback = back(playback, store.show, at());
    afterFire();
  }
  function doFire(i: number): void {
    playback = fireCue(playback, store.show, i, at());
    afterFire();
  }
  function doPanic(): void {
    cancelFollow();
    playback = panic(playback);
    pushState();
  }

  // ---- IPC from the operator UI ----------------------------------------
  commonIpc(() => win, pushConfig);

  ipcMain.handle("app:role", () => "operator");
  ipcMain.handle("show:get", () => ({ show: store.show, path: store.file, showMode, state: playback }));
  ipcMain.handle("show:update", (_e, show: Show) => {
    if (showMode) return { ok: false, error: "Show mode is on. Turn it off to edit." };
    const nodesChanged = JSON.stringify(show.nodes) !== JSON.stringify(store.show.nodes);
    store.update(show);
    if (nodesChanged) syncNodeConnections();
    pushConfig();
    return { ok: true };
  });
  ipcMain.handle("show:new", () => {
    if (showMode) return null;
    const s = emptyShow();
    store.update(s);
    playback = initialPlayback();
    syncNodeConnections();
    pushConfig();
    pushState();
    return s;
  });
  ipcMain.handle("show:open", async () => {
    if (showMode) return null;
    const r = await dialog.showOpenDialog(win, { title: "Open show", filters: [{ name: "Show", extensions: ["json"] }], properties: ["openFile"] });
    if (r.canceled || !r.filePaths[0]) return null;
    const s = readShow(r.filePaths[0]);
    if (!s) {
      dialog.showErrorBox("Could not open show", "That file is not a Matilda Projection show file.");
      return null;
    }
    store.switchFile(r.filePaths[0], s);
    saveSettings({ showPath: r.filePaths[0] });
    playback = initialPlayback();
    syncNodeConnections();
    pushConfig();
    pushState();
    return { show: s, path: store.file };
  });
  ipcMain.handle("show:saveAs", async () => {
    const r = await dialog.showSaveDialog(win, { title: "Save show as", defaultPath: "Matilda show.json", filters: [{ name: "Show", extensions: ["json"] }] });
    if (r.canceled || !r.filePath) return null;
    store.switchFile(r.filePath, store.show);
    saveSettings({ showPath: r.filePath });
    return r.filePath;
  });
  ipcMain.handle("show:backups", () => store.listBackups());
  ipcMain.handle("show:restore", (_e, name: string) => {
    if (showMode) return null;
    const s = store.restore(name);
    if (s) {
      syncNodeConnections();
      pushConfig();
    }
    return s;
  });
  ipcMain.handle("showmode:set", (_e, on: boolean) => {
    showMode = !!on;
    return showMode;
  });

  ipcMain.handle("play:go", () => doGo());
  ipcMain.handle("play:back", () => doBack());
  ipcMain.handle("play:panic", () => doPanic());
  ipcMain.handle("play:fire", (_e, i: number) => doFire(i));
  ipcMain.handle("play:fadeAll", (_e, seconds: number) => {
    cancelFollow();
    playback = fadeAll(playback, at(), Math.max(0, seconds) * 1000);
    pushState();
  });
  ipcMain.handle("play:standby", (_e, i: number) => {
    playback = setStandby(playback, store.show, i);
    pushState();
  });
  ipcMain.handle("play:testPattern", (_e, outputIds: string[], pattern: TestPattern | null) => {
    if (showMode && pattern) return;
    const tp = { ...playback.testPatterns };
    for (const id of outputIds) tp[id] = pattern;
    playback = { ...playback, seq: playback.seq + 1, testPatterns: tp };
    pushState();
  });
  ipcMain.handle("clock:command", (_e, cmd: ClockCommand) => clock.command?.(cmd));

  ipcMain.handle("media:pick", async () => {
    const r = await dialog.showOpenDialog(win, {
      title: "Choose a video or image",
      defaultPath: loadSettings().mediaFolder,
      filters: [
        { name: "Video and images", extensions: [...VIDEO_EXT, ...IMAGE_EXT] },
        { name: "All files", extensions: ["*"] },
      ],
      properties: ["openFile"],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const type = mediaTypeOf(r.filePaths[0]);
    if (!type) {
      dialog.showErrorBox("Unsupported file", "Choose an MP4/MOV/WebM video or a PNG/JPG image.");
      return null;
    }
    try {
      return { type, file: importMedia(r.filePaths[0], loadSettings().mediaFolder) };
    } catch (e) {
      dialog.showErrorBox("Could not copy the file into the media folder", String(e));
      return null;
    }
  });

  ipcMain.handle("plan:open", async () => {
    const r = await dialog.showOpenDialog(win, { title: "Open plan", filters: [{ name: "Plan", extensions: ["json"] }], properties: ["openFile"] });
    if (r.canceled || !r.filePaths[0]) return null;
    try {
      const plan = JSON.parse(fs.readFileSync(r.filePaths[0], "utf8")) as Plan;
      if (plan.version !== 1 || !plan.room || !Array.isArray(plan.projectors)) throw new Error("not a plan");
      return { plan, path: r.filePaths[0] };
    } catch {
      dialog.showErrorBox("Could not open plan", "That file is not a Matilda Projection plan.");
      return null;
    }
  });
  ipcMain.handle("plan:save", async (_e, plan: Plan, currentPath: string | null) => {
    let file = currentPath;
    if (!file) {
      const r = await dialog.showSaveDialog(win, { title: "Save plan", defaultPath: "Auditorium plan.json", filters: [{ name: "Plan", extensions: ["json"] }] });
      if (r.canceled || !r.filePath) return null;
      file = r.filePath;
    }
    writeFileAtomic(file, JSON.stringify(plan, null, 2));
    return file;
  });
  ipcMain.handle("export:pdf", async (_e, html: string, defaultName: string) => {
    const r = await dialog.showSaveDialog(win, { title: "Save summary", defaultPath: defaultName, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (r.canceled || !r.filePath) return null;
    const tmp = path.join(app.getPath("temp"), `matilda-summary-${Date.now()}.html`);
    fs.writeFileSync(tmp, html);
    const pw = new BrowserWindow({ show: false, webPreferences: { offscreen: false } });
    try {
      await pw.loadFile(tmp);
      const pdf = await pw.webContents.printToPDF({ landscape: true, printBackground: true, pageSize: "Letter" });
      fs.writeFileSync(r.filePath, pdf);
      shell.openPath(r.filePath);
      return r.filePath;
    } finally {
      pw.destroy();
      fs.rmSync(tmp, { force: true });
    }
  });

  // ---- timers -------------------------------------------------------------
  setInterval(() => {
    // Outputs on the booth computer itself report straight to the master clock.
    (clock as unknown as { reportLocalPlayback?: (r: unknown[]) => void }).reportLocalPlayback?.(outputs.playbackReports());
    ui("clockStatus", clock.status());
    outputs.setClockOffset(clock.now() - Date.now());
  }, 250);
  setInterval(() => {
    const pruned = prune(playback, clock.now());
    if (pruned !== playback) {
      playback = pruned;
      pushState();
    }
  }, 500);
  setInterval(async () => {
    const s = loadSettings();
    ui("status", {
      local: {
        displays: listDisplays(),
        outputs: outputs.statuses(),
        missingMedia: missingMedia(store.show, s.mediaFolder),
        addresses: lanAddresses(),
      },
      nodes: [...nodes.values()].map((n) => ({
        ...n.status,
        error: n.status.connected ? undefined : n.conn.lastError,
        outputs: n.outputs,
        missingMedia: n.missingMedia,
      })),
      osc: { listening: osc.listening, error: osc.error, last: osc.lastMessage },
      showMode,
    });
    const thumbs = await outputs.thumbnails();
    for (const n of nodes.values()) Object.assign(thumbs, n.thumbs);
    ui("thumbs", thumbs);
  }, 1000);

  syncNodeConnections();
  pushConfig();
}

// ===========================================================================
// Render node (side-wall computer)
// ===========================================================================

function startNode(): void {
  const settings = loadSettings();
  const clock = new FollowerShowClock(undefined, { name: settings.nodeName });
  const outputs = new OutputManager(DIST, PRELOAD);
  let link: Link | null = null;
  let nodeId: string | null = null;
  let show: Show | null = null;
  let operatorAddress = "";

  const win = new BrowserWindow({
    width: 760,
    height: 620,
    title: "Matilda Projection — Side-wall computer",
    backgroundColor: "#15171c",
    webPreferences: { preload: PRELOAD, contextIsolation: true, backgroundThrottling: false },
  });
  win.loadFile(path.join(DIST, "node.html"));
  win.on("close", (e) => {
    const r = dialog.showMessageBoxSync(win, {
      type: "warning",
      buttons: ["Keep running", "Quit"],
      defaultId: 0,
      cancelId: 0,
      message: "Quit this side-wall computer?",
      detail: "Its projectors will go dark.",
    });
    if (r === 0) e.preventDefault();
    else outputs.closeAll();
  });

  const applyShow = () => {
    if (!show || !nodeId) return;
    const id = nodeId;
    outputs.setShow(show, (o) => o.node === id, mediaBaseUrl(loadSettings().mediaFolder));
  };

  commonIpc(() => win, applyShow);
  ipcMain.handle("app:role", () => "node");

  const server = listen(settings.nodePort, (l) => {
    // One operator at a time: a new connection replaces the old one.
    if (link && link !== l) link.close();
    link = l;
    operatorAddress = l.socket.remoteAddress ?? "";
    clock.attach((m) => l.send(m));
    l.onMessage((msg) => {
      if (msg.type.startsWith("clock.")) {
        clock.handleMessage(msg);
        return;
      }
      if (msg.type === "config") {
        nodeId = String(msg.nodeId);
        show = msg.show as Show;
        applyShow();
      } else if (msg.type === "state") {
        outputs.setState(msg.state as PlaybackState);
      }
    });
    l.on("close", () => {
      if (link === l) {
        link = null;
        clock.detach();
      }
    });
    l.send(statusMsg("hello"));
  });
  let serverError = "";
  server.on("error", (e) => (serverError = e.message));

  function statusMsg(type: "hello" | "status") {
    return {
      type,
      name: loadSettings().nodeName,
      displays: listDisplays(),
      outputs: outputs.statuses(),
      missingMedia: show ? missingMedia(show, loadSettings().mediaFolder) : [],
    };
  }

  setInterval(() => {
    outputs.setClockOffset(clock.now() - Date.now());
    clock.reportPlayback(outputs.playbackReports());
  }, 250);
  setInterval(async () => {
    link?.send(statusMsg("status"));
    if (link) link.send({ type: "thumbs", thumbs: await outputs.thumbnails(240) });
    if (!win.isDestroyed())
      win.webContents.send("node:status", {
        connected: !!link,
        operatorAddress,
        nodeId,
        port: loadSettings().nodePort,
        serverError,
        addresses: lanAddresses(),
        clock: clock.status(),
        outputs: show && nodeId ? show.outputs.filter((o) => o.node === nodeId) : [],
        outputStatus: outputs.statuses(),
        missingMedia: show ? missingMedia(show, loadSettings().mediaFolder) : [],
        displays: listDisplays(),
      });
  }, 1000);
}
