import { generateSecretKey, finalizeEvent } from "nostr-tools/pure";
import { describe, expect, it, vi } from "vitest";
import { createNostrEngine, createRelayPolicy } from "../src/index.js";

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
});

describe("shared engine", () => {
  it("admits valid events centrally and rejects invalid events", async () => {
    const engine = createNostrEngine();
    const event = finalizeEvent({ kind: 1, created_at: 1, content: "hello", tags: [] }, generateSecretKey());
    expect(engine.ingress.admit(event, "wss://relay.example")?.id).toBe(event.id);
    expect(engine.ingress.admit({ ...event, content: "tampered" }, "wss://relay.example")).toBeNull();
    expect(engine.telemetry.snapshot().map((record) => record.name)).toEqual([
      "event.received", "event.admitted", "event.received", "event.rejected"
    ]);
    await engine.close(); await engine.close();
  });
  it("rejects malformed and oversized events before verification", async () => {
    const verify = vi.fn(() => true); const engine = createNostrEngine({ verifyEvent: verify });
    expect(engine.ingress.admit({ kind: 1, created_at: 1, content: "x", tags: null } as never, "wss://relay.example/")).toBeNull();
    expect(engine.ingress.admit({ id: "id", pubkey: "pk", sig: "sig", kind: 1, created_at: 1, content: "x".repeat(256 * 1024 + 1), tags: [] }, "wss://relay.example/")).toBeNull();
    expect(verify).not.toHaveBeenCalled();
    await engine.close();
  });
  it("keeps the newest replaceable winner", async () => {
    const engine = createNostrEngine(); const key = generateSecretKey();
    const newest = finalizeEvent({ kind: 0, created_at: 20, content: "new", tags: [] }, key);
    const older = finalizeEvent({ kind: 0, created_at: 10, content: "old", tags: [] }, key);
    engine.ingress.admit(newest, "wss://one"); engine.ingress.admit(older, "wss://two");
    expect(engine.eventStore.getReplaceable(0, newest.pubkey)?.id).toBe(newest.id);
    await engine.close();
  });
  it("removes deleted events and refuses already-expired events", async () => {
    const engine = createNostrEngine(); const key = generateSecretKey();
    const note = finalizeEvent({ kind: 1, created_at: 1, content: "delete", tags: [] }, key);
    const deletion = finalizeEvent({ kind: 5, created_at: 2, content: "", tags: [["e", note.id]] }, key);
    engine.ingress.admit(note, "wss://one"); engine.ingress.admit(deletion, "wss://one");
    expect(engine.eventStore.getEvent(note.id)).toBeUndefined();
    const expired = finalizeEvent({ kind: 1, created_at: 1, content: "expired", tags: [["expiration", "2"]] }, key);
    engine.ingress.admit(expired, "wss://one");
    expect(engine.eventStore.getEvent(expired.id)).toBeUndefined();
    await engine.close();
  });
});
