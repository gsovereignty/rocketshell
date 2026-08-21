import { AccountManager } from "applesauce-accounts";
import type { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAccountController } from "../src/index.js";

describe("account controller", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("connects and activates a NIP-07 extension account", async () => {
    const pubkey = "11".repeat(32);
    vi.stubGlobal("window", { nostr: { getPublicKey: vi.fn(async () => pubkey) } });
    const controller = createAccountController(new AccountManager());
    await expect(controller.connectExtension()).resolves.toBe(pubkey);
    expect(controller.publicKey).toBe(pubkey);
    controller.signOut();
    expect(controller.publicKey).toBe("");
    controller.close();
  });

  it("creates a signing account that is removed on sign out", async () => {
    const manager = new AccountManager();
    const controller = createAccountController(manager);
    const pubkey = await controller.connectEphemeral();
    expect(pubkey).toMatch(/^[0-9a-f]{64}$/);
    await expect(controller.sign({ kind: 1, created_at: 1, content: "ephemeral", tags: [] }))
      .resolves.toMatchObject({ pubkey, content: "ephemeral" });
    expect(manager.accounts).toHaveLength(1);
    controller.signOut();
    expect(manager.accounts).toHaveLength(0);
    controller.close();
  });

  it("invalidates signing work when active account is removed", async () => {
    const manager = new AccountManager();
    let finish: ((event: NostrEvent) => void) | undefined;
    const pending = new Promise<NostrEvent>((resolve) => { finish = resolve; });
    const account = {
      id: "pending", type: "test", pubkey: "11".repeat(32), signer: undefined as never,
      getPublicKey: async () => "11".repeat(32), signEvent: (_template: EventTemplate) => pending,
      toJSON: () => ({ id: "pending", type: "test", pubkey: "11".repeat(32), signer: null })
    };
    account.signer = account as never;
    manager.addAccount(account as never); manager.setActive(account as never);
    const controller = createAccountController(manager);
    const signing = controller.sign({ kind: 1, created_at: 1, content: "pending", tags: [] });
    manager.removeAccount(account as never);
    finish?.(finalizeEvent({ kind: 1, created_at: 1, content: "pending", tags: [] }, generateSecretKey()));
    await expect(signing).rejects.toMatchObject({ failure: { code: "signer-unavailable" } });
    expect(controller.publicKey).toBe("");
    controller.close();
  });
  it("invalidates encrypted work when the active account changes", async () => {
    const manager = new AccountManager(); let finish: ((value: string) => void) | undefined;
    const pending = new Promise<string>((resolve) => { finish = resolve; });
    const account = {
      id: "encrypted", type: "test", pubkey: "11".repeat(32), signer: undefined as never,
      getPublicKey: async () => "11".repeat(32), signEvent: async () => ({} as NostrEvent), toJSON: () => ({}),
      nip44: { encrypt: () => pending, decrypt: async () => "plain" }
    };
    account.signer = account as never; manager.addAccount(account as never); manager.setActive(account as never);
    const controller = createAccountController(manager); const encryption = controller.nip44Encrypt("22".repeat(32), "secret");
    manager.removeAccount(account as never); finish?.("ciphertext");
    await expect(encryption).rejects.toMatchObject({ failure: { code: "signer-unavailable" } });
    controller.close();
  });
  it("rejects oversized templates before invoking the signer", async () => {
    const manager = new AccountManager(); const signEvent = vi.fn();
    const account = {
      id: "limited", type: "test", pubkey: "11".repeat(32), signer: undefined as never,
      getPublicKey: async () => "11".repeat(32), signEvent, toJSON: () => ({})
    };
    account.signer = account as never; manager.addAccount(account as never); manager.setActive(account as never);
    const controller = createAccountController(manager);
    await expect(controller.sign({ kind: 1, created_at: 1, content: "x".repeat(256 * 1024 + 1), tags: [] })).rejects.toThrow("invalid-event");
    expect(signEvent).not.toHaveBeenCalled();
    controller.close();
  });
  it("reports only signatures completed for the current account", async () => {
    const manager = new AccountManager(); const signed: NostrEvent[] = [];
    const secretKey = generateSecretKey();
    const event = finalizeEvent({ kind: 1, created_at: 1, content: "signed", tags: [] }, secretKey);
    const account = {
      id: "reporting", type: "test", pubkey: event.pubkey, signer: undefined as never,
      getPublicKey: async () => event.pubkey, signEvent: async () => event, toJSON: () => ({})
    };
    account.signer = account as never; manager.addAccount(account as never); manager.setActive(account as never);
    const controller = createAccountController(manager, (result) => signed.push(result));
    await expect(controller.sign({ kind: 1, created_at: 1, content: "signed", tags: [] })).resolves.toBe(event);
    expect(signed).toEqual([event]);
    controller.close();
  });
});
