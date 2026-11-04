// Media folder helpers. Cues store paths relative to the media folder so the same
// show file works on every computer once the folder has been copied to each one.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { MediaType, Show } from "../src/shared/types";
import { mediaFiles } from "../src/shared/cueEngine";

export const VIDEO_EXT = ["mp4", "m4v", "mov", "webm", "mkv"];
export const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "gif", "bmp"];

export function mediaBaseUrl(folder: string): string {
  const href = pathToFileURL(folder).href;
  return href.endsWith("/") ? href : href + "/";
}

export function mediaTypeOf(file: string): MediaType | null {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (VIDEO_EXT.includes(ext)) return "video";
  if (IMAGE_EXT.includes(ext)) return "image";
  return null;
}

export function missingMedia(show: Show, folder: string): string[] {
  return mediaFiles(show).filter((f) => !fs.existsSync(path.join(folder, f)));
}

/**
 * Bring a chosen file into the media folder (copying it if it lives elsewhere) and
 * return its path relative to the folder, using forward slashes.
 */
export function importMedia(src: string, folder: string): string {
  fs.mkdirSync(folder, { recursive: true });
  const rel = path.relative(folder, src);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) return rel.split(path.sep).join("/");
  const ext = path.extname(src);
  const stem = path.basename(src, ext);
  let name = path.basename(src);
  let n = 1;
  while (fs.existsSync(path.join(folder, name))) {
    if (fs.statSync(path.join(folder, name)).size === fs.statSync(src).size) return name; // same file already there
    name = `${stem} (${++n})${ext}`;
  }
  fs.copyFileSync(src, path.join(folder, name));
  return name;
}
