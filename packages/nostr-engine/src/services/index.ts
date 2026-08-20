// Import order matters: the loader must be wired before anything subscribes to a cast, and the
// authenticator must be watching before the pool opens its first connection.
import "./loaders.js";
import { relayAuthenticator } from "./auth.js";
import { accounts } from "./accounts.js";
import { eventStore } from "./event-store.js";
import { relayPool } from "./relay-pool.js";

export * from "./accounts.js";
export * from "./auth.js";
export * from "./event-store.js";
export * from "./ingress.js";
export * from "./loaders.js";
export * from "./persistence.js";
export * from "./publisher.js";
export * from "./relay-policy.js";
export * from "./relay-pool.js";
export * from "./relay-sources.js";
export * from "./telemetry.js";

/**
 * Tears down every long-lived subscription and connection. Terminal: the store is disposed, so the
 * services are unusable afterwards. The shell calls this from `platform.close()`.
 */
export function shutdownNostrServices(): void {
  relayAuthenticator.close();
  accounts.close();
  relayPool.close();
  eventStore.dispose();
}
