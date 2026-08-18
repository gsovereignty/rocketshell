import type { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import type { PublishResponse } from "applesauce-relay";
import type { AccountController } from "./accounts.js";
import type { EventIngress } from "./event-ingress.js";
import { NOOP_TELEMETRY, type PlatformTelemetry } from "@project/platform-nap-contract";

export interface PublishTarget {
  publish(relays: string[], event: NostrEvent, options?: { timeout?: number | boolean; retries?: number | boolean }): Promise<PublishResponse[]>;
}
export interface PublicationResult { readonly event: NostrEvent; readonly outcomes: readonly PublishResponse[]; readonly accepted: number }

export interface RelayPublisher {
  publishTemplate(relays: readonly string[], template: EventTemplate): Promise<PublicationResult>;
  publishSigned(relays: readonly string[], event: NostrEvent): Promise<PublicationResult>;
}

export function createRelayPublisher(target: PublishTarget, accounts: AccountController, ingress: EventIngress, minimumAccepted = 1, telemetry: PlatformTelemetry = NOOP_TELEMETRY): RelayPublisher {
  const publishSigned = async (relays: readonly string[], event: NostrEvent): Promise<PublicationResult> => {
    if (!ingress.verify(event)) throw new Error("invalid-event");
    const outcomes = await target.publish([...relays], event, { retries: false });
    for (const outcome of outcomes) telemetry.record("publication.outcome", outcome.ok ? 1 : 0, { relay: outcome.from });
    const accepted = outcomes.filter((outcome) => outcome.ok).length;
    if (accepted < minimumAccepted) { telemetry.record("publication.failed", 1, { relayCount: relays.length }); throw new Error("publish-rejected"); }
    ingress.admit(event, outcomes.find((outcome) => outcome.ok)?.from ?? "local:publish");
    return { event, outcomes, accepted };
  };
  return {
    async publishTemplate(relays, template) { return publishSigned(relays, await accounts.sign(template)); },
    publishSigned
  };
}
