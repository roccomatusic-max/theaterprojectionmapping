// Clock factory used by electron/main.ts. The master clock work owns this folder.
//
// Contract with the rest of the app:
//  - main.ts calls createMasterClock() on the operator and createFollowerClock(...)
//    on a render node once the operator link is up.
//  - Every incoming message whose type starts with "clock." is passed to
//    clock.handleMessage(msg, reply, peerId) synchronously, straight from the link.
//  - main.ts sends {type:"clockStatus"} to the operator UI every 250 ms using
//    clock.status(), and sends each output window the master-minus-local offset
//    (clock.now() - Date.now()) so video playback follows the master timeline.

import { LocalClock, ShowClock } from "../../src/shared/clock";

export function createMasterClock(): ShowClock {
  return new LocalClock("master");
}

/** @param send sends a message to the operator over the link. */
export function createFollowerClock(_send: (msg: object) => void): ShowClock {
  return new LocalClock("follower");
}
