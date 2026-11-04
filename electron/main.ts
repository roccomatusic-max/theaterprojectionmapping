// Electron main process. (Scaffold: full window/network wiring follows.)
import { app, BrowserWindow } from "electron";
import path from "node:path";
import { createMasterClock } from "./clock";

const clock = createMasterClock();

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#111",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  win.loadFile(path.join(__dirname, "../../dist/index.html"));
  void clock;
});
app.on("window-all-closed", () => app.quit());
