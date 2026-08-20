import { createShellBridge, originRegistry } from "@kehto/shell";
import type { ServiceHandler } from "@kehto/runtime";
import type { GroupReqMessage } from "applesauce-relay";
import { Observable, Subject } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { freshAdapters } from "./fresh.js";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";

describe("shell adapter lifecycle", () => {
  afterEach(() => vi.useRealTimers());
  it("exposes active signer encryption without exposing the account", async () => {
    const { engine, adapters } = await freshAdapters();
    const account = {
      id: "encrypted", type: "test", pubkey: "11".repeat(32), signer: undefined as never,
      getPublicKey: async () => "11".repeat(32), signEvent: async () => finalizeEvent({ kind: 1, created_at: 1, content: "x", tags: [] }, generateSecretKey()),
      nip44: { encrypt: vi.fn(async () => "ciphertext"), decrypt: vi.fn(async () => "plaintext") }, toJSON: () => ({})
    };
    account.signer = account as never; engine.accounts.manager.addAccount(account as never); engine.accounts.manager.setActive(account as never);
    const adapter = adapters.createPlatformShellAdapter({ discoveryRelays: [], readRelays: [], writeRelays: [], createWindow: () => null });
    const signer = adapter.auth.getSigner();
    await expect(signer.nip44.encrypt("22".repeat(32), "secret")).resolves.toBe("ciphertext");
    expect(signer.manager).toBeUndefined(); expect(signer.account).toBeUndefined();
    adapter.close(); engine.shutdownNostrServices();
  });
  it("policy-gates shell fallback relay URLs before transport", async () => {
    const { engine, adapters } = await freshAdapters(); const req = vi.spyOn(engine.relayPool, "req");
    const pool = adapters.relayPoolLike;
    expect(() => pool.subscription(["ws://remote.example"], [{}])).toThrow("scheme");
    expect(req).not.toHaveBeenCalled();
    const publish = vi.spyOn(engine.relayPool, "publish");
    const event = finalizeEvent({ kind: 1, created_at: 1, content: "valid", tags: [] }, generateSecretKey());
    await expect(pool.publish(["wss://relay.example"], { ...event, content: "tampered" })).rejects.toThrow("invalid-event");
    expect(publish).not.toHaveBeenCalled();
    engine.shutdownNostrServices();
  });
  it("bounds shell fallback count requests and tears down transport", async () => {
    vi.useFakeTimers();
    const { engine, adapters } = await freshAdapters();
    const cleanup = vi.fn();
    const count = vi.spyOn(engine.relayPool, "count").mockReturnValue(new Observable(() => cleanup));
    const pool = adapters.relayPoolLike;
    const pending = pool.count!(["wss://relay.example"], [{ kinds: [1] }]);
    const rejection = expect(pending).rejects.toThrow("query-timeout");
    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;
    expect(count).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    engine.shutdownNostrServices();
  });
  it("applies relay configuration changes through the shared policy", async () => {
    const { engine, adapters } = await freshAdapters();
    const adapter = adapters.createPlatformShellAdapter({
      discoveryRelays: [], readRelays: [], writeRelays: [], createWindow: () => null
    });
    adapter.relayConfig.addRelay("super", "WSS://Relay.Example");
    expect(adapter.relayConfig.getRelayConfig().super).toEqual(["wss://relay.example/"]);
    expect(adapter.relayPool.selectRelayTier([])).toEqual(["wss://relay.example/"]);
    adapter.relayConfig.removeRelay("super", "wss://relay.example/");
    expect(adapter.relayConfig.getRelayConfig().super).toEqual([]);
    expect(() => adapter.relayConfig.addRelay("unknown", "wss://relay.example/")).toThrow("Unsupported relay tier");
    adapter.close(); engine.shutdownNostrServices();
  });
  it("parses and bounds Kehto worker-relay protocol requests", async () => {
    const { engine, adapters } = await freshAdapters();
    const event = finalizeEvent({ kind: 1, created_at: 1, content: "cached", tags: [] }, generateSecretKey());
    engine.ingress.admit(event, "local:test");
    const adapter = adapters.createPlatformShellAdapter({
      discoveryRelays: [], readRelays: [], writeRelays: [], createWindow: () => null
    });
    const worker = adapter.workerRelay.getWorkerRelay()!;
    const queried = await worker.query(["REQ", "sub-1", { kinds: [1] }]);
    expect(queried).toHaveLength(1); expect(queried[0]).toMatchObject({ id: event.id, content: "cached" });
    expect(Object.getOwnPropertySymbols(queried[0]!)).toEqual([]);
    await expect(worker.count!(["COUNT", "count-1", { kinds: [1] }])).resolves.toBe(1);
    await expect(worker.query([{ kinds: [1] }])).rejects.toThrow("invalid-request");
    await expect(worker.query(["REQ", "sub-2", {}])).resolves.toHaveLength(1);
    await expect(worker.query(["REQ", "sub-3", {}, {}, {}, {}, {}, {}, {}, {}, {}])).rejects.toThrow("invalid-filter");
    adapter.close(); engine.shutdownNostrServices();
  });
  it("closes account-sensitive work when active account changes", async () => {
    const { engine, adapters } = await freshAdapters(); const cleanup = vi.fn();
    const adapter = adapters.createPlatformShellAdapter({
      discoveryRelays: [], readRelays: [], writeRelays: [], createWindow: () => null
    });
    adapter.relayPool.trackSubscription("window:subscription", cleanup);
    engine.accounts.manager.active$.next(undefined);
    expect(cleanup).toHaveBeenCalledOnce();
    adapter.close(); adapter.close();
    engine.shutdownNostrServices();
  });
  it("stops an ACL-denied outbox request before service work", async () => {
    const { engine, adapters } = await freshAdapters();
    const adapter = adapters.createPlatformShellAdapter({
      discoveryRelays: [], readRelays: [], writeRelays: [], createWindow: () => null
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
    shell.destroy(); adapter.close(); engine.shutdownNostrServices();
  });
  it("blocks late relay delivery after scoped window cleanup", async () => {
    const { engine, adapters } = await freshAdapters(); const messages = new Subject<GroupReqMessage>();
    vi.spyOn(engine.relayPool, "req").mockReturnValue(messages);
    const adapter = adapters.createPlatformShellAdapter({
      discoveryRelays: [], readRelays: ["wss://relay.example/"], writeRelays: [], createWindow: () => null
    });
    const postMessage = vi.fn();
    adapter.relayPool.openScopedRelay("window-1", "wss://relay.example/", "sub-1", [{}], { postMessage } as unknown as Window);
    adapter.relayPool.closeScopedRelay("window-1");
    messages.next({ type: "EOSE", from: "wss://relay.example/", id: "sub-1" });
    expect(postMessage).not.toHaveBeenCalled();
    adapter.close(); engine.shutdownNostrServices();
  });
  it("verifies and admits accepted scoped publication", async () => {
    const { engine, adapters } = await freshAdapters(); const messages = new Subject<GroupReqMessage>();
    vi.spyOn(engine.relayPool, "req").mockReturnValue(messages);
    const publish = vi.spyOn(engine.relayPool, "publish").mockResolvedValue([{ from: "wss://relay.example/", ok: true, message: "saved" }]);
    const adapter = adapters.createPlatformShellAdapter({
      discoveryRelays: [], readRelays: [], writeRelays: [], createWindow: () => null
    });
    adapter.relayPool.openScopedRelay("window-1", "wss://relay.example/", "sub-1", [{}], { postMessage: vi.fn() } as unknown as Window);
    const event = finalizeEvent({ kind: 1, created_at: 1, content: "scoped", tags: [] }, generateSecretKey());
    await expect(adapter.relayPool.publishToScopedRelay("window-1", event)).resolves.toBe(true);
    expect(engine.eventStore.getEvent(event.id)?.id).toBe(event.id);
    await expect(adapter.relayPool.publishToScopedRelay("window-1", { ...event, content: "tampered" })).resolves.toBe(false);
    expect(publish).toHaveBeenCalledOnce();
    adapter.close(); engine.shutdownNostrServices();
  });
  it("delivers identity changes only to authorized live windows", async () => {
    const { engine, adapters } = await freshAdapters();
    const adapter = adapters.createPlatformShellAdapter({
      discoveryRelays: [], readRelays: [], writeRelays: [], createWindow: () => null
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
    shell.destroy(); adapter.close(); engine.shutdownNostrServices();
  });
});
