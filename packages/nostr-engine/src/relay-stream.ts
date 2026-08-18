import type { NostrEvent } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import type { GroupReqMessage } from "applesauce-relay";
import type { Observable, Subscription } from "rxjs";
import type { EventIngress } from "./event-ingress.js";
import { validateFilters } from "./request-limits.js";

export interface RelayRequestSource {
  req(relays: string[], filters: Filter | Filter[]): Observable<GroupReqMessage>;
}

export interface AggregateEose { readonly partial: boolean; readonly pendingRelays: readonly string[] }
export interface RelayStreamCallbacks {
  readonly event: (event: NostrEvent) => void;
  readonly eose: (result: AggregateEose) => void;
  readonly error?: (relay: string, error: unknown) => void;
}
export interface RelayStreamHandle { readonly closed: boolean; close(): void }

export function openRelayStream(source: RelayRequestSource, ingress: EventIngress, relays: readonly string[], filters: Filter | Filter[], callbacks: RelayStreamCallbacks, timeoutMs = 4_000): RelayStreamHandle {
  const selected = [...new Set(relays)];
  const validatedFilters = validateFilters(filters);
  const barriers = new Set<string>(); const delivered = new Set<string>();
  let closed = false; let eoseSent = false; let subscription: Subscription | undefined;
  const emitEose = (partial: boolean): void => {
    if (closed || eoseSent) return;
    eoseSent = true;
    callbacks.eose({ partial, pendingRelays: selected.filter((relay) => !barriers.has(relay)) });
  };
  if (selected.length === 0) {
    emitEose(false);
    return {
      get closed() { return closed; },
      close() { closed = true; }
    };
  }
  const timer = setTimeout(() => emitEose(barriers.size < selected.length), timeoutMs);
  const barrier = (relay: string): void => {
    if (!selected.includes(relay)) return;
    barriers.add(relay);
    if (barriers.size === selected.length) { clearTimeout(timer); emitEose(false); }
  };
  subscription = source.req(selected, validatedFilters).subscribe({
    next(message) {
      if (closed) return;
      if (message.type === "EVENT") {
        const admitted = ingress.admit(message.event, message.from);
        if (admitted && !delivered.has(admitted.id)) { delivered.add(admitted.id); callbacks.event(admitted); }
      } else if (message.type === "EOSE" || message.type === "CLOSED") barrier(message.from);
      else if (message.type === "ERROR") { callbacks.error?.(message.from, message.error); barrier(message.from); }
    },
    error(error: unknown) {
      for (const relay of selected.filter((item) => !barriers.has(item))) callbacks.error?.(relay, error);
      for (const relay of selected) barrier(relay);
    }
  });
  return {
    get closed() { return closed; },
    close() { if (closed) return; closed = true; clearTimeout(timer); subscription?.unsubscribe(); }
  };
}
