// Minimal OSC 1.0 decoder (enough for /go, /back, /cue/5, /blackout from a lighting
// console or QLab). Supports int32, float32, string args and bundles.

export interface OscMessage {
  address: string;
  args: (number | string)[];
}

function readString(b: Uint8Array, off: number): [string, number] {
  let end = off;
  while (end < b.length && b[end] !== 0) end++;
  const s = new TextDecoder().decode(b.subarray(off, end));
  const next = (end + 4) & ~3; // include the terminating NUL, pad to 4
  return [s, next];
}

export function parseOsc(b: Uint8Array): OscMessage[] {
  const out: OscMessage[] = [];
  parseInto(b, out, 0);
  return out;
}

function parseInto(b: Uint8Array, out: OscMessage[], depth: number): void {
  if (b.length < 4 || depth > 4) return;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const [address, off0] = readString(b, 0);
  if (address === "#bundle") {
    let off = off0 + 8; // skip timetag
    while (off + 4 <= b.length) {
      const size = dv.getInt32(off);
      off += 4;
      if (size <= 0 || off + size > b.length) break;
      parseInto(b.subarray(off, off + size), out, depth + 1);
      off += size;
    }
    return;
  }
  if (!address.startsWith("/")) return;
  const args: (number | string)[] = [];
  let off = off0;
  if (off < b.length && b[off] === 0x2c /* , */) {
    const [tags, afterTags] = readString(b, off);
    off = afterTags;
    for (const t of tags.slice(1)) {
      if (t === "i") {
        if (off + 4 > b.length) break;
        args.push(dv.getInt32(off));
        off += 4;
      } else if (t === "f") {
        if (off + 4 > b.length) break;
        args.push(dv.getFloat32(off));
        off += 4;
      } else if (t === "s") {
        const [s, n] = readString(b, off);
        args.push(s);
        off = n;
      }
    }
  }
  out.push({ address, args });
}

export type OscAction =
  | { kind: "go" }
  | { kind: "back" }
  | { kind: "blackout" }
  | { kind: "cue"; number: string };

/** /go, /back, /blackout (or /panic), /cue/5 or /cue "5". Case-insensitive. */
export function oscToAction(m: OscMessage): OscAction | null {
  const a = m.address.toLowerCase().replace(/\/+$/, "");
  if (a === "/go") return { kind: "go" };
  if (a === "/back") return { kind: "back" };
  if (a === "/blackout" || a === "/panic") return { kind: "blackout" };
  const cm = a.match(/^\/cue\/(.+)$/);
  if (cm) return { kind: "cue", number: decodeURIComponent(m.address.replace(/\/+$/, "").slice(5)) };
  if (a === "/cue" && m.args.length) return { kind: "cue", number: String(m.args[0]) };
  return null;
}

/** Encode a simple OSC message (used by tests and the "send test OSC" helper). */
export function encodeOsc(address: string, args: (number | string)[] = []): Uint8Array {
  const parts: number[] = [];
  const pushStr = (s: string) => {
    const bytes = new TextEncoder().encode(s);
    parts.push(...bytes, 0);
    while (parts.length % 4) parts.push(0);
  };
  pushStr(address);
  pushStr("," + args.map((a) => (typeof a === "string" ? "s" : Number.isInteger(a) ? "i" : "f")).join(""));
  for (const a of args) {
    if (typeof a === "string") pushStr(a);
    else {
      const buf = new ArrayBuffer(4);
      const dv = new DataView(buf);
      if (Number.isInteger(a)) dv.setInt32(0, a);
      else dv.setFloat32(0, a);
      parts.push(...new Uint8Array(buf));
    }
  }
  return new Uint8Array(parts);
}
