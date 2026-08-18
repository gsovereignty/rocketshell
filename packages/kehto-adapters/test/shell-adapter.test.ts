import { createShellBridge } from "@kehto/shell";
import type { ServiceHandler } from "@kehto/runtime";
import { createNostrEngine } from "@platform/nostr-engine";
import type { GroupReqMessage } from "applesauce-relay";
import { Subject } from "rxjs";
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
  it("stops an ACL-denied outbox request before service work", async () => {
    const engine = createNostrEngine();
    const adapter = createPlatformShellAdapter({
      engine, discoveryRelays: [], readRelays: [], writeRelays: [], createWindow: () => null
    });
    const shell = createShellBridge(adapter);
    const handleMessage = vi.fn();
    shell.runtime.registerService("outbox", {
      descriptor: { name: "outbox", version: "1.0.0" }, handleMessage
    } as ServiceHandler);
    shell.runtime.sessionRegistry.register("window-1", {
      pubkey: "", windowId: "window-1", origin: "null", type: "napplet",
      dTag: "fixture", aggregateHash: "a".repeat(64), registeredAt: Date.now(),
      instanceId: "instance-1", provenance: "nip-5d"
    });
    shell.runtime.aclState.revoke("", "fixture", "a".repeat(64), "outbox:read");
    shell.runtime.handleMessage("window-1", { type: "outbox.query", id: "query-1", filters: [{}] });
    expect(handleMessage).not.toHaveBeenCalled();
    shell.destroy(); adapter.close(); await engine.close();
  });
  it("blocks late relay delivery after scoped window cleanup", async () => {
    const engine = createNostrEngine(); const messages = new Subject<GroupReqMessage>();
    vi.spyOn(engine.relayPool, "req").mockReturnValue(messages);
    const adapter = createPlatformShellAdapter({
      engine, discoveryRelays: [], readRelays: ["wss://relay.example/"], writeRelays: [], createWindow: () => null
    });
    const postMessage = vi.fn();
    adapter.relayPool.openScopedRelay("window-1", "wss://relay.example/", "sub-1", [{}], { postMessage } as unknown as Window);
    adapter.relayPool.closeScopedRelay("window-1");
    messages.next({ type: "EOSE", from: "wss://relay.example/", id: "sub-1" });
    expect(postMessage).not.toHaveBeenCalled();
    adapter.close(); await engine.close();
  });
});
