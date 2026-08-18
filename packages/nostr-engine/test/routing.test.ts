import { EventStore } from "applesauce-core/event-store";
import type { NostrEvent } from "applesauce-core/helpers/event";
import { finalizeEvent, generateSecretKey, verifyEvent } from "nostr-tools/pure";
import { describe, expect, it, vi } from "vitest";
import { createEventIngress, createRelayListResolver, createRelayPolicy, createRelayPublisher } from "../src/index.js";

describe("publication", () => {
  it("signs once, waits for outcomes, and reuses signed event on retry", async () => {
    const store = new EventStore({ verifyEvent }); const ingress = createEventIngress(store, verifyEvent);
    const event = finalizeEvent({ kind: 1, created_at: 1, content: "publish", tags: [] }, generateSecretKey());
    const sign = vi.fn(async () => event); const publish = vi.fn(async () => [{ ok: true, from: "wss://relay.example" }]);
    const publisher = createRelayPublisher({ publish }, { sign } as never, ingress);
    const first = await publisher.publishTemplate(["wss://relay.example"], { kind: 1, created_at: 1, content: "publish", tags: [] });
    const retry = await publisher.publishSigned(["wss://relay.example"], first.event);
    expect(sign).toHaveBeenCalledOnce(); expect(retry.event.id).toBe(first.event.id); expect(publish).toHaveBeenCalledTimes(2);
    store.dispose();
  });
  it("rejects total relay failure", async () => {
    const store = new EventStore({ verifyEvent }); const ingress = createEventIngress(store, verifyEvent);
    const event = finalizeEvent({ kind: 1, created_at: 1, content: "publish", tags: [] }, generateSecretKey());
    const publisher = createRelayPublisher({ publish: async () => [{ ok: false, from: "wss://relay.example", message: "no" }] }, { sign: async () => event } as never, ingress);
    await expect(publisher.publishTemplate(["wss://relay.example"], { kind: 1, created_at: 1, content: "publish", tags: [] })).rejects.toThrow("publish-rejected");
    store.dispose();
  });
});

describe("relay-list resolution", () => {
  it("uses fixed discovery query, admits result, and caches it", async () => {
    const key = generateSecretKey(); const event = finalizeEvent({ kind: 10002, created_at: 100, content: "", tags: [["r", "wss://read.example", "read"], ["r", "ws://denied.example", "read"], ["r", "wss://write.example", "write"]] }, key);
    const store = new EventStore({ verifyEvent }); const query = vi.fn(async (): Promise<readonly NostrEvent[]> => [event]);
    const resolver = createRelayListResolver(store, createEventIngress(store, verifyEvent), createRelayPolicy(), ["wss://discovery.example"], query, { now: () => 100_000 });
    const first = await resolver.resolve([event.pubkey]); const second = await resolver.resolve([event.pubkey]);
    expect(first.get(event.pubkey)?.read).toEqual(["wss://read.example/"]); expect(first.get(event.pubkey)?.write).toEqual(["wss://write.example/"]);
    expect(second.get(event.pubkey)?.event?.id).toBe(event.id); expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(["wss://discovery.example"], [event.pubkey]); store.dispose();
  });
  it("caches missing relay lists for the negative freshness window", async () => {
    const store = new EventStore({ verifyEvent }); const query = vi.fn(async (): Promise<readonly NostrEvent[]> => []);
    const resolver = createRelayListResolver(store, createEventIngress(store, verifyEvent), createRelayPolicy(), ["wss://discovery.example"], query, { now: () => 100_000 });
    const pubkey = "11".repeat(32);
    expect((await resolver.resolve([pubkey])).get(pubkey)).toBeUndefined();
    expect((await resolver.resolve([pubkey])).get(pubkey)).toBeUndefined();
    expect(query).toHaveBeenCalledOnce(); store.dispose();
  });
  it("uses a stale stored list without disguising it as fresh", async () => {
    let now = 10_000; const key = generateSecretKey();
    const event = finalizeEvent({ kind: 10002, created_at: 1, content: "", tags: [["r", "wss://stale.example"]] }, key);
    const store = new EventStore({ verifyEvent }); const ingress = createEventIngress(store, verifyEvent); ingress.admit(event, "wss://discovery.example");
    const query = vi.fn(async (): Promise<readonly NostrEvent[]> => []);
    const resolver = createRelayListResolver(store, ingress, createRelayPolicy(), ["wss://discovery.example"], query, { positiveFreshnessMs: 100, staleUsableMs: 60_000, now: () => now });
    expect((await resolver.resolve([event.pubkey])).get(event.pubkey)?.read).toEqual(["wss://stale.example/"]);
    now += 1_000;
    expect((await resolver.resolve([event.pubkey])).get(event.pubkey)?.read).toEqual(["wss://stale.example/"]);
    expect(query).toHaveBeenCalledTimes(2); store.dispose();
  });
});
