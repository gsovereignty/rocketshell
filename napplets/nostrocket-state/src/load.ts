import type { NostrEvent } from "./state";
import { validateStateEvent } from "./state";

type Subscription = { on(type: "event", callback: (result: { event: NostrEvent }) => void): void; on(type: "closed", callback: (reason?: unknown) => void): void; close(): void };
type Subscribe = (filters: Record<string, unknown>[], options: Record<string, unknown>) => Subscription;

export function firstMatchingState(subscribe: Subscribe, relays: string[], timeoutMs = 8000): Promise<NostrEvent> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const options: Record<string, unknown> = { authors: ["d91191e30e00444b942c0e82cad470b32af171764c2275bee0bd99377efd4075"], limit: 1, timeoutMs };
    if (relays.length) options.relays = relays;
    const subscription = subscribe([{ kinds: [31108], authors: ["d91191e30e00444b942c0e82cad470b32af171764c2275bee0bd99377efd4075"], "#d": ["NOSTROCKET"], limit: 1 }], options);
    subscription.on("event", ({ event }) => {
      if (settled) return;
      try {
        validateStateEvent(event);
        settled = true;
        subscription.close();
        resolve(event);
      } catch (error) {
        console.warn("Received NOSTROCKET state candidate was rejected", { eventId: event.id, error });
      }
    });
    subscription.on("closed", (reason) => {
      if (settled) return;
      settled = true;
      reject(new Error(`NOSTROCKET state subscription closed before a valid event${reason ? `: ${String(reason)}` : "."}`));
    });
  });
}
