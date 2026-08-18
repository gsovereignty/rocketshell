import type { RelayPoolLike } from "@kehto/shell";
import type { NostrEvent } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import { Observable } from "rxjs";
import { createRelayPublisher, openRelayStream, validateFilters, type NostrEngine } from "@platform/nostr-engine";

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
      return new Promise<number>((resolve, reject) => {
        let total = 0;
        const subscription = engine.relayPool.count(engine.relayPolicy.select(relayUrls, "read"), validateFilters(filters as Filter[])).subscribe({
          next(counts) { total = Object.values(counts).reduce((sum, result) => sum + result.count, 0); },
          complete() { resolve(total); }, error: reject
        });
        void subscription;
      });
    }
  };
}
