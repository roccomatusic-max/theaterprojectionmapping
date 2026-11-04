// Optional OSC input so a lighting console or QLab can trigger cues.
// Listens on UDP: /go, /back, /blackout (or /panic), /cue/5 or /cue "5".

import dgram from "node:dgram";
import { OscAction, oscToAction, parseOsc } from "../src/shared/osc";

export class OscListener {
  private sock: dgram.Socket | null = null;
  private port = 0;
  lastMessage = "";
  error = "";

  constructor(private readonly onAction: (a: OscAction, raw: string) => void) {}

  configure(enabled: boolean, port: number): void {
    if (!enabled) return this.stop();
    if (this.sock && this.port === port) return;
    this.stop();
    this.port = port;
    this.error = "";
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    sock.on("message", (buf) => {
      for (const m of parseOsc(new Uint8Array(buf))) {
        const raw = `${m.address} ${m.args.join(" ")}`.trim();
        this.lastMessage = raw;
        const a = oscToAction(m);
        if (a) this.onAction(a, raw);
      }
    });
    sock.on("error", (e) => {
      this.error = e.message;
      this.stop();
    });
    sock.bind(port, "0.0.0.0");
    this.sock = sock;
  }

  stop(): void {
    try {
      this.sock?.close();
    } catch {
      /* already closed */
    }
    this.sock = null;
    this.port = 0;
  }

  get listening(): boolean {
    return this.sock !== null;
  }
}
