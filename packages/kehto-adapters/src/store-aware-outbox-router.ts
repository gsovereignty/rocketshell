import type { EventStore } from "applesauce-core";
import { addSeenRelay, getSeenRelays, type Filter } from "applesauce-core/helpers";
import type {
  OutboxResult,
  OutboxRouter,
  OutboxSubscriptionSink,
  StreamingOutboxRouter
} from "@kehto/services";

const resultFromStore = (eventStore: EventStore, filters: Filter[]): OutboxResult => ({
  events: eventStore.getByFilters(filters).map((event) => {
    const relayHints = [...(getSeenRelays(event) ?? [])];
    return {
      event,
      ...(relayHints.length > 0 ? { sidecar: { relayHints } } : {})
    };
  })
});

const mergeResults = (local: OutboxResult, remote: OutboxResult, limit?: number): OutboxResult => {
  const events = Array.from(new Map(
    [...local.events, ...remote.events].map((result) => [result.event.id, result])
  ).values());
  return {
    events: limit === undefined ? events : events.slice(0, limit),
    ...(remote.incomplete === undefined ? {} : { incomplete: remote.incomplete }),
    ...(remote.error === undefined ? {} : { error: remote.error })
  };
};

const exactIdsSatisfied = (filters: Filter[], local: OutboxResult): boolean => {
  const requested = new Set(filters.flatMap((filter) => filter.ids ?? []));
  if (requested.size === 0 || filters.some((filter) => !filter.ids?.length)) return false;
  const found = new Set(local.events.map(({ event }) => event.id));
  return [...requested].every((id) => found.has(id));
};

const admitResults = (eventStore: EventStore, result: OutboxResult): void => {
  for (const { event, sidecar } of result.events) {
    for (const relay of sidecar?.relayHints ?? []) addSeenRelay(event, relay);
    eventStore.add(event);
  }
};

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
  async query(filters, options) {
    const local = resultFromStore(eventStore, filters as Filter[]);
    if (exactIdsSatisfied(filters as Filter[], local)) {
      // Event IDs are immutable. Return known matches now, while relay work keeps
      // shared-store provenance and downstream reactive views fresh.
      void router.query(filters, options).then((remote) => {
        admitResults(eventStore, remote);
      }).catch((error: unknown) => {
        console.warn("Background outbox refresh failed after cached query", {
          eventIds: filters.flatMap((filter) => filter.ids ?? []), error
        });
      });
      return mergeResults({ events: local.events.slice(0, options?.limit) }, { events: [] }, options?.limit);
    }
    const remote = await router.query(filters, options);
    admitResults(eventStore, remote);
    return mergeResults(resultFromStore(eventStore, filters as Filter[]), remote, options?.limit);
  },
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
    const storeSubscription = eventStore.filters(filters as Filter[]).subscribe((event) => {
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
