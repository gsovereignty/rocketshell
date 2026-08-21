import type { EventStore } from "applesauce-core";
import { getSeenRelays, type Filter } from "applesauce-core/helpers";
import type {
  OutboxRouter,
  OutboxSubscriptionSink,
  StreamingOutboxRouter
} from "@kehto/services";

/**
 * Add shared-store ingress to live outbox delivery.
 *
 * Relay ingress is admitted to this same store, so one subscription-level ID
 * set also suppresses the relay callback that follows a store notification.
 */
export const createStoreAwareOutboxRouter = (
  router: StreamingOutboxRouter,
  eventStore: EventStore
): StreamingOutboxRouter => ({
  ...router,
  subscribe(filters, options, sink: OutboxSubscriptionSink) {
    const delivered = new Set<string>();
    let closed = false;

    const deliver: OutboxSubscriptionSink["event"] = (result) => {
      if (closed || delivered.has(result.event.id)) return;
      delivered.add(result.event.id);
      sink.event(result);
    };

    // Listen before opening relay work so an event admitted during relay setup
    // cannot fall between the two live sources.
    const storeSubscription = eventStore.filters(filters as Filter[], true).subscribe((event) => {
      const relayHints = [...(getSeenRelays(event) ?? [])];
      deliver({
        event,
        ...(relayHints.length > 0 ? { sidecar: { relayHints } } : {})
      });
    });
    const relaySubscription = router.subscribe(filters, options, {
      event: deliver,
      closed(reason) {
        if (closed) return;
        closed = true;
        storeSubscription.unsubscribe();
        sink.closed(reason);
      }
    });

    return {
      close() {
        if (closed) return;
        closed = true;
        storeSubscription.unsubscribe();
        relaySubscription.close();
      }
    };
  }
});

export type { OutboxRouter };
