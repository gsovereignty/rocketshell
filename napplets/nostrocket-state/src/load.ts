import type { NostrEvent } from "./state";
import { validateStateEvent } from "./state";
import { parseRocketCoordinate } from "./coordinates";

type Subscription = { on(type: "event", callback: (result: { event: NostrEvent }) => void): void; on(type: "closed", callback: (reason?: unknown) => void): void; close(): void };
type Subscribe = (filters: Record<string, unknown>[], options: Record<string, unknown>) => Subscription;

export function firstMatchingState(subscribe: Subscribe, coordinate: string, relays: string[], timeoutMs = 8000): Promise<NostrEvent> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let author: string;
    let identifier: string;
    try {
      ({ author, identifier } = parseRocketCoordinate(coordinate));
    } catch (error) {
      reject(error);
      return;
    }
    const options: Record<string, unknown> = { authors: [author], limit: 1, timeoutMs };
    if (relays.length) options.relays = relays;
    const subscription = subscribe([{ kinds: [31108], authors: [author], "#d": [identifier], limit: 1 }], options);
    subscription.on("event", ({ event }) => {
      if (settled) return;
      try {
        validateStateEvent(event, coordinate);
        settled = true;
        subscription.close();
        resolve(event);
      } catch (error) {
        console.warn("Received rocket state candidate was rejected", { coordinate, eventId: event.id, error });
      }
    });
    subscription.on("closed", (reason) => {
      if (settled) return;
      settled = true;
      reject(new Error(`Rocket state subscription closed before a valid event${reason ? `: ${String(reason)}` : "."}`));
    });
  });
}
