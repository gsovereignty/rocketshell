import { AccountManager } from "applesauce-accounts";
import type { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { describe, expect, it, vi } from "vitest";
import { createAccountController } from "../src/index.js";

describe("account controller", () => {
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
});
