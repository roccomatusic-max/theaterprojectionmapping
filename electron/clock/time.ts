/**
 * Local time source for the sync system.
 *
 * Uses a monotonic timer anchored to the wall clock once at startup, so the
 * show never jumps if Windows/macOS adjusts the system clock mid-show.
 * Values are milliseconds and look like Date.now() values.
 */
const anchorWall = Date.now();
const anchorMono = performance.now();

export type Now = () => number;

export const localNow: Now = () => anchorWall + (performance.now() - anchorMono);
