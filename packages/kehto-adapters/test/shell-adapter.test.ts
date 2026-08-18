import { createShellBridge, originRegistry } from "@kehto/shell";
import type { ServiceHandler } from "@kehto/runtime";
import { createNostrEngine } from "@platform/nostr-engine";
import type { GroupReqMessage } from "applesauce-relay";
import { Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { createPlatformShellAdapter, createRelayPoolLike } from "../src/index.js";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";

describe("shell adapter lifecycle", () => {
  it("exposes active signer encryption without exposing the account", async () => {
    const engine = createNostrEngine();
    const account = {
      id: "encrypted", type: "test", pubkey: "11".repeat(32), signer: undefined as never,
      getPublicKey: async () => "11".repeat(32), signEvent: async () => finalizeEvent({ kind: 1, created_at: 1, content: "x", tags: [] }, generateSecretKey()),
      nip44: { encrypt: vi.fn(async () => "ciphertext"), decrypt: vi.fn(async () => "plaintext") }, toJSON: () => ({})
    };
    account.signer = account as never; engine.accounts.manager.addAccount(account as never); engine.accounts.manager.setActive(account as never);
    const adapter = createPlatformShellAdapter({ engine, discoveryRelays: [], readRelays: [], writeRelays: [], createWindow: () => null });
    const signer = adapter.auth.getSigner();
    await expect(signer.nip44.encrypt("22".repeat(32), "secret")).resolves.toBe("ciphertext");
    expect(signer.manager).toBeUndefined(); expect(signer.account).toBeUndefined();
    adapter.close(); await engine.close();
  });
  it("policy-gates shell fallback relay URLs before transport", async () => {
    const engine = createNostrEngine(); const req = vi.spyOn(engine.relayPool, "req");
    const pool = createRelayPoolLike(engine);
    expect(() => pool.subscription(["ws://remote.example"], [{}])).toThrow("scheme");
    expect(req).not.toHaveBeenCalled();
    const publish = vi.spyOn(engine.relayPool, "publish");
    const event = finalizeEvent({ kind: 1, created_at: 1, content: "valid", tags: [] }, generateSecretKey());
    await expect(pool.publish(["wss://relay.example"], { ...event, content: "tampered" })).rejects.toThrow("invalid-event");
    expect(publish).not.toHaveBeenCalled();
    await engine.close();
  });
  it("applies relay configuration changes through the shared policy", async () => {
    const engine = createNostrEngine();
    const adapter = createPlatformShellAdapter({
      engine, discoveryRelays: [], readRelays: [], writeRelays: [], createWindow: () => null
    });
    adapter.relayConfig.addRelay("super", "WSS://Relay.Example");
    expect(adapter.relayConfig.getRelayConfig().super).toEqual(["wss://relay.example/"]);
    expect(adapter.relayPool.selectRelayTier([])).toEqual(["wss://relay.example/"]);
    adapter.relayConfig.removeRelay("super", "wss://relay.example/");
    expect(adapter.relayConfig.getRelayConfig().super).toEqual([]);
    expect(() => adapter.relayConfig.addRelay("unknown", "wss://relay.example/")).toThrow("Unsupported relay tier");
    adapter.close(); await engine.close();
  });
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
  it("verifies and admits accepted scoped publication", async () => {
    const engine = createNostrEngine(); const messages = new Subject<GroupReqMessage>();
    vi.spyOn(engine.relayPool, "req").mockReturnValue(messages);
    const publish = vi.spyOn(engine.relayPool, "publish").mockResolvedValue([{ from: "wss://relay.example/", ok: true, message: "saved" }]);
    const adapter = createPlatformShellAdapter({
      engine, discoveryRelays: [], readRelays: [], writeRelays: [], createWindow: () => null
    });
    adapter.relayPool.openScopedRelay("window-1", "wss://relay.example/", "sub-1", [{}], { postMessage: vi.fn() } as unknown as Window);
    const event = finalizeEvent({ kind: 1, created_at: 1, content: "scoped", tags: [] }, generateSecretKey());
    await expect(adapter.relayPool.publishToScopedRelay("window-1", event)).resolves.toBe(true);
    expect(engine.eventStore.getEvent(event.id)?.id).toBe(event.id);
    await expect(adapter.relayPool.publishToScopedRelay("window-1", { ...event, content: "tampered" })).resolves.toBe(false);
    expect(publish).toHaveBeenCalledOnce();
    adapter.close(); await engine.close();
  });
  it("delivers identity changes only to authorized live windows", async () => {
    const engine = createNostrEngine();
    const adapter = createPlatformShellAdapter({
      engine, discoveryRelays: [], readRelays: [], writeRelays: [], createWindow: () => null
    });
    const shell = createShellBridge(adapter);
    const allowedSource = { postMessage: vi.fn() }; const deniedSource = { postMessage: vi.fn() };
    for (const [windowId, source, dTag] of [["allowed", allowedSource, "allowed-app"], ["denied", deniedSource, "denied-app"]] as const) {
      originRegistry.register(source as unknown as Window, windowId, { dTag, aggregateHash: "a".repeat(64) });
      originRegistry.setEnvironment(source as unknown as Window, { capabilities: { domains: ["identity"] }, services: [] });
      shell.runtime.sessionRegistry.register(windowId, {
        pubkey: "", windowId, origin: "null", type: "napplet", dTag, aggregateHash: "a".repeat(64),
        registeredAt: Date.now(), instanceId: `${windowId}-instance`, provenance: "nip-5d"
      });
      shell.runtime.aclState.grant("", dTag, "a".repeat(64), "identity:read");
      shell.handleMessage({ source, origin: "null", data: { type: "shell.ready" } } as unknown as MessageEvent);
      source.postMessage.mockClear();
    }
    shell.runtime.aclState.revoke("", "denied-app", "a".repeat(64), "identity:read");
    expect(originRegistry.getIframeWindow("allowed")).toBe(allowedSource);
    expect(originRegistry.getEnvironment(allowedSource as unknown as Window)?.capabilities.domains).toContain("identity");
    expect(shell.runtime.aclState.check("", "allowed-app", "a".repeat(64), "identity:read")).toBe(true);
    shell.publishIdentityChanged("");
    expect(allowedSource.postMessage).toHaveBeenCalledWith({ type: "identity.changed", pubkey: "" }, "*");
    expect(deniedSource.postMessage).not.toHaveBeenCalled();
    originRegistry.unregister("allowed"); originRegistry.unregister("denied");
    shell.destroy(); adapter.close(); await engine.close();
  });
});
