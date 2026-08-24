import { EventStore } from "applesauce-core/event-store";
import { generateSecretKey, finalizeEvent, verifyEvent } from "nostr-tools/pure";
import { describe, expect, it, vi } from "vitest";
import { MAX_EVENT_TAGS, createEventIngress, createRelayPolicy } from "../src/index.js";
import { freshServices } from "./fresh.js";

describe("relay policy", () => {
  it("normalizes and deduplicates secure relay URLs", () => {
    expect(createRelayPolicy().select(["WSS://Relay.Example:443/", "wss://relay.example"], "read")).toEqual(["wss://relay.example/"]);
  });
  it("rejects insecure remote, credentials, and fragments", () => {
    const policy = createRelayPolicy({ allowInsecureLocalhost: true });
    expect(() => policy.normalize("ws://relay.example", "read")).toThrow("scheme");
    expect(() => policy.normalize("wss://user@relay.example", "read")).toThrow("credentials");
    expect(() => policy.normalize("wss://relay.example/#x", "read")).toThrow("fragment");
    expect(policy.normalize("ws://localhost:8080", "read")).toBe("ws://localhost:8080/");
  });
  it("allows insecure LAN relays only when explicitly enabled for local development", () => {
    expect(() => createRelayPolicy().normalize("ws://10.0.0.2:7777", "read")).toThrow("scheme");
    expect(createRelayPolicy({ allowInsecure: true }).normalize("ws://10.0.0.2:7777", "read"))
      .toBe("ws://10.0.0.2:7777/");
  });
});

describe("event ingress", () => {
  it("rejects malformed and oversized events before verification", () => {
    const verify = vi.fn(() => true);
    const ingress = createEventIngress(new EventStore({ verifyEvent }), verify);
    expect(ingress.admit({ kind: 1, created_at: 1, content: "x", tags: null } as never, "wss://relay.example/")).toBeNull();
    expect(ingress.admit({ id: "id", pubkey: "pk", sig: "sig", kind: 1, created_at: 1, content: "x".repeat(256 * 1024 + 1), tags: [] }, "wss://relay.example/")).toBeNull();
    expect(verify).not.toHaveBeenCalled();
  });
});

describe("shared services", () => {
  it("admits valid events centrally and rejects invalid events", async () => {
    const { ingress, telemetry, shutdownNostrServices } = await freshServices();
    const event = finalizeEvent({ kind: 1, created_at: 1, content: "hello", tags: [] }, generateSecretKey());
    expect(ingress.admit(event, "wss://relay.example")?.id).toBe(event.id);
    expect(ingress.admit({ ...event, content: "tampered" }, "wss://relay.example")).toBeNull();
    expect(telemetry.snapshot().map((record) => record.name)).toEqual([
      "event.received", "event.admitted", "event.received", "event.rejected"
    ]);
    shutdownNostrServices(); shutdownNostrServices();
  });
  it("enforces event limits on direct store writes, not only through ingress", async () => {
    const { eventStore, shutdownNostrServices } = await freshServices();
    const tags = Array.from({ length: MAX_EVENT_TAGS + 1 }, (_, index) => ["t", String(index)]);
    const oversized = finalizeEvent({ kind: 1, created_at: 1, content: "", tags }, generateSecretKey());
    // Loaders and casts insert straight into the store, so `ingress.admit` never sees these.
    expect(eventStore.add(oversized)).toBeNull();
    shutdownNostrServices();
  });
  it("keeps the newest replaceable winner", async () => {
    const { eventStore, ingress, shutdownNostrServices } = await freshServices();
    const key = generateSecretKey();
    const newest = finalizeEvent({ kind: 0, created_at: 20, content: "new", tags: [] }, key);
    const older = finalizeEvent({ kind: 0, created_at: 10, content: "old", tags: [] }, key);
    ingress.admit(newest, "wss://one"); ingress.admit(older, "wss://two");
    expect(eventStore.getReplaceable(0, newest.pubkey)?.id).toBe(newest.id);
    shutdownNostrServices();
  });
  it("returns sorted relay provenance for stored events", async () => {
    const { eventStore, getSeenRelaysForEvent, ingress, shutdownNostrServices } = await freshServices();
    const event = finalizeEvent({ kind: 1, created_at: 1, content: "seen", tags: [] }, generateSecretKey());
    ingress.admit(event, "wss://two.example"); ingress.admit(event, "wss://one.example");
    expect(getSeenRelaysForEvent(event.id)).toEqual(["wss://one.example", "wss://two.example"]);
    expect(getSeenRelaysForEvent("missing")).toEqual([]);
    expect(eventStore.getEvent(event.id)?.id).toBe(event.id);
    shutdownNostrServices();
  });
  it("removes deleted events and refuses already-expired events", async () => {
    const { eventStore, ingress, shutdownNostrServices } = await freshServices();
    const key = generateSecretKey();
    const note = finalizeEvent({ kind: 1, created_at: 1, content: "delete", tags: [] }, key);
    const deletion = finalizeEvent({ kind: 5, created_at: 2, content: "", tags: [["e", note.id]] }, key);
    ingress.admit(note, "wss://one"); ingress.admit(deletion, "wss://one");
    expect(eventStore.getEvent(note.id)).toBeUndefined();
    const expired = finalizeEvent({ kind: 1, created_at: 1, content: "expired", tags: [["expiration", "2"]] }, key);
    ingress.admit(expired, "wss://one");
    expect(eventStore.getEvent(expired.id)).toBeUndefined();
    shutdownNostrServices();
  });
});
