// Typed wrapper around the IPC bridge exposed by electron/preload.ts.
import type { Plan, Show, TestPattern, PlaybackState, DisplayInfo, Media } from "../shared/types";
import type { ClockCommand } from "../shared/clock";

declare global {
  interface Window {
    api: {
      invoke: (ch: string, ...a: unknown[]) => Promise<any>;
      on: (ch: string, fn: (...a: any[]) => void) => () => void;
      send: (ch: string, ...a: unknown[]) => void;
    };
  }
}

const has = typeof window !== "undefined" && !!window.api;
const inv = (ch: string, ...a: unknown[]) => (has ? window.api.invoke(ch, ...a) : Promise.resolve(null));

export interface AppSettings {
  role: "operator" | "node";
  mediaFolder: string;
  nodeName: string;
  nodePort: number;
  showPath: string;
  addresses: string[];
  hostname: string;
  version: string;
}

export const api = {
  available: has,
  on: (ch: string, fn: (...a: any[]) => void) => (has ? window.api.on(ch, fn) : () => undefined),
  settings: (): Promise<AppSettings> => inv("settings:get"),
  setSettings: (p: Partial<AppSettings>) => inv("settings:set", p),
  switchRole: (r: "operator" | "node") => inv("role:switch", r),
  displays: (): Promise<DisplayInfo[]> => inv("displays:list"),
  chooseMediaFolder: (): Promise<string | null> => inv("media:chooseFolder"),
  openMediaFolder: () => inv("media:openFolder"),
  pickMedia: (): Promise<Media | null> => inv("media:pick"),

  getShow: (): Promise<{ show: Show; path: string; showMode: boolean; state: PlaybackState } | null> => inv("show:get"),
  updateShow: (s: Show): Promise<{ ok: boolean; error?: string }> => inv("show:update", s),
  newShow: (): Promise<Show | null> => inv("show:new"),
  openShow: (): Promise<{ show: Show; path: string } | null> => inv("show:open"),
  saveShowAs: (): Promise<string | null> => inv("show:saveAs"),
  backups: (): Promise<{ name: string; time: number }[]> => inv("show:backups"),
  restoreBackup: (name: string): Promise<Show | null> => inv("show:restore", name),
  setShowMode: (on: boolean): Promise<boolean> => inv("showmode:set", on),

  go: () => inv("play:go"),
  back: () => inv("play:back"),
  panic: () => inv("play:panic"),
  fire: (i: number) => inv("play:fire", i),
  fadeAll: (s: number) => inv("play:fadeAll", s),
  standby: (i: number) => inv("play:standby", i),
  testPattern: (ids: string[], p: TestPattern | null) => inv("play:testPattern", ids, p),
  clockCommand: (c: ClockCommand) => inv("clock:command", c),

  openPlan: (): Promise<{ plan: Plan; path: string } | null> => inv("plan:open"),
  savePlan: (plan: Plan, path: string | null): Promise<string | null> => inv("plan:save", plan, path),
  exportPdf: (html: string, name: string): Promise<string | null> => inv("export:pdf", html, name),
};
