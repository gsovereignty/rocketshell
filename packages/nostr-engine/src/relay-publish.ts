import type { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import type { PublishResponse } from "applesauce-relay";
import type { AccountController } from "./accounts.js";
import type { EventIngress } from "./event-ingress.js";

export interface PublishTarget {
  publish(relays: string[], event: NostrEvent, options?: { timeout?: number | boolean; retries?: number | boolean }): Promise<PublishResponse[]>;
}
export interface PublicationResult { readonly event: NostrEvent; readonly outcomes: readonly PublishResponse[]; readonly accepted: number }

export interface RelayPublisher {
  publishTemplate(relays: readonly string[], template: EventTemplate): Promise<PublicationResult>;
  publishSigned(relays: readonly string[], event: NostrEvent): Promise<PublicationResult>;
}

export function createRelayPublisher(target: PublishTarget, accounts: AccountController, ingress: EventIngress, minimumAccepted = 1): RelayPublisher {
  const publishSigned = async (relays: readonly string[], event: NostrEvent): Promise<PublicationResult> => {
    const outcomes = await target.publish([...relays], event, { retries: false });
    const accepted = outcomes.filter((outcome) => outcome.ok).length;
    if (accepted < minimumAccepted) throw new Error("publish-rejected");
    ingress.admit(event, outcomes.find((outcome) => outcome.ok)?.from ?? "local:publish");
    return { event, outcomes, accepted };
  };
  return {
    async publishTemplate(relays, template) { return publishSigned(relays, await accounts.sign(template)); },
    publishSigned
  };
}
