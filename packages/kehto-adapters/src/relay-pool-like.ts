import type { RelayPoolLike } from "@kehto/shell";
import type { NostrEvent } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import { Observable, type Subscription } from "rxjs";
import { createRelayPublisher, openRelayStream, validateFilters, type NostrEngine } from "@platform/nostr-engine";

const COUNT_TIMEOUT_MS = 15_000;

export function createRelayPoolLike(engine: NostrEngine): RelayPoolLike {
  const publisher = createRelayPublisher(engine.relayPool, engine.accounts, engine.ingress, 1, engine.telemetry);
  return {
    subscription(relayUrls, filters) {
      const selected = engine.relayPolicy.select(relayUrls, "read"); const validated = validateFilters(filters as Filter | Filter[]);
      return new Observable((observer) => {
        const handle = openRelayStream(engine.relayPool, engine.ingress, selected, validated, {
          event: (event) => observer.next(event), eose: () => observer.next("EOSE")
        }, 15_000, engine.telemetry);
        return () => handle.close();
      });
    },
    async publish(relayUrls, event) {
      await publisher.publishSigned(engine.relayPolicy.select(relayUrls, "write"), event as NostrEvent);
    },
    request(relayUrls, filters) {
      const selected = engine.relayPolicy.select(relayUrls, "read"); const validated = validateFilters(filters as Filter | Filter[]);
      return new Observable((observer) => {
        const handle = openRelayStream(engine.relayPool, engine.ingress, selected, validated, {
          event: (event) => observer.next(event), eose: () => observer.complete()
        }, 15_000, engine.telemetry);
        return () => handle.close();
      });
    },
    async count(relayUrls, filters) {
      const selected = engine.relayPolicy.select(relayUrls, "read");
      const validated = validateFilters(filters as Filter[]);
      if (selected.length === 0) return 0;
      return new Promise<number>((resolve, reject) => {
        let total = 0;
        let subscription: Subscription | undefined;
        const timer = setTimeout(() => {
          subscription?.unsubscribe();
          reject(new Error("query-timeout"));
        }, COUNT_TIMEOUT_MS);
        subscription = engine.relayPool.count(selected, validated).subscribe({
          next(counts) { total = Object.values(counts).reduce((sum, result) => sum + result.count, 0); },
          complete() { clearTimeout(timer); resolve(total); },
          error(error) { clearTimeout(timer); reject(error); }
        });
      });
    }
  };
}
