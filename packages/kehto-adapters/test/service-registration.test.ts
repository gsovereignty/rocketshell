import type { Runtime, ServiceHandler } from "@kehto/runtime";
import { createNostrEngine } from "@platform/nostr-engine";
import { describe, expect, it, vi } from "vitest";
import { registerCoreServices } from "../src/index.js";

describe("core service lifecycle", () => {
  it("notifies account-sensitive services for every live window on account change", async () => {
    const handlers = new Map<string, ServiceHandler>();
    const runtime = {
      registerService: (name: string, handler: ServiceHandler) => handlers.set(name, handler),
      sessionRegistry: { getAllEntries: () => [{ windowId: "window-1" }, { windowId: "window-2" }] }
    } as unknown as Runtime;
    const engine = createNostrEngine();
    const registration = registerCoreServices(runtime, engine, { directReadRelays: [], directWriteRelays: [] });
    const relayCleanup = vi.fn(); const outboxCleanup = vi.fn();
    handlers.get("relay")!.onWindowDestroyed = relayCleanup;
    handlers.get("outbox")!.onWindowDestroyed = outboxCleanup;
    engine.accounts.manager.active$.next(undefined);
    expect(relayCleanup.mock.calls).toEqual([["window-1"], ["window-2"]]);
    expect(outboxCleanup.mock.calls).toEqual([["window-1"], ["window-2"]]);
    registration.close(); await engine.close();
  });
});
