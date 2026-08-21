import type { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import type { PublishResponse } from "applesauce-relay";
import type { AccountController } from "./accounts.js";
import type { EventIngress } from "./event-ingress.js";
import { NOOP_TELEMETRY, type PlatformTelemetry } from "@project/platform-nap-contract";

export interface PublishTarget {
  publish(relays: string[], event: NostrEvent, options?: { timeout?: number | boolean; retries?: number | boolean }): Promise<PublishResponse[]>;
}
export interface PublicationResult { readonly event: NostrEvent; readonly outcomes: readonly PublishResponse[]; readonly accepted: number }
export const DEFAULT_PUBLISH_TIMEOUT_MS = 4_000;
export const DEFAULT_PUBLISH_RETRY_DELAY_MS = 1_000;

export interface RelayPublisher {
  publishTemplate(relays: readonly string[], template: EventTemplate): Promise<PublicationResult>;
  publishSigned(relays: readonly string[], event: NostrEvent): Promise<PublicationResult>;
}

const wait = (delayMs: number): Promise<void> => new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));

export function createRelayPublisher(
  target: PublishTarget,
  accounts: AccountController,
  ingress: EventIngress,
  minimumAccepted = 1,
  telemetry: PlatformTelemetry = NOOP_TELEMETRY,
  waitBeforeRetry: (attempt: number) => Promise<void> = (attempt) => wait(Math.min(DEFAULT_PUBLISH_RETRY_DELAY_MS * attempt, 30_000))
): RelayPublisher {
  const publishSigned = async (relays: readonly string[], event: NostrEvent): Promise<PublicationResult> => {
    if (!ingress.verify(event)) throw new Error("invalid-event");
    let attempt = 0;
    while (true) {
      attempt += 1;
      let outcomes: PublishResponse[] = [];
      try {
        outcomes = await target.publish([...relays], event, { retries: true, timeout: DEFAULT_PUBLISH_TIMEOUT_MS });
      } catch { /* transport failures join rejected and timed-out outcomes in retry path */ }
      for (const outcome of outcomes) telemetry.record("publication.outcome", outcome.ok ? 1 : 0, { relay: outcome.from });
      const accepted = outcomes.filter((outcome) => outcome.ok).length;
      if (accepted >= minimumAccepted) {
        for (const outcome of outcomes) {
          if (outcome.ok) ingress.admit(event, outcome.from);
        }
        return { event, outcomes, accepted };
      }
      telemetry.record("publication.failed", 1, { relayCount: relays.length });
      await waitBeforeRetry(attempt);
    }
  };
  return {
    async publishTemplate(relays, template) { return publishSigned(relays, await accounts.sign(template)); },
    publishSigned
  };
}
