import { EventStore } from "applesauce-core/event-store";
import { getSeenRelays } from "applesauce-core/helpers";
// Imported for its side effects: `applesauce-common` augments the store prototype with
// `blossomServers()`, `mutes()` and friends. Without this they are undefined at runtime,
// with no type error to warn us.
import "applesauce-common/models";
import { verifyEvent } from "nostr-tools/pure";
import { isEventWithinLimits } from "../event-limits.js";

/**
 * The one application-wide event store.
 *
 * The verifier enforces the platform's size limits as well as the signature, because loaders and
 * casts insert here directly; a check that lived only in {@link ingress} would not cover them.
 */
export const eventStore = new EventStore({
  verifyEvent: (event) => isEventWithinLimits(event) && verifyEvent(event)
});

/** Relay provenance recorded by Applesauce for one canonical stored event. */
export const getSeenRelaysForEvent = (eventId: string): readonly string[] => {
  const event = eventStore.getEvent(eventId);
  return event ? [...(getSeenRelays(event) ?? [])].sort() : [];
};
