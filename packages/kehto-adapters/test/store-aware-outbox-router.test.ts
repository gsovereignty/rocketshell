import { EventStore } from "applesauce-core";
import { addSeenRelay } from "applesauce-core/helpers";
import type {
  OutboxSubscriptionSink,
  StreamingOutboxRouter
} from "@kehto/services";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { describe, expect, it, vi } from "vitest";
import { createStoreAwareOutboxRouter } from "../src/store-aware-outbox-router.js";

const event = (kind: number, content: string) =>
  finalizeEvent({ kind, created_at: 1, content, tags: [] }, generateSecretKey());

const relayRouter = () => {
  let sink: OutboxSubscriptionSink | undefined;
  const close = vi.fn();
  const router = {
    getEvent: vi.fn(),
    query: vi.fn(),
    queryStream: vi.fn(),
    publish: vi.fn(),
    resolveRelays: vi.fn(),
    subscribe: vi.fn((_filters, _options, nextSink) => {
      sink = nextSink;
      return { close };
    })
  } as unknown as StreamingOutboxRouter;
  return { router, close, getSink: () => sink! };
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
};

describe("store-aware outbox router", () => {
  it("returns an exact cached query without waiting for the relay", async () => {
    const store = new EventStore();
    const relay = relayRouter();
    const pending = deferred<{ events: [] }>();
    relay.router.query = vi.fn(() => pending.promise);
    const revision = event(31971, "cached revision");
    store.add(revision);

    const response = await createStoreAwareOutboxRouter(relay.router, store)
      .query([{ ids: [revision.id], kinds: [31971] }], { limit: 1 });

    expect(response.events).toEqual([{ event: revision }]);
    expect(relay.router.query).toHaveBeenCalledOnce();
    pending.resolve({ events: [] });
    store.dispose();
  });

  it("uses the network path when an exact event is absent", async () => {
    const store = new EventStore();
    const relay = relayRouter();
    const revision = event(31971, "remote revision");
    relay.router.query = vi.fn().mockResolvedValue({ events: [{ event: revision }] });

    const response = await createStoreAwareOutboxRouter(relay.router, store)
      .query([{ ids: [revision.id], kinds: [31971] }], { limit: 1 });

    expect(response.events).toEqual([{ event: revision }]);
    expect(store.getEvent(revision.id)).toBe(revision);
    store.dispose();
  });

  it("merges and deduplicates cached and relay query results", async () => {
    const store = new EventStore();
    const relay = relayRouter();
    const cached = event(31971, "cached revision");
    const remote = event(31971, "newer revision");
    store.add(cached);
    relay.router.query = vi.fn().mockResolvedValue({
      events: [{ event: cached }, { event: remote }]
    });

    const response = await createStoreAwareOutboxRouter(relay.router, store)
      .query([{ kinds: [31971] }]);

    expect(response.events.map(({ event }) => event.id)).toEqual([cached.id, remote.id]);
    expect(store.getEvent(remote.id)).toBe(remote);
    store.dispose();
  });

  it("replays matching cached ingress before relay completion", () => {
    const store = new EventStore();
    const relay = relayRouter();
    const revision = event(31971, "cached revision");
    store.add(revision);
    const sink = { event: vi.fn(), closed: vi.fn() };

    createStoreAwareOutboxRouter(relay.router, store)
      .subscribe([{ kinds: [31971] }], undefined, sink);

    expect(sink.event).toHaveBeenCalledWith({ event: revision });
    store.dispose();
  });

  it("delivers matching local ingress without a relay echo", () => {
    const store = new EventStore();
    const relay = relayRouter();
    const sink = { event: vi.fn(), closed: vi.fn() };
    createStoreAwareOutboxRouter(relay.router, store).subscribe([{ kinds: [31971] }], undefined, sink);

    const revision = event(31971, "new description");
    store.add(revision);

    expect(sink.event).toHaveBeenCalledOnce();
    expect(sink.event).toHaveBeenCalledWith({ event: revision });
    store.dispose();
  });

  it("does not deliver nonmatching local ingress", () => {
    const store = new EventStore();
    const relay = relayRouter();
    const sink = { event: vi.fn(), closed: vi.fn() };
    createStoreAwareOutboxRouter(relay.router, store).subscribe([{ kinds: [31971] }], undefined, sink);

    store.add(event(1, "ordinary note"));

    expect(sink.event).not.toHaveBeenCalled();
    store.dispose();
  });

  it("deduplicates store ingress and relay echo by event id", () => {
    const store = new EventStore();
    const relay = relayRouter();
    const sink = { event: vi.fn(), closed: vi.fn() };
    createStoreAwareOutboxRouter(relay.router, store).subscribe([{ kinds: [31971] }], undefined, sink);
    const revision = event(31971, "new description");

    store.add(revision);
    relay.getSink().event({ event: revision, sidecar: { relayHints: ["wss://relay.example/"] } });

    expect(sink.event).toHaveBeenCalledOnce();
    store.dispose();
  });

  it("preserves all known relay provenance on store delivery", () => {
    const store = new EventStore();
    const relay = relayRouter();
    const sink = { event: vi.fn(), closed: vi.fn() };
    createStoreAwareOutboxRouter(relay.router, store).subscribe([{ kinds: [31971] }], undefined, sink);
    const revision = event(31971, "new description");
    addSeenRelay(revision, "wss://one.example/");
    addSeenRelay(revision, "wss://two.example/");

    store.add(revision);

    expect(sink.event).toHaveBeenCalledWith({
      event: revision,
      sidecar: { relayHints: ["wss://one.example/", "wss://two.example/"] }
    });
    store.dispose();
  });

  it("tears down store and relay sources together", () => {
    const store = new EventStore();
    const relay = relayRouter();
    const sink = { event: vi.fn(), closed: vi.fn() };
    const subscription = createStoreAwareOutboxRouter(relay.router, store)
      .subscribe([{ kinds: [31971] }], undefined, sink);

    subscription.close();
    store.add(event(31971, "after close"));
    relay.getSink().event({ event: event(31971, "relay after close") });

    expect(relay.close).toHaveBeenCalledOnce();
    expect(sink.event).not.toHaveBeenCalled();
    store.dispose();
  });

  it("stops store delivery when relay closes upstream", () => {
    const store = new EventStore();
    const relay = relayRouter();
    const sink = { event: vi.fn(), closed: vi.fn() };
    createStoreAwareOutboxRouter(relay.router, store).subscribe([{ kinds: [31971] }], undefined, sink);

    relay.getSink().closed("network-failed");
    store.add(event(31971, "after upstream close"));

    expect(sink.closed).toHaveBeenCalledWith("network-failed");
    expect(sink.event).not.toHaveBeenCalled();
    store.dispose();
  });
});
