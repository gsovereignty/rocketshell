import { createNostrEngine } from "@platform/nostr-engine";
import { describe, expect, it, vi } from "vitest";
import { createPlatformShellAdapter } from "../src/index.js";

describe("shell adapter lifecycle", () => {
  it("closes account-sensitive work when active account changes", async () => {
    const engine = createNostrEngine(); const cleanup = vi.fn();
    const adapter = createPlatformShellAdapter({
      engine, discoveryRelays: [], readRelays: [], writeRelays: [], createWindow: () => null
    });
    adapter.relayPool.trackSubscription("window:subscription", cleanup);
    engine.accounts.manager.active$.next(undefined);
    expect(cleanup).toHaveBeenCalledOnce();
    adapter.close(); adapter.close();
    await engine.close();
  });
});
