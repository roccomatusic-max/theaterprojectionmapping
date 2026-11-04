// The show file: autosaved after every change, with the last 10 versions kept.

import fs from "node:fs";
import path from "node:path";
import type { Show } from "../src/shared/types";
import { emptyShow } from "../src/shared/defaults";
import { writeFileAtomic } from "./settings";

export const KEEP_VERSIONS = 10;
const SNAPSHOT_DEBOUNCE_MS = 2000;

export function backupDir(showPath: string): string {
  return path.join(path.dirname(showPath), "show-backups");
}

export function readShow(file: string): Show | null {
  try {
    const s = JSON.parse(fs.readFileSync(file, "utf8")) as Show;
    if (!s || s.version !== 1 || !Array.isArray(s.cues) || !Array.isArray(s.outputs)) return null;
    return normaliseShow(s);
  } catch {
    return null;
  }
}

/** Fill in anything an older show file might be missing. */
export function normaliseShow(s: Show): Show {
  const base = emptyShow();
  return {
    ...base,
    ...s,
    walls: { ...base.walls, ...s.walls },
    wallMasks: { left: s.wallMasks?.left ?? [], right: s.wallMasks?.right ?? [] },
    nodes: s.nodes ?? [],
    osc: { ...base.osc, ...s.osc },
  };
}

export class ShowStore {
  show: Show;
  private snapshotTimer: NodeJS.Timeout | null = null;

  constructor(public file: string) {
    this.show = readShow(file) ?? this.recoverFromBackup() ?? emptyShow();
    if (!fs.existsSync(file)) this.writeMain();
  }

  /** If the main file is unreadable, fall back to the newest good backup. */
  private recoverFromBackup(): Show | null {
    for (const b of this.listBackups()) {
      const s = readShow(path.join(backupDir(this.file), b.name));
      if (s) return s;
    }
    return null;
  }

  update(show: Show): void {
    this.show = show;
    this.writeMain();
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(() => this.snapshot(), SNAPSHOT_DEBOUNCE_MS);
  }

  private writeMain(): void {
    try {
      writeFileAtomic(this.file, JSON.stringify(this.show, null, 2));
    } catch (e) {
      console.error("autosave failed", e);
    }
  }

  snapshot(): void {
    this.snapshotTimer = null;
    const dir = backupDir(this.file);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    try {
      writeFileAtomic(path.join(dir, `show-${stamp}.json`), JSON.stringify(this.show, null, 2));
      const all = this.listBackups();
      for (const old of all.slice(KEEP_VERSIONS)) fs.rmSync(path.join(dir, old.name), { force: true });
    } catch (e) {
      console.error("backup failed", e);
    }
  }

  /** Newest first. */
  listBackups(): { name: string; time: number }[] {
    const dir = backupDir(this.file);
    try {
      return fs
        .readdirSync(dir)
        .filter((n) => /^show-.*\.json$/.test(n))
        .map((name) => ({ name, time: fs.statSync(path.join(dir, name)).mtimeMs }))
        .sort((a, b) => b.time - a.time);
    } catch {
      return [];
    }
  }

  restore(name: string): Show | null {
    const s = readShow(path.join(backupDir(this.file), path.basename(name)));
    if (s) this.update(s);
    return s;
  }

  switchFile(file: string, show?: Show): void {
    this.file = file;
    if (show) this.update(show);
    else this.show = readShow(file) ?? this.show;
  }
}
