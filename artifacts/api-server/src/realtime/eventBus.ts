import { EventEmitter } from "node:events";
import type { AnyServerEvent } from "./protocol";

/**
 * Realtime event bus.
 *
 * The event payload type is the single source of truth declared in
 * `realtime/protocol.ts` (`AnyServerEvent`) and is shared with the browser
 * client. Publishers and subscribers must use the same discriminated union so
 * that adding a new topic/type causes a typecheck failure everywhere it is
 * consumed.
 *
 * Topic naming convention:
 *   wallet:{userId}            – wallet/balance changes for a single user
 *   notifications:{userId}     – new notifications for a single user
 *   bets:global                – every placed/settled bet (live feed)
 *   rounds:lunar               – per-round result summary (authoritative)
 *   withdrawals:admin          – withdrawal lifecycle events for operators
 *   admin:metrics              – "bump" hints for the admin dashboard
 *   agent:{agentUserId}        – commission + new-player events per agent
 *   banners:active             – banner activation/deactivation
 */
export type RealtimeEvent = AnyServerEvent;

class RealtimeBus extends EventEmitter {
  publish(ev: RealtimeEvent) {
    this.emit(ev.topic, ev);
    this.emit("*", ev);
  }
  subscribe(topic: string, listener: (ev: RealtimeEvent) => void) {
    this.on(topic, listener);
    return () => this.off(topic, listener);
  }
}

// Export a process-wide singleton so any service module can publish.
export const bus: RealtimeBus = new RealtimeBus();
bus.setMaxListeners(0); // many clients may subscribe simultaneously
