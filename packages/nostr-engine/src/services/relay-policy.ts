import { createRelayPolicy } from "../relay-policy.js";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Plaintext relays are tolerated only when the shell itself is served from a loopback origin.
 * Derived from the document rather than a build flag so the rule also holds in tests and workers.
 */
const servedLocally = (): boolean =>
  typeof location !== "undefined" && LOCAL_HOSTNAMES.has(location.hostname);

export const relayPolicy = createRelayPolicy({ allowInsecureLocalhost: servedLocally() });
