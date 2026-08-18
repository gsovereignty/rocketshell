import { describe, expect, it, vi } from "vitest";
import { ALL_DOMAINS, OPTIONAL_DOMAINS, PLATFORM_DATABASE_NAMES, PLATFORM_REQUIRED_DOMAINS, SubscriptionRegistry, assertPlatformProfile, createPlatformTelemetry, isPlatformFailure, isStructuredCloneSafe } from "../src/index.js";

describe("platform contract", () => {
  it("rejects missing required domains", () => {
    expect(() => assertPlatformProfile({ supports: (domain) => domain !== "relay" })).toThrow("relay");
  });
  it("separates required and optional capability domains", () => {
    expect(PLATFORM_REQUIRED_DOMAINS).toContain("resource");
    expect(OPTIONAL_DOMAINS.has("notify")).toBe(true);
    expect(OPTIONAL_DOMAINS.has("resource")).toBe(false);
    expect(ALL_DOMAINS).toContain("cvm");
  });
  it("recognizes only stable failures", () => {
    expect(isPlatformFailure({ code: "signed-out", message: "No account" })).toBe(true);
    expect(isPlatformFailure({ code: "surprise", message: "No" })).toBe(false);
  });
  it("accepts plain clone-safe payloads and rejects cyclic data", () => {
    expect(isStructuredCloneSafe({ ok: [1, "two", null] })).toBe(true);
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(isStructuredCloneSafe(cyclic)).toBe(false);
  });
  it("closes owned subscriptions once", () => {
    const close = vi.fn(); const registry = new SubscriptionRegistry();
    registry.add({ close }); registry.close(); registry.close();
    expect(close).toHaveBeenCalledOnce();
  });
  it("bounds telemetry and drops sensitive labels", () => {
    const telemetry = createPlatformTelemetry({ maximumRecords: 1, now: () => 10 });
    telemetry.record("event.received", 1, { relay: "wss://relay.example/", authorization: "secret" });
    telemetry.record("event.admitted", 1, { kind: 1 });
    expect(telemetry.snapshot()).toEqual([{ name: "event.admitted", value: 1, timestamp: 10, labels: { kind: 1 } }]);
  });
  it("assigns disjoint persistence namespaces", () => {
    const names = Object.values(PLATFORM_DATABASE_NAMES);
    expect(new Set(names).size).toBe(names.length);
  });
});
