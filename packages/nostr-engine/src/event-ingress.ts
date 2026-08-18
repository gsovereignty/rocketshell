import type { EventStore } from "applesauce-core/event-store";
import type { NostrEvent } from "applesauce-core/helpers/event";

export type VerifyNostrEvent = (event: NostrEvent) => boolean;
export interface EventIngress { admit(event: NostrEvent, observedRelay: string): NostrEvent | null }

export function createEventIngress(store: EventStore, verify: VerifyNostrEvent): EventIngress {
  return { admit(event, observedRelay) {
    // Relay input must never inherit library verification/cache symbols.
    const canonical: NostrEvent = {
      id: event.id,
      pubkey: event.pubkey,
      created_at: event.created_at,
      kind: event.kind,
      tags: event.tags.map((tag) => [...tag]),
      content: event.content,
      sig: event.sig
    };
    if (!verify(canonical)) return null;
    return store.add(canonical, observedRelay);
  } };
}
