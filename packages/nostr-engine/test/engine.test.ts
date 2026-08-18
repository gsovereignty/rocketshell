import { generateSecretKey, finalizeEvent } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
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
    await engine.close(); await engine.close();
  });
});
