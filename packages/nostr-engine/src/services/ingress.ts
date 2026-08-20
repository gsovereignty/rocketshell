import { verifyEvent } from "nostr-tools/pure";
import { createEventIngress, type EventIngress } from "../event-ingress.js";
import { eventStore } from "./event-store.js";
import { telemetry } from "./telemetry.js";

/** The funnel for events arriving over a relay stream: records provenance telemetry, then stores. */
export const ingress: EventIngress = createEventIngress(eventStore, verifyEvent, telemetry);
