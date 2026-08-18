import type { EventStore } from "applesauce-core/event-store";
import type { NostrEvent } from "applesauce-core/helpers/event";

export type VerifyNostrEvent = (event: NostrEvent) => boolean;
export interface EventIngress {
  verify(event: NostrEvent): boolean;
  admit(event: NostrEvent, observedRelay: string): NostrEvent | null;
}

function plainEvent(event: NostrEvent): NostrEvent {
  return {
    id: event.id, pubkey: event.pubkey, created_at: event.created_at, kind: event.kind,
    tags: event.tags.map((tag) => [...tag]), content: event.content, sig: event.sig
  };
}

export function createEventIngress(store: EventStore, verify: VerifyNostrEvent): EventIngress {
  return {
    verify: (event) => verify(plainEvent(event)),
    admit(event, observedRelay) {
    // Relay input must never inherit library verification/cache symbols.
    const canonical = plainEvent(event);
    if (!verify(canonical)) return null;
    return store.add(canonical, observedRelay);
  } };
}
