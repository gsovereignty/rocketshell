import type { RelayPoolLike } from "@kehto/shell";
import type { NostrEvent } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import { Observable, type Subscription } from "rxjs";
import { ingress, openRelayStream, publisher, relayPolicy, relayPool, telemetry, validateFilters } from "@platform/nostr-engine";

const COUNT_TIMEOUT_MS = 15_000;

/** Built once: this used to be rebuilt, along with a fresh publisher, on every `getRelayPool()` call. */
export const relayPoolLike: RelayPoolLike = {
  subscription(relayUrls, filters) {
    const selected = relayPolicy.select(relayUrls, "read"); const validated = validateFilters(filters as Filter | Filter[]);
    return new Observable((observer) => {
      const handle = openRelayStream(relayPool, ingress, selected, validated, {
        event: (event) => observer.next(event), eose: () => observer.next("EOSE")
      }, 15_000, telemetry);
      return () => handle.close();
    });
  },
  async publish(relayUrls, event) {
    await publisher.publishSigned(relayPolicy.select(relayUrls, "write"), event as NostrEvent);
  },
  request(relayUrls, filters) {
    const selected = relayPolicy.select(relayUrls, "read"); const validated = validateFilters(filters as Filter | Filter[]);
    return new Observable((observer) => {
      const handle = openRelayStream(relayPool, ingress, selected, validated, {
        event: (event) => observer.next(event), eose: () => observer.complete()
      }, 15_000, telemetry);
      return () => handle.close();
    });
  },
  async count(relayUrls, filters) {
    const selected = relayPolicy.select(relayUrls, "read");
    const validated = validateFilters(filters as Filter[]);
    if (selected.length === 0) return 0;
    return new Promise<number>((resolve, reject) => {
      let total = 0;
      let subscription: Subscription | undefined;
      const timer = setTimeout(() => {
        subscription?.unsubscribe();
        reject(new Error("query-timeout"));
      }, COUNT_TIMEOUT_MS);
      subscription = relayPool.count(selected, validated).subscribe({
        next(counts) { total = Object.values(counts).reduce((sum, result) => sum + result.count, 0); },
        complete() { clearTimeout(timer); resolve(total); },
        error(error) { clearTimeout(timer); reject(error); }
      });
    });
  }
};
