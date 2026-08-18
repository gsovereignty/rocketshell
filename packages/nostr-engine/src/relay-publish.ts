import type { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import type { PublishResponse } from "applesauce-relay";
import type { AccountController } from "./accounts.js";
import type { EventIngress } from "./event-ingress.js";

export interface PublishTarget {
  publish(relays: string[], event: NostrEvent, options?: { timeout?: number | boolean; retries?: number | boolean }): Promise<PublishResponse[]>;
}
export interface PublicationResult { readonly event: NostrEvent; readonly outcomes: readonly PublishResponse[]; readonly accepted: number }

export class RelayPublisher {
  constructor(private readonly target: PublishTarget, private readonly accounts: AccountController, private readonly ingress: EventIngress, private readonly minimumAccepted = 1) {}

  async publishTemplate(relays: readonly string[], template: EventTemplate): Promise<PublicationResult> {
    const signed = await this.accounts.sign(template);
    return this.publishSigned(relays, signed);
  }

  async publishSigned(relays: readonly string[], event: NostrEvent): Promise<PublicationResult> {
    const outcomes = await this.target.publish([...relays], event, { retries: false });
    const accepted = outcomes.filter((outcome) => outcome.ok).length;
    if (accepted < this.minimumAccepted) throw new Error("publish-rejected");
    this.ingress.admit(event, outcomes.find((outcome) => outcome.ok)?.from ?? "local:publish");
    return { event, outcomes, accepted };
  }
}
