import type { EventStore } from "applesauce-core/event-store";
import type { NostrEvent } from "applesauce-core/helpers/event";
import { isReplaceable } from "applesauce-core/helpers";
import { NOOP_TELEMETRY, type PlatformTelemetry } from "@project/platform-nap-contract";
import { isEventWithinLimits } from "./event-limits.js";

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

export function createEventIngress(store: EventStore, verify: VerifyNostrEvent, telemetry: PlatformTelemetry = NOOP_TELEMETRY): EventIngress {
  return {
    verify: (event) => isEventWithinLimits(event) && verify(plainEvent(event)),
    admit(event, observedRelay) {
    const kind = event && typeof event === "object" && typeof event.kind === "number" ? event.kind : -1;
    telemetry.record("event.received", 1, { relay: observedRelay, kind });
    if (!isEventWithinLimits(event)) { telemetry.record("event.rejected", 1, { reason: "limits", kind }); return null; }
    // Relay input must never inherit library verification/cache symbols.
    const canonical = plainEvent(event);
    if (!verify(canonical)) { telemetry.record("event.rejected", 1, { reason: "signature", kind: event.kind }); return null; }
    const duplicate = store.hasEvent(canonical.id);
    const dTag = canonical.tags.find((tag) => tag[0] === "d")?.[1];
    const admitted = store.add(canonical, observedRelay);
    if (duplicate) telemetry.record("event.duplicate", 1, { kind: event.kind });
    if (canonical.kind === 5) telemetry.record("event.deleted", 1);
    const expiration = Number(canonical.tags.find((tag) => tag[0] === "expiration")?.[1]);
    if (Number.isFinite(expiration) && expiration <= Math.floor(Date.now() / 1_000)) telemetry.record("event.expired", 1);
    if (isReplaceable(canonical.kind) && store.getReplaceable(canonical.kind, canonical.pubkey, dTag)?.id !== canonical.id) {
      telemetry.record("event.replaceable-conflict", 1, { kind: canonical.kind });
    }
    if (admitted) telemetry.record("event.admitted", 1, { kind: event.kind });
    else telemetry.record("event.rejected", 1, { reason: "store-policy", kind: event.kind });
    return admitted;
  } };
}
