/// <reference types="node" />
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { FollowerShowClock, MasterShowClock, type ClockMsg } from "../electron/clock";
import { localNow } from "../electron/clock/time";
import { DEFAULT_NODE_PORT, Link } from "../electron/net/link";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

/** A wall computer: listens for the operator like the app's render nodes, with a wrong clock. */
async function startWall(name: string, skewMs: number) {
  const clock = new FollowerShowClock(undefined, { name, now: () => localNow() + skewMs });
  const server = net.createServer((sock) => {
    const link = new Link(sock, "operator");
    clock.attach((m) => link.send(m));
    link.onMessage((msg) => msg.type.startsWith("clock.") && clock.handleMessage(msg));
    sock.on("close", () => clock.detach());
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  cleanup.push(() => {
    clock.dispose();
    server.close();
  });
  return { clock, port: (server.address() as net.AddressInfo).port };
}

/** The operator connects out to each wall over the real Link. */
async function connect(master: MasterShowClock, peerId: string, port: number) {
  const sock = net.connect(port, "127.0.0.1");
  await new Promise<void>((r) => sock.once("connect", () => r()));
  const link = new Link(sock, peerId);
  link.onMessage((msg, l) => msg.type.startsWith("clock.") && master.handleMessage(msg, (m) => l.send(m), l.peerId));
  sock.on("close", () => master.peerDisconnected(peerId));
  cleanup.push(() => sock.destroy());
  return sock;
}

describe("master clock over the operator link", () => {
  it("keeps two wall computers with wrong clocks in step with the operator", async () => {
    expect(DEFAULT_NODE_PORT).toBeGreaterThan(0);
    const master = new MasterShowClock();
    // Left wall's clock is 5 s fast, right wall's is 3.2 s slow.
    const left = await startWall("Left wall", 5000);
    const right = await startWall("Right wall", -3200);
    const leftSock = await connect(master, "left", left.port);
    await connect(master, "right", right.port);
    await wait(1500);

    for (const w of [left, right]) {
      expect(Math.abs(w.clock.now() - master.now())).toBeLessThan(2);
      expect(w.clock.status().synced).toBe(true);
    }

    // Operator presses play: both walls start the show clock together.
    master.command({ type: "play" });
    await wait(300);
    const m = master.showTime();
    expect(m).toBeGreaterThan(200);
    expect(Math.abs(left.clock.showTime() - m)).toBeLessThan(2);
    expect(Math.abs(right.clock.showTime() - m)).toBeLessThan(2);

    master.command({ type: "pause" });
    await wait(100);
    expect(left.clock.showTime()).toBe(master.showTime());
    expect(right.clock.showTime()).toBe(master.showTime());

    master.command({ type: "seek", ms: 60_000 });
    await wait(100);
    expect(left.clock.showTime()).toBe(60_000);
    expect(right.clock.status().showTimeMs).toBe(60_000);

    // The operator panel sees both walls and their sync quality.
    const nodes = master.status().nodes!;
    expect(nodes.map((n) => n.name)).toEqual(["Left wall", "Right wall"]);
    for (const n of nodes) {
      expect(n.state).toBe("locked");
      expect(n.errorMs).toBeLessThan(4);
    }

    // A wall dropping off shows as lost straight away.
    leftSock.destroy();
    await wait(100);
    expect(master.status().nodes!.find((n) => n.peerId === "left")!.state).toBe("lost");
  });

  it("stays accurate on a jittery network", async () => {
    const master = new MasterShowClock();
    const wall = new FollowerShowClock(undefined, {
      name: "Wall",
      now: () => localNow() + 777,
      fastIntervalMs: 10,
      intervalMs: 10,
    });
    let seed = 3;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    // Each direction randomly takes 0-15 ms, like a busy switch.
    const delay = (fn: () => void) => setTimeout(fn, rand() < 0.5 ? rand() * 15 : rand());
    const toWall = (m: object) => delay(() => wall.handleMessage(m as ClockMsg));
    wall.attach((m) => delay(() => master.handleMessage(m as ClockMsg, toWall, "w")));
    await wait(1500);
    wall.detach();
    expect(Math.abs(wall.now() - master.now())).toBeLessThan(3);
  });

  it("picks up a restarted operator app", async () => {
    let master = new MasterShowClock();
    const wall = new FollowerShowClock(undefined, { name: "Wall" });
    const attach = () => {
      const toWall = (m: object) => setImmediate(() => wall.handleMessage(m as ClockMsg));
      wall.attach((m) => setImmediate(() => master.handleMessage(m as ClockMsg, toWall, "w")));
    };
    attach();
    await wait(200);
    master.command({ type: "seek", ms: 90_000 });
    await wait(50);
    expect(wall.showTime()).toBe(90_000);

    master = new MasterShowClock(); // show clock back at 0
    attach();
    await wait(200);
    wall.detach();
    expect(wall.showTime()).toBe(0);
  });
});
