import type { RelayPoolLike } from "@kehto/shell";
import type { NostrEvent } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import { EMPTY, Observable, catchError, type Subscription } from "rxjs";
import { eventStore, ingress, openRelayStream, publisher, relayPolicy, relayPool, telemetry, validateFilters } from "@platform/nostr-engine";

const COUNT_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 15_000;

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
    const selected = relayPolicy.select(relayUrls, "read");
    // Straight off the pool: a request completes on EOSE by itself, so the aggregate-EOSE barrier
    // this used to route through only converted an observable to callbacks and back again.
    // `eventStore` both deduplicates and inserts, and the store's verifier rejects oversized or
    // unsigned events, so nothing reaches a napplet that would not have passed the ingress funnel.
    return relayPool.request(selected, validateFilters(filters as Filter | Filter[]), {
      eventStore, timeout: REQUEST_TIMEOUT_MS
      // A timed-out or failed relay completes with whatever arrived, as the barrier did.
    }).pipe(catchError(() => EMPTY));
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
