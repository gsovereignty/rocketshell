import { createRelayAuthenticator, type RelayAuthenticator } from "../relay-auth.js";
import { accounts } from "./accounts.js";
import { relayPool } from "./relay-pool.js";
import { telemetry } from "./telemetry.js";

/** Answers NIP-42 challenges for every relay the pool opens, and re-authenticates on account change. */
export const relayAuthenticator: RelayAuthenticator =
  createRelayAuthenticator(relayPool, accounts, undefined, telemetry);
