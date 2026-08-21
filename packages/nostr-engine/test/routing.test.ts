import { EventStore } from "applesauce-core/event-store";
import type { NostrEvent } from "applesauce-core/helpers/event";
import { finalizeEvent, generateSecretKey, verifyEvent } from "nostr-tools/pure";
import { describe, expect, it, vi } from "vitest";
import { createEventIngress, createRelayPublisher } from "../src/index.js";
import { getSeenRelays } from "applesauce-core/helpers";
import { createPlatformTelemetry } from "@project/platform-nap-contract";

describe("publication", () => {
  it("signs once, waits for outcomes, and reuses signed event on retry", async () => {
    const store = new EventStore({ verifyEvent }); const ingress = createEventIngress(store, verifyEvent);
    const event = finalizeEvent({ kind: 1, created_at: 1, content: "publish", tags: [] }, generateSecretKey());
    const sign = vi.fn(async () => event); const publish = vi.fn(async () => [{ ok: true, from: "wss://relay.example" }]);
    const publisher = createRelayPublisher({ publish }, { sign } as never, ingress);
    const first = await publisher.publishTemplate(["wss://relay.example"], { kind: 1, created_at: 1, content: "publish", tags: [] });
    const retry = await publisher.publishSigned(["wss://relay.example"], first.event);
    expect(sign).toHaveBeenCalledOnce(); expect(retry.event.id).toBe(first.event.id); expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith(["wss://relay.example"], event, { retries: false, timeout: 4_000 });
    store.dispose();
  });
  it("rejects total relay failure", async () => {
    const store = new EventStore({ verifyEvent }); const ingress = createEventIngress(store, verifyEvent);
    const telemetry = createPlatformTelemetry();
    const event = finalizeEvent({ kind: 1, created_at: 1, content: "publish", tags: [] }, generateSecretKey());
    const publisher = createRelayPublisher({ publish: async () => [{ ok: false, from: "wss://relay.example", message: "no" }] }, { sign: async () => event } as never, ingress, 1, telemetry);
    await expect(publisher.publishTemplate(["wss://relay.example"], { kind: 1, created_at: 1, content: "publish", tags: [] })).rejects.toThrow("publish-rejected");
    expect(telemetry.snapshot().map((record) => record.name)).toEqual(["publication.outcome", "publication.failed"]);
    store.dispose();
  });
  it("records every relay that accepted a publication", async () => {
    const store = new EventStore({ verifyEvent }); const ingress = createEventIngress(store, verifyEvent);
    const event = finalizeEvent({ kind: 1, created_at: 1, content: "publish", tags: [] }, generateSecretKey());
    const publisher = createRelayPublisher({ publish: async () => [
      { ok: true, from: "wss://one.example" },
      { ok: false, from: "wss://blocked.example", message: "blocked" },
      { ok: true, from: "wss://two.example" }
    ] }, { sign: async () => event } as never, ingress);
    await publisher.publishSigned(["wss://one.example", "wss://blocked.example", "wss://two.example"], event);
    expect([...getSeenRelays(store.getEvent(event.id)!)!].sort()).toEqual(["wss://one.example", "wss://two.example"]);
    store.dispose();
  });
  it("reports a relay publication timeout as failure", async () => {
    const store = new EventStore({ verifyEvent }); const ingress = createEventIngress(store, verifyEvent);
    const event = finalizeEvent({ kind: 1, created_at: 1, content: "publish", tags: [] }, generateSecretKey());
    const publish = vi.fn(async () => [{ ok: false, from: "wss://relay.example", message: "Timeout has occurred" }]);
    const publisher = createRelayPublisher({ publish }, { sign: async () => event } as never, ingress);
    await expect(publisher.publishTemplate(["wss://relay.example"], { kind: 1, created_at: 1, content: "publish", tags: [] })).rejects.toThrow("publish-rejected");
    expect(publish).toHaveBeenCalledWith(["wss://relay.example"], event, { retries: false, timeout: 4_000 });
    store.dispose();
  });
  it("rejects an invalid signed event before transport", async () => {
    const store = new EventStore({ verifyEvent }); const ingress = createEventIngress(store, verifyEvent); const publish = vi.fn(async () => []);
    const valid = finalizeEvent({ kind: 1, created_at: 1, content: "publish", tags: [] }, generateSecretKey());
    const publisher = createRelayPublisher({ publish }, { sign: async () => valid } as never, ingress);
    await expect(publisher.publishSigned(["wss://relay.example"], { ...valid, content: "tampered" })).rejects.toThrow("invalid-event");
    expect(publish).not.toHaveBeenCalled(); store.dispose();
  });
});
