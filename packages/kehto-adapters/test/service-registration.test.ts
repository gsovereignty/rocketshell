import type { Runtime, ServiceHandler } from "@kehto/runtime";
import { createNostrEngine } from "@platform/nostr-engine";
import { describe, expect, it, vi } from "vitest";
import { createOutboxRelayPool, registerCoreServices } from "../src/index.js";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";

describe("core service lifecycle", () => {
  it("notifies account-sensitive services for every live window on account change", async () => {
    const handlers = new Map<string, ServiceHandler>();
    const injectEvent = vi.fn();
    const runtime = {
      registerService: (name: string, handler: ServiceHandler) => handlers.set(name, handler),
      sessionRegistry: { getAllEntries: () => [{ windowId: "window-1" }, { windowId: "window-2" }] },
      injectEvent
    } as unknown as Runtime;
    const engine = createNostrEngine();
    const registration = registerCoreServices(runtime, engine, { directReadRelays: [], directWriteRelays: [] });
    const relayCleanup = vi.fn(); const outboxCleanup = vi.fn();
    handlers.get("relay")!.onWindowDestroyed = relayCleanup;
    handlers.get("outbox")!.onWindowDestroyed = outboxCleanup;
    engine.accounts.manager.active$.next(undefined);
    expect(relayCleanup.mock.calls).toEqual([["window-1"], ["window-2"]]);
    expect(outboxCleanup.mock.calls).toEqual([["window-1"], ["window-2"]]);
    expect(injectEvent).toHaveBeenCalledWith("identity:changed", { pubkey: null });
    registration.close(); await engine.close();
  });
  it("maps each Applesauce publish outcome to its relay", async () => {
    const engine = createNostrEngine();
    const publish = vi.spyOn(engine.relayPool, "publish").mockResolvedValue([
      { from: "wss://one.example/", ok: true, message: "saved" },
      { from: "wss://two.example/", ok: false, message: "blocked" }
    ]);
    const pool = createOutboxRelayPool(engine, [], ["wss://one.example/", "wss://two.example/"]);
    const event = finalizeEvent({ kind: 1, created_at: 1, content: "publish", tags: [] }, generateSecretKey());
    await expect(pool.publish(event, ["wss://one.example/", "wss://two.example/"])).resolves.toEqual({
      "wss://one.example/": true, "wss://two.example/": false
    });
    expect(publish).toHaveBeenCalledWith(["wss://one.example/", "wss://two.example/"], event, { retries: false });
    await engine.close();
  });
});
