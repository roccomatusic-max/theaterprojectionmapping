// Shared data model for the Planner (room + projectors) and the Player (show file).
// All lengths are stored in FEET. The UI converts to metres when the metric toggle is on.

export type WallId = "left" | "right";
export const WALL_IDS: WallId[] = ["left", "right"];

export interface Vec2 {
  x: number;
  y: number;
}
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type Units = "imperial" | "metric";

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------
//
// Room coordinates (top-down): origin at the centre of the stage edge.
// +x points to house right (the right-hand side of the drawing when the stage is
// at the top), +y points from the stage towards the back wall, +z is up from the floor.
// "Left wall" is house left.

export interface WallLine {
  /** End nearest the stage. */
  start: Vec2;
  /** End at the back of the room. */
  end: Vec2;
}

export interface Room {
  frontWidth: number;
  backWidth: number;
  length: number;
  wallHeight: number;
  /** Optional per-wall endpoint overrides; when null the wall follows the trapezoid. */
  wallOverrides: Record<WallId, WallLine | null>;
}

export interface Audience {
  /** Seating outline on the floor, room coordinates (feet). */
  outline: Vec2[];
  seatedHeadHeight: number;
  standingHeadHeight: number;
}

export interface Projector {
  id: string;
  name: string;
  /** Lens position, room coordinates. */
  x: number;
  y: number;
  mountHeight: number;
  /** Degrees. 0 = facing the stage, +90 = facing house right. */
  pan: number;
  /** Degrees. Positive tilts the lens up. */
  tilt: number;
  /** Degrees. Positive rolls the image clockwise as seen from behind the projector. */
  roll: number;
  lumens: number;
  resolutionW: number;
  resolutionH: number;
  /** Current throw ratio (throw distance / image width). */
  throwRatio: number;
  throwRatioMin: number;
  throwRatioMax: number;
  /** Lens shift as % of image height / width. +V moves the image up, +H to the right. */
  lensShiftV: number;
  lensShiftH: number;
  targetWall: WallId;
  /** Colour used in the views. */
  color: string;
}

export type ObstructionKind = "exit-sign" | "door" | "speaker" | "sconce" | "other";

export interface Obstruction {
  id: string;
  wall: WallId;
  kind: ObstructionKind;
  label: string;
  /** Distance along the wall from its stage end to the edge nearest the stage. */
  fromStage: number;
  /** Height of the bottom edge above the floor. */
  bottom: number;
  width: number;
  height: number;
  neverProject: boolean;
}

export interface WallSurface {
  gain: number;
  color: string;
}

export interface Plan {
  version: 1;
  name: string;
  units: Units;
  room: Room;
  audience: Audience;
  projectors: Projector[];
  surfaces: Record<WallId, WallSurface>;
  obstructions: Obstruction[];
  /** Real-world light loss multiplier (aged lamp, lens, dust). */
  derate: number;
  /** Brightness thresholds for the heat map, foot-lamberts. */
  goodFL: number;
  okFL: number;
}

// ---------------------------------------------------------------------------
// Player / show file
// ---------------------------------------------------------------------------
//
// Each wall has a "wall canvas": the whole wall as one image, seen from inside the
// room. Canvas coordinates are feet, x from the left edge as seen from inside the
// room, y from the top edge. Each output shows a rectangular slice of its wall's
// canvas, warped onto the projector image.

export interface WallCanvas {
  /** Wall length in feet (canvas width). */
  width: number;
  /** Wall height in feet (canvas height). */
  height: number;
  /** Render resolution of the canvas in pixels per foot. */
  pixelsPerFoot: number;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface BlendEdge {
  /** Width of the ramp in wall feet. 0 = off. */
  width: number;
  /** Shape of the ramp, 1 = linear, 2 = S-curve (typical), up to 4. */
  curve: number;
  /** Projector gamma used to linearise the ramp (typ. 2.2). */
  gamma: number;
}

export interface Mesh {
  cols: number;
  rows: number;
  /** (rows) x (cols) control-point offsets in output-normalised units, row-major. */
  offsets: Vec2[];
}

export interface MaskPolygon {
  id: string;
  name: string;
  points: Vec2[];
  /** Came from a Planner obstruction: drawn in red and cannot be deleted while show mode is on. */
  fromObstruction?: string;
  enabled: boolean;
}

export type TestPattern = "grid" | "crosshatch" | "bars" | "white" | "black" | "label";

export interface OutputConfig {
  id: string;
  name: string;
  wall: WallId;
  /** "local" or the id of a render node. */
  node: string;
  /** Electron display id on that machine, or null when unassigned. */
  displayId: number | null;
  width: number;
  height: number;
  /** Part of the wall canvas this output shows (feet). */
  slice: Rect;
  /** Where the slice corners land in the output, normalised 0..1: TL, TR, BR, BL. */
  corners: [Vec2, Vec2, Vec2, Vec2];
  mesh: Mesh;
  blend: { left: BlendEdge; right: BlendEdge; top: BlendEdge; bottom: BlendEdge };
  brightness: number;
  rgb: [number, number, number];
  /** Masks in output-normalised coordinates. */
  masks: MaskPolygon[];
  color: string;
}

export interface RenderNodeConfig {
  id: string;
  name: string;
  host: string;
  port: number;
}

export type MediaType = "video" | "image" | "color" | "black";

export interface Media {
  type: MediaType;
  /** Path relative to the media folder (video/image). */
  file?: string;
  /** CSS colour (color). */
  color?: string;
}

export type PlayMode = "loop" | "once" | "hold";
export type Fit = "cover" | "contain" | "stretch";

export interface Cue {
  id: string;
  number: string;
  name: string;
  walls: WallId[];
  media: Media;
  playMode: PlayMode;
  fit: Fit;
  /** Seconds. */
  fadeIn: number;
  /** Seconds. How long this cue's content takes to fade when something replaces it. */
  fadeOut: number;
  autoFollow: boolean;
  /** Seconds after this cue fires before the next cue fires (when autoFollow). */
  followDelay: number;
  notes?: string;
}

export interface OscSettings {
  enabled: boolean;
  port: number;
}

export interface Show {
  version: 1;
  name: string;
  walls: Record<WallId, WallCanvas>;
  /** Masks in wall-canvas feet (exit signs etc). */
  wallMasks: Record<WallId, MaskPolygon[]>;
  nodes: RenderNodeConfig[];
  outputs: OutputConfig[];
  cues: Cue[];
  osc: OscSettings;
}

// ---------------------------------------------------------------------------
// Runtime playback state (computed on the operator, sent to every output)
// ---------------------------------------------------------------------------

export interface Layer {
  /** Unique per firing so a re-fired cue restarts. */
  key: string;
  cueId: string;
  media: Media;
  playMode: PlayMode;
  fit: Fit;
  /** Master-clock ms when the layer starts (video frame 0, fade-in start). */
  startAt: number;
  fadeInMs: number;
  /** Master-clock ms when this layer starts fading out (null = still live). */
  fadeOutAt: number | null;
  fadeOutMs: number;
}

export interface PlaybackState {
  /** Increments on every change. */
  seq: number;
  walls: Record<WallId, Layer[]>;
  /** Index of the cue that fired last (-1 = none). */
  currentIndex: number;
  /** Index of the cue that GO will fire next. */
  standbyIndex: number;
  /** Master-clock ms of the last panic, outputs are black while blackoutAt is set. */
  blackout: boolean;
  testPatterns: Record<string, TestPattern | null>;
  /** Per-output "show blend/masks on test pattern". */
}

export interface DisplayInfo {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  size: { width: number; height: number };
  scaleFactor: number;
  primary: boolean;
}

export interface OutputStatus {
  outputId: string;
  fps: number;
  droppedFrames: number;
  missingMedia: string[];
  open: boolean;
  /** Last measured video drift in ms (worst layer). */
  driftMs: number;
}

export interface NodeStatus {
  id: string;
  name: string;
  host: string;
  connected: boolean;
  displays: DisplayInfo[];
  lastSeen: number | null;
  error?: string;
}
