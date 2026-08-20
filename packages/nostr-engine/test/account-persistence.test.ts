import { AccountManager } from "applesauce-accounts";
import { ReadonlyAccount, registerCommonAccountTypes } from "applesauce-accounts/accounts";
import { describe, expect, it, vi } from "vitest";
import { createPersistentAccountManager, PRIVATE_ACCOUNT_DATABASE_NAME, type AccountSnapshot, type AccountSnapshotStore } from "../src/index.js";

describe("private account persistence", () => {
  it("uses the isolated private database namespace", () => {
    expect(PRIVATE_ACCOUNT_DATABASE_NAME).toBe("platform-private");
    expect(PRIVATE_ACCOUNT_DATABASE_NAME).not.toBe("platform-events");
  });

  it("restores accounts and active selection, then flushes changes", async () => {
    const first = ReadonlyAccount.fromPubkey("11".repeat(32));
    const snapshots: AccountSnapshot[] = [];
    const store: AccountSnapshotStore = {
      load: vi.fn(async () => ({ accounts: [first.toJSON()], activeAccountId: first.id })),
      save: vi.fn(async (snapshot) => { snapshots.push(structuredClone(snapshot)); }),
      close: vi.fn()
    };
    // Type registration is the caller's job now, so the shared manager is not registered twice.
    const manager = new AccountManager();
    registerCommonAccountTypes(manager);
    const persistent = await createPersistentAccountManager(store, manager);
    expect(persistent.manager.active?.id).toBe(first.id);
    const second = ReadonlyAccount.fromPubkey("22".repeat(32));
    persistent.manager.addAccount(second as never); persistent.manager.setActive(second.id);
    await persistent.close();
    expect(snapshots.at(-1)).toMatchObject({ activeAccountId: second.id });
    expect(snapshots.at(-1)?.accounts.map((account) => account.id)).toEqual([first.id, second.id]);
    expect(store.close).toHaveBeenCalledOnce();
  });
});
