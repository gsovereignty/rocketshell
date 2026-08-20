import type { NostrEvent } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import type { GroupReqMessage } from "applesauce-relay";
import type { Observable, Subscription } from "rxjs";
import type { EventIngress } from "./event-ingress.js";
import { validateFilters } from "./request-limits.js";
import { NOOP_TELEMETRY, type PlatformTelemetry } from "@project/platform-nap-contract";

export interface RelayRequestSource {
  req(relays: string[], filters: Filter | Filter[]): Observable<GroupReqMessage>;
}

export interface RelayStreamCallbacks {
  readonly event: (event: NostrEvent) => void;
  /** Fired once, when every relay has answered or the timeout elapses. */
  readonly eose: () => void;
  readonly error?: (relay: string, error: unknown) => void;
}
export interface RelayStreamHandle { readonly closed: boolean; close(): void }

export function openRelayStream(source: RelayRequestSource, ingress: EventIngress, relays: readonly string[], filters: Filter | Filter[], callbacks: RelayStreamCallbacks, timeoutMs = 4_000, telemetry: PlatformTelemetry = NOOP_TELEMETRY): RelayStreamHandle {
  const selected = [...new Set(relays)];
  const validatedFilters = validateFilters(filters);
  const barriers = new Set<string>(); const delivered = new Set<string>();
  const startedAt = Date.now(); let firstEvent = false;
  let closed = false; let eoseSent = false; let subscription: Subscription | undefined;
  const emitEose = (partial: boolean): void => {
    if (closed || eoseSent) return;
    eoseSent = true;
    const elapsed = Date.now() - startedAt;
    telemetry.record("query.eose", elapsed, { partial });
    telemetry.record("query.completed", elapsed, { partial });
    callbacks.eose();
  };
  if (selected.length === 0) {
    emitEose(false);
    return {
      get closed() { return closed; },
      close() { closed = true; }
    };
  }
  const timer = setTimeout(() => emitEose(barriers.size < selected.length), timeoutMs);
  telemetry.record("subscription.active", 1, { relayCount: selected.length });
  const barrier = (relay: string): void => {
    if (!selected.includes(relay)) return;
    barriers.add(relay);
    if (barriers.size === selected.length) { clearTimeout(timer); emitEose(false); }
  };
  subscription = source.req(selected, validatedFilters).subscribe({
    next(message) {
      if (closed) { telemetry.record("callback.suppressed", 1, { operation: "relay-stream" }); return; }
      if (!message || typeof message !== "object" || typeof message.type !== "string") return;
      if (message.type === "EVENT" && typeof message.from === "string" && message.event && typeof message.event === "object") {
        if (!firstEvent) { firstEvent = true; telemetry.record("query.first-event", Date.now() - startedAt); }
        const admitted = ingress.admit(message.event, message.from);
        if (admitted && !delivered.has(admitted.id)) { delivered.add(admitted.id); callbacks.event(admitted); }
      } else if ((message.type === "EOSE" || message.type === "CLOSED") && typeof message.from === "string") barrier(message.from);
      else if (message.type === "ERROR" && typeof message.from === "string") { callbacks.error?.(message.from, message.error); barrier(message.from); }
    },
    error(error: unknown) {
      for (const relay of selected.filter((item) => !barriers.has(item))) callbacks.error?.(relay, error);
      for (const relay of selected) barrier(relay);
    }
  });
  return {
    get closed() { return closed; },
    close() {
      if (closed) return;
      closed = true; clearTimeout(timer); subscription?.unsubscribe();
      telemetry.record("subscription.active", -1, { relayCount: selected.length });
      telemetry.record("subscription.cleanup", 1, { operation: "relay-stream" });
    }
  };
}
