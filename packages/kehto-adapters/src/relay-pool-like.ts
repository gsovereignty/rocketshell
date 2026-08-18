import type { RelayPoolLike } from "@kehto/shell";
import type { NostrEvent } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import type { RelayPool } from "applesauce-relay";
import { DEFAULT_PUBLISH_TIMEOUT_MS, validateFilters, type RelayPolicy } from "@platform/nostr-engine";

export function createRelayPoolLike(pool: RelayPool, policy: RelayPolicy): RelayPoolLike {
  return {
    subscription(relayUrls, filters) { return pool.subscription(policy.select(relayUrls, "read"), validateFilters(filters as Filter | Filter[])); },
    async publish(relayUrls, event) {
      const outcomes = await pool.publish(policy.select(relayUrls, "write"), event as NostrEvent, { retries: false, timeout: DEFAULT_PUBLISH_TIMEOUT_MS });
      if (!outcomes.some((outcome) => outcome.ok)) throw new Error("publish-rejected");
    },
    request(relayUrls, filters) { return pool.request(policy.select(relayUrls, "read"), validateFilters(filters as Filter | Filter[])); },
    async count(relayUrls, filters) {
      return new Promise<number>((resolve, reject) => {
        let total = 0;
        const subscription = pool.count(policy.select(relayUrls, "read"), validateFilters(filters as Filter[])).subscribe({
          next(counts) { total = Object.values(counts).reduce((sum, result) => sum + result.count, 0); },
          complete() { resolve(total); }, error: reject
        });
        void subscription;
      });
    }
  };
}
