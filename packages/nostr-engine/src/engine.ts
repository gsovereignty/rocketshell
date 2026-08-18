import { AccountManager } from "applesauce-accounts";
import { EventStore } from "applesauce-core/event-store";
import { RelayPool } from "applesauce-relay";
import { verifyEvent } from "nostr-tools/pure";
import { createPlatformTelemetry, type PlatformTelemetry } from "@project/platform-nap-contract";
import { createAccountController, type AccountController } from "./accounts.js";
import { createEventIngress, type EventIngress, type VerifyNostrEvent } from "./event-ingress.js";
import { createRelayPolicy, type RelayPolicy, type RelayPolicyOptions } from "./relay-policy.js";
import { createRelayAuthenticator } from "./relay-auth.js";

export interface NostrEngine {
  readonly relayPool: RelayPool;
  readonly eventStore: EventStore;
  readonly accounts: AccountController;
  readonly ingress: EventIngress;
  readonly relayPolicy: RelayPolicy;
  readonly telemetry: PlatformTelemetry;
  close(): Promise<void>;
}

export interface EngineOptions { readonly verifyEvent?: VerifyNostrEvent; readonly relayPolicy?: RelayPolicyOptions; readonly telemetry?: PlatformTelemetry; readonly accountManager?: AccountManager }

export function createNostrEngine(options: EngineOptions = {}): NostrEngine {
  const verification = options.verifyEvent ?? verifyEvent;
  const telemetry = options.telemetry ?? createPlatformTelemetry();
  const eventStore = new EventStore({ verifyEvent: verification });
  const relayPool = new RelayPool();
  const accounts = createAccountController(options.accountManager ?? new AccountManager());
  const authenticator = createRelayAuthenticator(relayPool, accounts, undefined, telemetry);
  const ingress = createEventIngress(eventStore, verification, telemetry);
  const relayPolicy = createRelayPolicy(options.relayPolicy);
  let closed = false;
  return {
    relayPool, eventStore, accounts, ingress, relayPolicy, telemetry,
    async close() {
      if (closed) return;
      closed = true;
      authenticator.close(); accounts.close(); relayPool.close(); eventStore.dispose();
    }
  };
}
