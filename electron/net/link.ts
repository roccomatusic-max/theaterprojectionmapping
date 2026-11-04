// Network link between the operator computer and the side-wall render nodes.
//
// Transport: plain TCP, one JSON message per line ("\n"-delimited). Render nodes
// listen on DEFAULT_NODE_PORT; the operator connects out to each node and reconnects
// automatically if a cable is pulled. Only small messages travel over the link
// (cues, alignment, status, small preview thumbnails), never video.
//
// Messages whose type starts with "clock." are handed to the ShowClock.

import net from "node:net";
import { EventEmitter } from "node:events";

export const DEFAULT_NODE_PORT = 47800;

export interface Msg {
  type: string;
  [k: string]: unknown;
}

export class Link extends EventEmitter {
  private buf = "";
  private closed = false;

  constructor(public readonly socket: net.Socket, public readonly peerId: string) {
    super();
    // Nagle's algorithm can delay small packets by ~40 ms, which ruins clock samples.
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 2000);
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.onData(chunk));
    socket.on("close", () => this.handleClose());
    socket.on("error", (err) => this.emit("error", err));
  }

  /** Register a handler. Called synchronously as soon as each line is parsed. */
  onMessage(fn: (msg: Msg, link: Link) => void): void {
    this.on("message", fn);
  }

  send(msg: Msg | object): boolean {
    if (this.closed || this.socket.destroyed) return false;
    try {
      this.socket.write(JSON.stringify(msg) + "\n");
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.socket.destroy();
    this.handleClose();
  }

  get isOpen(): boolean {
    return !this.closed && !this.socket.destroyed;
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (!line.trim()) continue;
      let msg: Msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // ignore garbage, never crash the show
      }
      if (msg && typeof msg.type === "string") this.emit("message", msg, this);
    }
    // Protect against a peer that never sends a newline.
    if (this.buf.length > 32 * 1024 * 1024) this.buf = "";
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit("close");
  }
}

/** Render-node side: accept connections from the operator. */
export function listen(port: number, onLink: (link: Link) => void): net.Server {
  const server = net.createServer((socket) => {
    const link = new Link(socket, `${socket.remoteAddress}:${socket.remotePort}`);
    onLink(link);
  });
  server.listen(port, "0.0.0.0");
  return server;
}

/**
 * Operator side: keep a connection open to one render node, reconnecting every
 * second while it is down.
 */
export class NodeConnection extends EventEmitter {
  link: Link | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  lastError: string | undefined;

  constructor(public readonly nodeId: string, public host: string, public port: number) {
    super();
    this.connect();
  }

  private connect(): void {
    if (this.stopped) return;
    const socket = net.connect({ host: this.host, port: this.port });
    socket.setTimeout(3000);
    socket.once("connect", () => {
      socket.setTimeout(0);
      const link = new Link(socket, this.nodeId);
      this.link = link;
      this.lastError = undefined;
      link.on("close", () => {
        this.link = null;
        this.emit("down");
        this.retry();
      });
      link.on("error", (e: Error) => (this.lastError = e.message));
      this.emit("up", link);
    });
    socket.once("timeout", () => socket.destroy(new Error("timed out")));
    socket.once("error", (e) => {
      this.lastError = e.message;
      if (!this.link) this.retry();
    });
  }

  private retry(): void {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect();
    }, 1000);
  }

  send(msg: Msg | object): boolean {
    return this.link?.send(msg) ?? false;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.link?.close();
  }
}
