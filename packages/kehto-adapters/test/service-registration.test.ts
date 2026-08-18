import type { Runtime, ServiceHandler } from "@kehto/runtime";
import { createNostrEngine } from "@platform/nostr-engine";
import { describe, expect, it, vi } from "vitest";
import { createOutboxRelayPool, createRelayConfiguration, registerCoreServices } from "../src/index.js";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";

describe("core service lifecycle", () => {
  it("notifies account-sensitive services for every live window on account change", async () => {
    const handlers = new Map<string, ServiceHandler>();
    const publishIdentityChanged = vi.fn();
    const runtime = {
      registerService: (name: string, handler: ServiceHandler) => handlers.set(name, handler),
      sessionRegistry: { getAllEntries: () => [{ windowId: "window-1" }, { windowId: "window-2" }] },
      injectEvent: vi.fn()
    } as unknown as Runtime;
    const engine = createNostrEngine();
    const registration = registerCoreServices({ runtime, publishIdentityChanged }, engine, { directReadRelays: [], directWriteRelays: [] });
    const relayCleanup = vi.fn(); const outboxCleanup = vi.fn();
    handlers.get("relay")!.onWindowDestroyed = relayCleanup;
    handlers.get("outbox")!.onWindowDestroyed = outboxCleanup;
    engine.accounts.manager.active$.next(undefined);
    expect(relayCleanup.mock.calls).toEqual([["window-1"], ["window-2"]]);
    expect(outboxCleanup.mock.calls).toEqual([["window-1"], ["window-2"]]);
    expect(publishIdentityChanged).toHaveBeenCalledWith("");
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
    expect(publish).toHaveBeenCalledWith(["wss://one.example/", "wss://two.example/"], event, { retries: false, timeout: 4_000 });
    expect(engine.eventStore.getEvent(event.id)?.id).toBe(event.id);
    const invalid = { ...event, content: "tampered" };
    await expect(pool.publish(invalid, ["wss://one.example/"])).rejects.toThrow("invalid-event");
    expect(publish).toHaveBeenCalledOnce();
    await engine.close();
  });
  it("rejects excessive outbox filters before opening relay work", async () => {
    const engine = createNostrEngine(); const req = vi.spyOn(engine.relayPool, "req");
    const pool = createOutboxRelayPool(engine, ["wss://relay.example/"], []);
    expect(() => pool.subscribe(Array.from({ length: 9 }, () => ({})), ["wss://relay.example/"], vi.fn())).toThrow("invalid-filter");
    expect(req).not.toHaveBeenCalled();
    await engine.close();
  });
  it("keeps service relay tiers synchronized with shell mutations", async () => {
    const engine = createNostrEngine();
    const configuration = createRelayConfiguration(engine.relayPolicy, { discovery: [], super: [], outbox: [] });
    const pool = createOutboxRelayPool(engine, configuration.values("super"), configuration.values("outbox"));
    expect(pool.isAvailable()).toBe(false);
    const liveReadRelays = configuration.values("super");
    configuration.add("super", "wss://read.example");
    configuration.add("outbox", "wss://relay.example");
    expect(pool.isAvailable()).toBe(true);
    expect(liveReadRelays).toEqual(["wss://read.example/"]);
    expect(configuration.snapshot().outbox).toEqual(["wss://relay.example/"]);
    await engine.close();
  });
  it("serves current profile and follows from the shared EventStore", async () => {
    const handlers = new Map<string, ServiceHandler>();
    const runtime = {
      registerService: (name: string, handler: ServiceHandler) => handlers.set(name, handler),
      sessionRegistry: { getAllEntries: () => [] }
    } as unknown as Runtime;
    const engine = createNostrEngine();
    const secret = generateSecretKey();
    const profile = finalizeEvent({ kind: 0, created_at: 2, content: JSON.stringify({ name: "alice", display_name: "Alice" }), tags: [] }, secret);
    const contacts = finalizeEvent({ kind: 3, created_at: 2, content: "", tags: [["p", "11".repeat(32)], ["p", "22".repeat(32)]] }, secret);
    engine.ingress.admit(profile, "local:test"); engine.ingress.admit(contacts, "local:test");
    const account = {
      id: "identity", type: "test", pubkey: profile.pubkey, signer: undefined as never,
      getPublicKey: async () => profile.pubkey, signEvent: vi.fn(), toJSON: () => ({})
    };
    account.signer = account as never; engine.accounts.manager.addAccount(account as never); engine.accounts.manager.setActive(account as never);
    const registration = registerCoreServices({ runtime, publishIdentityChanged: vi.fn() }, engine, { directReadRelays: [], directWriteRelays: [] });
    const identity = handlers.get("identity")!;
    const profileSend = vi.fn(); const followsSend = vi.fn();
    identity.handleMessage("window-1", { type: "identity.getProfile", id: "profile" } as never, profileSend);
    identity.handleMessage("window-1", { type: "identity.getFollows", id: "follows" } as never, followsSend);
    await vi.waitFor(() => expect(profileSend).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(followsSend).toHaveBeenCalledOnce());
    expect(profileSend).toHaveBeenCalledWith({ type: "identity.getProfile.result", id: "profile", profile: { name: "alice", displayName: "Alice" } });
    expect(followsSend).toHaveBeenCalledWith({ type: "identity.getFollows.result", id: "follows", pubkeys: ["11".repeat(32), "22".repeat(32)] });
    registration.close(); await engine.close();
  });
});
