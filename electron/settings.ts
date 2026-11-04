// Per-computer settings (not part of the show file): role, media folder, node name.

import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_NODE_PORT } from "./net/link";

export interface Settings {
  role: "operator" | "node";
  /** Folder that holds the show's videos and images. Copy the same folder to every computer. */
  mediaFolder: string;
  /** Name this computer shows up as when it is a render node. */
  nodeName: string;
  nodePort: number;
  showPath: string;
}

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

export function defaultSettings(): Settings {
  return {
    role: "operator",
    mediaFolder: path.join(app.getPath("documents"), "Matilda Projection Media"),
    nodeName: os.hostname(),
    nodePort: DEFAULT_NODE_PORT,
    showPath: path.join(app.getPath("userData"), "show.json"),
  };
}

let current: Settings | null = null;

export function loadSettings(): Settings {
  if (current) return current;
  let s = defaultSettings();
  try {
    s = { ...s, ...JSON.parse(fs.readFileSync(settingsPath(), "utf8")) };
  } catch {
    /* first run */
  }
  current = s;
  try {
    fs.mkdirSync(s.mediaFolder, { recursive: true });
  } catch {
    /* folder may be on a drive that is not plugged in */
  }
  return s;
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const s = { ...loadSettings(), ...patch };
  current = s;
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2));
  return s;
}

/** Write a file atomically (write a temp file, then rename) so a crash never leaves half a file. */
export function writeFileAtomic(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
