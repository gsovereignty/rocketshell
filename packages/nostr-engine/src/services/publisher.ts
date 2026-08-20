import { createRelayPublisher, type RelayPublisher } from "../relay-publish.js";
import { accounts } from "./accounts.js";
import { ingress } from "./ingress.js";
import { relayPool } from "./relay-pool.js";
import { telemetry } from "./telemetry.js";

/** The one publisher. Previously rebuilt with identical arguments at four call sites. */
export const publisher: RelayPublisher = createRelayPublisher(relayPool, accounts, ingress, 1, telemetry);
