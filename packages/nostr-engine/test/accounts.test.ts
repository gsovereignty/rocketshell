import { AccountManager } from "applesauce-accounts";
import type { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
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
});
