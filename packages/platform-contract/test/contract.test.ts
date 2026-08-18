import { describe, expect, it, vi } from "vitest";
import { SubscriptionRegistry, assertPlatformProfile, isPlatformFailure, isStructuredCloneSafe } from "../src/index.js";

describe("platform contract", () => {
  it("rejects missing required domains", () => {
    expect(() => assertPlatformProfile({ supports: (domain) => domain !== "relay" })).toThrow("relay");
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
});
