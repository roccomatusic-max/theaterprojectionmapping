// Output window renderer: one per projector.
//
// Pipeline per frame:
//   1. Content pass: draw this wall's live layers (video / image / colour) into an
//      off-screen texture that covers exactly this output's slice of the wall canvas.
//      Layers add together, so a crossfade is a true dissolve.
//   2. Warp pass: draw that texture through the corner-pin + mesh warp onto the screen,
//      applying edge blends, wall masks (exit signs), output masks and colour trims.
// Everything defaults to black: no show, missing media, panic or a GL error = black.

import { compile, deleteTarget, hexToRgb, makeTarget, makeTexture, Target } from "./gl";
import { drawTestPattern } from "./patterns";
import { buildRenderMesh } from "../shared/warp";
import { layerOpacity, standbyMedia, videoTimeAt } from "../shared/cueEngine";
import { VideoFollower, type PlaybackReport } from "../shared/clock-playback";
import type { Layer, Media, OutputConfig, PlaybackState, Show, TestPattern } from "../shared/types";

declare global {
  interface Window {
    api: {
      invoke: (ch: string, ...a: unknown[]) => Promise<any>;
      on: (ch: string, fn: (...a: any[]) => void) => () => void;
      send: (ch: string, ...a: unknown[]) => void;
    };
  }
}

const outputId = new URLSearchParams(location.search).get("id") ?? "";
document.title = "Output";
document.body.style.cssText = "margin:0;background:#000;overflow:hidden;cursor:none";
const canvas = document.createElement("canvas");
canvas.style.cssText = "display:block;width:100vw;height:100vh";
document.body.appendChild(canvas);

let show: Show | null = null;
let out: OutputConfig | null = null;
let mediaBase = "";
let state: PlaybackState | null = null;
let clockOffset = 0;
const masterNow = () => Date.now() + clockOffset;

// ---------------------------------------------------------------------------
// GL setup
// ---------------------------------------------------------------------------
const gl = canvas.getContext("webgl", { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true })!;

const CONTENT_VS = `
attribute vec2 aPos; attribute vec2 aUv; varying vec2 vUv;
void main(){ vUv = aUv; gl_Position = vec4(aPos, 0.0, 1.0); }`;
const CONTENT_FS = `
precision mediump float; varying vec2 vUv;
uniform sampler2D uTex; uniform float uUseTex; uniform vec3 uColor; uniform float uOpacity;
void main(){
  vec3 c = uUseTex > 0.5 ? texture2D(uTex, vUv).rgb : uColor;
  gl_FragColor = vec4(c * uOpacity, 1.0);
}`;
const WARP_VS = `
attribute vec2 aPos; attribute vec2 aUv; varying vec2 vUv;
void main(){ vUv = aUv; gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, 0.0, 1.0); }`;
const WARP_FS = `
precision mediump float; varying vec2 vUv;
uniform sampler2D uContent; uniform sampler2D uWallMask; uniform sampler2D uOutMask;
uniform vec2 uRes; uniform vec4 uSlice; // x0,y0,x1,y1 in feet
uniform vec3 uBlendW; uniform vec3 uBlendE; uniform vec3 uBlendN; uniform vec3 uBlendS; // width, curve, gamma
uniform float uBrightness; uniform vec3 uRgb;
float curve(float x, float p){ x = clamp(x, 0.0, 1.0); return x < 0.5 ? 0.5 * pow(2.0 * x, p) : 1.0 - 0.5 * pow(2.0 * (1.0 - x), p); }
float edge(float d, vec3 e){ if (e.x <= 0.0) return 1.0; return pow(curve(d / e.x, max(e.y, 0.1)), 1.0 / max(e.z, 0.1)); }
void main(){
  vec2 ft = vec2(mix(uSlice.x, uSlice.z, vUv.x), mix(uSlice.y, uSlice.w, vUv.y));
  float b = edge(ft.x - uSlice.x, uBlendW) * edge(uSlice.z - ft.x, uBlendE) * edge(ft.y - uSlice.y, uBlendN) * edge(uSlice.w - ft.y, uBlendS);
  vec3 c = texture2D(uContent, vec2(vUv.x, 1.0 - vUv.y)).rgb;
  float wm = texture2D(uWallMask, vUv).r;
  float om = texture2D(uOutMask, gl_FragCoord.xy / uRes).r;
  gl_FragColor = vec4(clamp(c * b * uBrightness * uRgb, 0.0, 1.0) * wm * om, 1.0);
}`;

const contentProg = compile(gl, CONTENT_VS, CONTENT_FS);
const warpProg = compile(gl, WARP_VS, WARP_FS);
const quadPos = gl.createBuffer()!;
const quadUv = gl.createBuffer()!;
const meshPos = gl.createBuffer()!;
const meshUv = gl.createBuffer()!;
const meshIdx = gl.createBuffer()!;
let meshCount = 0;
let sliceTarget: Target | null = null;
const wallMaskTex = makeTexture(gl);
const outMaskTex = makeTexture(gl);
const patternTex = makeTexture(gl);
let patternKey = "";
let geometryKey = "";

function bindAttr(prog: WebGLProgram, name: string, buf: WebGLBuffer): void {
  const loc = gl.getAttribLocation(prog, name);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
}

function uploadCanvas(tex: WebGLTexture, c: HTMLCanvasElement): void {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
}

/** Rebuild everything that depends on the output's geometry (mesh, masks, slice texture). */
function rebuildGeometry(): void {
  if (!out || !show) return;
  const key = JSON.stringify([out.corners, out.mesh, out.slice, out.masks, show.wallMasks[out.wall], canvas.width, canvas.height]);
  if (key === geometryKey) return;
  geometryKey = key;

  const m = buildRenderMesh(out, 48);
  gl.bindBuffer(gl.ARRAY_BUFFER, meshPos);
  gl.bufferData(gl.ARRAY_BUFFER, m.positions, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, meshUv);
  gl.bufferData(gl.ARRAY_BUFFER, m.texcoords, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIdx);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.STATIC_DRAW);
  meshCount = m.indices.length;

  // Slice texture: about the output's own resolution, with the slice's shape.
  const sw = Math.max(0.01, out.slice.x1 - out.slice.x0);
  const sh = Math.max(0.01, out.slice.y1 - out.slice.y0);
  const maxSize = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
  let tw = Math.min(maxSize, Math.round(Math.max(out.width, 256) * 1.25));
  let th = Math.round((tw * sh) / sw);
  if (th > maxSize) {
    th = maxSize;
    tw = Math.round((th * sw) / sh);
  }
  if (!sliceTarget || sliceTarget.w !== tw || sliceTarget.h !== th) {
    deleteTarget(gl, sliceTarget);
    sliceTarget = makeTarget(gl, Math.max(1, tw), Math.max(1, th));
  }

  // Wall masks, drawn in slice space (white = show, black = masked).
  const wm = document.createElement("canvas");
  wm.width = Math.min(2048, tw);
  wm.height = Math.max(1, Math.round((wm.width * sh) / sw));
  const wctx = wm.getContext("2d")!;
  wctx.fillStyle = "#fff";
  wctx.fillRect(0, 0, wm.width, wm.height);
  wctx.fillStyle = "#000";
  for (const mask of show.wallMasks[out.wall] ?? []) {
    if (!mask.enabled || mask.points.length < 3) continue;
    wctx.beginPath();
    mask.points.forEach((p, i) => {
      const x = ((p.x - out!.slice.x0) / sw) * wm.width;
      const y = ((p.y - out!.slice.y0) / sh) * wm.height;
      i ? wctx.lineTo(x, y) : wctx.moveTo(x, y);
    });
    wctx.closePath();
    wctx.fill();
  }
  uploadCanvas(wallMaskTex, wm);

  // Output masks, drawn in screen space. GL reads row 0 at the bottom, so flip.
  const om = document.createElement("canvas");
  om.width = Math.max(1, Math.round(canvas.width / 2));
  om.height = Math.max(1, Math.round(canvas.height / 2));
  const octx = om.getContext("2d")!;
  octx.fillStyle = "#fff";
  octx.fillRect(0, 0, om.width, om.height);
  octx.fillStyle = "#000";
  octx.translate(0, om.height);
  octx.scale(1, -1);
  for (const mask of out.masks) {
    if (!mask.enabled || mask.points.length < 3) continue;
    octx.beginPath();
    mask.points.forEach((p, i) => (i ? octx.lineTo(p.x * om.width, p.y * om.height) : octx.moveTo(p.x * om.width, p.y * om.height)));
    octx.closePath();
    octx.fill();
  }
  uploadCanvas(outMaskTex, om);
  patternKey = "";
}

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(window.innerWidth * dpr);
  const h = Math.round(window.innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}
window.addEventListener("resize", resize);
resize();

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------
interface MediaEl {
  file: string;
  type: "video" | "image";
  el: HTMLVideoElement | HTMLImageElement;
  tex: WebGLTexture;
  ready: boolean;
  failed: boolean;
  /** Layer key using it, or "" when it is only preloaded. */
  owner: string;
  lastUpload: number;
}

const pool: MediaEl[] = [];
const missing = new Set<string>();
let worstDriftMs = 0;

function mediaUrl(file: string): string {
  return mediaBase + file.split("/").map(encodeURIComponent).join("/");
}

function createMedia(m: Media, owner: string): MediaEl {
  const file = m.file ?? "";
  const tex = makeTexture(gl);
  let el: HTMLVideoElement | HTMLImageElement;
  const entry: MediaEl = { file, type: m.type === "video" ? "video" : "image", el: null as any, tex, ready: false, failed: false, owner, lastUpload: -1 };
  if (m.type === "video") {
    const v = document.createElement("video");
    v.muted = true; // sound comes from the sound desk, not the projectors
    v.playsInline = true;
    v.preload = "auto";
    v.crossOrigin = "anonymous";
    v.addEventListener("loadeddata", () => (entry.ready = true));
    v.addEventListener("error", () => {
      entry.failed = true;
      missing.add(file);
    });
    v.src = mediaUrl(file);
    v.load();
    el = v;
  } else {
    const img = new Image();
    img.onload = () => {
      entry.ready = true;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    };
    img.onerror = () => {
      entry.failed = true;
      missing.add(file);
    };
    img.src = mediaUrl(file);
    el = img;
  }
  entry.el = el;
  pool.push(entry);
  return entry;
}

function releaseMedia(e: MediaEl): void {
  if (e.owner) {
    followers.delete(e.owner);
    shownAt.delete(e.owner);
  }
  const i = pool.indexOf(e);
  if (i >= 0) pool.splice(i, 1);
  if (e.el instanceof HTMLVideoElement) {
    e.el.pause();
    e.el.removeAttribute("src");
    e.el.load();
  }
  gl.deleteTexture(e.tex);
}

/** Find the media element for a layer, adopting a preloaded one if possible. */
function mediaFor(layer: Layer): MediaEl {
  const owned = pool.find((p) => p.owner === layer.key);
  if (owned) return owned;
  const pre = pool.find((p) => p.owner === "" && p.file === layer.media.file && !p.failed);
  if (pre) {
    pre.owner = layer.key;
    return pre;
  }
  return createMedia(layer.media, layer.key);
}

/** Keep media for live layers and the standby cue; drop the rest. */
function gcMedia(layers: Layer[]): void {
  const liveKeys = new Set(layers.map((l) => l.key));
  const wantPreload = show && state ? standbyMedia(state, show) : [];
  for (const p of [...pool]) {
    if (p.owner && !liveKeys.has(p.owner)) {
      // Layer finished: keep it as a preload if the standby cue wants the same file.
      if (wantPreload.some((m) => m.file === p.file) && !pool.some((q) => q !== p && q.owner === "" && q.file === p.file)) {
        followers.delete(p.owner);
        shownAt.delete(p.owner);
        p.owner = "";
        if (p.el instanceof HTMLVideoElement) {
          p.el.pause();
          p.el.currentTime = 0;
        }
      } else releaseMedia(p);
    } else if (!p.owner && !wantPreload.some((m) => m.file === p.file)) releaseMedia(p);
  }
  for (const m of wantPreload) {
    if (!m.file || pool.some((p) => p.owner === "" && p.file === m.file)) continue;
    createMedia(m, "");
  }
}

const followers = new Map<string, VideoFollower>();
/** Master time each layer first became visible on this output (for the wall-sync check). */
const shownAt = new Map<string, number>();

/** Keep a video on the master timeline (see VideoFollower). Returns whether to draw it. */
function syncVideo(v: HTMLVideoElement, layer: Layer, now: number): boolean {
  let f = followers.get(layer.key);
  if (!f) {
    f = new VideoFollower(v, { startAt: layer.startAt, playMode: layer.playMode });
    followers.set(layer.key, f);
  }
  f.update(now);
  if (now < layer.startAt) return false;
  worstDriftMs = Math.max(worstDriftMs, Math.abs(f.driftMs));
  // "Play once" goes black at the end; loop and hold keep showing.
  return videoTimeAt(layer, now, v.duration).visible;
}

/** What this output is showing right now, for the operator's wall-sync check. */
function playbackReports(now: number): PlaybackReport[] {
  if (!out || !show || !state || state.blackout) return [];
  const reports: PlaybackReport[] = [];
  for (const layer of state.walls[out.wall] ?? []) {
    if (layer.fadeOutAt !== null) continue;
    const m = pool.find((p) => p.owner === layer.key);
    const f = followers.get(layer.key);
    reports.push({
      key: layer.key,
      cueId: layer.cueId,
      cueNumber: show.cues.find((c) => c.id === layer.cueId)?.number,
      wall: out.wall,
      mediaType: layer.media.type,
      startAt: layer.startAt,
      shownAt: shownAt.get(layer.key) ?? null,
      sampledAt: now,
      ...(f ? f.report() : {}),
      ...(m?.failed ? { error: `could not load ${m.file}` } : {}),
    });
  }
  return reports;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function drawQuad(x0: number, y0: number, x1: number, y1: number): void {
  // Coordinates in slice-normalised space (0..1, y down) -> clip space.
  const pos = new Float32Array([x0 * 2 - 1, 1 - y0 * 2, x1 * 2 - 1, 1 - y0 * 2, x0 * 2 - 1, 1 - y1 * 2, x1 * 2 - 1, 1 - y1 * 2]);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadPos);
  gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
  bindAttr(contentProg, "aPos", quadPos);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadUv);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.DYNAMIC_DRAW);
  bindAttr(contentProg, "aUv", quadUv);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/** Media rectangle on the wall canvas (feet) for the cue's fit mode. */
function fitRect(fit: Layer["fit"], mw: number, mh: number, W: number, H: number): [number, number, number, number] {
  if (fit === "stretch" || !(mw > 0) || !(mh > 0)) return [0, 0, W, H];
  const sc = fit === "cover" ? Math.max(W / mw, H / mh) : Math.min(W / mw, H / mh);
  const w = mw * sc;
  const h = mh * sc;
  return [(W - w) / 2, (H - h) / 2, (W + w) / 2, (H + h) / 2];
}

function renderContent(now: number, pattern: TestPattern | null): void {
  if (!out || !show || !sliceTarget || !state) return;
  gl.bindFramebuffer(gl.FRAMEBUFFER, sliceTarget.fb);
  gl.viewport(0, 0, sliceTarget.w, sliceTarget.h);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(contentProg);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE); // additive: crossfades are true dissolves
  const uUseTex = gl.getUniformLocation(contentProg, "uUseTex");
  const uColor = gl.getUniformLocation(contentProg, "uColor");
  const uOpacity = gl.getUniformLocation(contentProg, "uOpacity");
  gl.uniform1i(gl.getUniformLocation(contentProg, "uTex"), 0);
  gl.activeTexture(gl.TEXTURE0);

  if (pattern) {
    const key = JSON.stringify([pattern, out.name, out.color, out.slice, out.wall, sliceTarget.w]);
    if (key !== patternKey) {
      patternKey = key;
      const c = document.createElement("canvas");
      c.width = Math.min(2560, sliceTarget.w);
      c.height = Math.max(1, Math.round((c.width * sliceTarget.h) / sliceTarget.w));
      drawTestPattern(c.getContext("2d")!, c.width, c.height, out, pattern);
      uploadCanvas(patternTex, c);
    }
    gl.bindTexture(gl.TEXTURE_2D, patternTex);
    gl.uniform1f(uUseTex, 1);
    gl.uniform1f(uOpacity, 1);
    drawQuad(0, 0, 1, 1);
    gl.disable(gl.BLEND);
    return;
  }

  const wall = show.walls[out.wall];
  const s = out.slice;
  const sw = s.x1 - s.x0;
  const sh = s.y1 - s.y0;
  const layers = state.walls[out.wall] ?? [];
  for (const layer of layers) {
    const op = layerOpacity(layer, now);
    if (op <= 0.001 && now >= layer.startAt) continue;
    if (layer.media.type === "color") {
      gl.uniform1f(uUseTex, 0);
      gl.uniform3fv(uColor, hexToRgb(layer.media.color));
      gl.uniform1f(uOpacity, op);
      drawQuad(0, 0, 1, 1);
      if (op > 0 && !shownAt.has(layer.key)) shownAt.set(layer.key, now);
      continue;
    }
    if (layer.media.type !== "video" && layer.media.type !== "image") continue;
    const m = mediaFor(layer);
    if (m.failed || !m.ready) continue;
    let mw = 0,
      mh = 0;
    if (m.el instanceof HTMLVideoElement) {
      const v = m.el;
      const visible = syncVideo(v, layer, now);
      if (!visible || v.readyState < 2) continue;
      mw = v.videoWidth;
      mh = v.videoHeight;
      gl.bindTexture(gl.TEXTURE_2D, m.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
    } else {
      mw = m.el.naturalWidth;
      mh = m.el.naturalHeight;
      gl.bindTexture(gl.TEXTURE_2D, m.tex);
    }
    if (op <= 0.001) continue;
    const [fx0, fy0, fx1, fy1] = fitRect(layer.fit, mw, mh, wall.width, wall.height);
    gl.uniform1f(uUseTex, 1);
    gl.uniform1f(uOpacity, op);
    drawQuad((fx0 - s.x0) / sw, (fy0 - s.y0) / sh, (fx1 - s.x0) / sw, (fy1 - s.y0) / sh);
    if (!shownAt.has(layer.key)) shownAt.set(layer.key, now);
  }
  gl.disable(gl.BLEND);
}

function renderWarp(): void {
  if (!out || !sliceTarget) return;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(warpProg);
  bindAttr(warpProg, "aPos", meshPos);
  bindAttr(warpProg, "aUv", meshUv);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIdx);
  const u = (n: string) => gl.getUniformLocation(warpProg, n);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sliceTarget.tex);
  gl.uniform1i(u("uContent"), 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, wallMaskTex);
  gl.uniform1i(u("uWallMask"), 1);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, outMaskTex);
  gl.uniform1i(u("uOutMask"), 2);
  gl.uniform2f(u("uRes"), canvas.width, canvas.height);
  gl.uniform4f(u("uSlice"), out.slice.x0, out.slice.y0, out.slice.x1, out.slice.y1);
  const e = (n: string, b: OutputConfig["blend"]["left"]) => gl.uniform3f(u(n), b.width, b.curve, b.gamma);
  e("uBlendW", out.blend.left);
  e("uBlendE", out.blend.right);
  e("uBlendN", out.blend.top);
  e("uBlendS", out.blend.bottom);
  gl.uniform1f(u("uBrightness"), out.brightness);
  gl.uniform3f(u("uRgb"), out.rgb[0], out.rgb[1], out.rgb[2]);
  gl.drawElements(gl.TRIANGLES, meshCount, gl.UNSIGNED_SHORT, 0);
  gl.activeTexture(gl.TEXTURE0);
}

function black(): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

// ---------------------------------------------------------------------------
// Frame loop + stats
// ---------------------------------------------------------------------------
let frames = 0;
let dropped = 0;
let lastFrame = 0;
let frameBudget = 1000 / 60;
const deltas: number[] = [];
let contextLost = false;

function frame(t: number): void {
  requestAnimationFrame(frame);
  if (lastFrame) {
    const d = t - lastFrame;
    deltas.push(d);
    if (deltas.length > 120) deltas.shift();
    if (d > frameBudget * 1.5 && d < 1000) dropped += Math.round(d / frameBudget) - 1;
  }
  lastFrame = t;
  frames++;
  if (contextLost) return;
  try {
    resize();
    if (!out || !show || !state || state.blackout) {
      // Release videos during a blackout so nothing keeps playing underneath.
      if (state?.blackout) gcMedia([]);
      black();
      return;
    }
    rebuildGeometry();
    const now = masterNow();
    const layers = state.walls[out.wall] ?? [];
    gcMedia(layers);
    renderContent(now, state.testPatterns[out.id] ?? null);
    renderWarp();
  } catch (err) {
    console.error(err);
    black();
  }
}
requestAnimationFrame(frame);

setInterval(() => {
  if (deltas.length > 10) {
    const sorted = [...deltas].sort((a, b) => a - b);
    frameBudget = Math.max(4, sorted[Math.floor(sorted.length / 2)]);
  }
  window.api.send("output:status", {
    outputId,
    fps: frames,
    droppedFrames: dropped,
    missingMedia: [...missing],
    open: true,
    driftMs: Math.round(worstDriftMs),
  });
  frames = 0;
  worstDriftMs = 0;
}, 1000);

setInterval(() => window.api.send("output:playback", playbackReports(masterNow())), 250);

canvas.addEventListener("webglcontextlost", (e) => {
  e.preventDefault();
  contextLost = true;
});
canvas.addEventListener("webglcontextrestored", () => location.reload());

// ---------------------------------------------------------------------------
// Messages from the main process
// ---------------------------------------------------------------------------
window.api.on("output:init", (msg: { outputId: string; show: Show; mediaBase: string }) => {
  show = msg.show;
  out = show.outputs.find((o) => o.id === outputId) ?? null;
  if (msg.mediaBase !== mediaBase) {
    mediaBase = msg.mediaBase;
    for (const p of [...pool]) releaseMedia(p);
    missing.clear();
  }
  // A file that was missing may have been copied in since: let it retry.
  for (const p of [...pool]) if (p.failed) releaseMedia(p);
  missing.clear();
  if (out) document.title = `Output: ${out.name}`;
});
window.api.on("output:state", (s: PlaybackState) => {
  state = s;
});
window.api.on("output:clock", (offset: number) => {
  clockOffset = offset;
});
window.api.send("output:ready");
