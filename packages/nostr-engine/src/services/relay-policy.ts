import { createRelayPolicy } from "../relay-policy.js";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Plaintext relays are tolerated only when the shell itself is served over HTTP from loopback.
 * This lets local Vite development reach LAN relays while HTTPS deployments remain WSS-only.
 */
const servedLocally = (): boolean =>
  typeof location !== "undefined" && LOCAL_HOSTNAMES.has(location.hostname);

export const relayPolicy = createRelayPolicy({
  allowInsecure: servedLocally() && location.protocol === "http:"
});
