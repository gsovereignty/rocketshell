import { ReadonlyAccount } from "applesauce-accounts/accounts";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { firstValueFrom, type Observable } from "rxjs";
import { describe, expect, it } from "vitest";
import { freshServices } from "./fresh.js";

/**
 * The settled value, not the first.
 *
 * Each source seeds an immediate `undefined` so the loader is never left without relays at boot,
 * which means the first emission is always the fallback. Subscribing and letting the cast resolve
 * is what a real consumer does.
 */
const settle = async <T>(source: Observable<T>): Promise<T> => {
  const subscription = source.subscribe();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const value = await firstValueFrom(source);
  subscription.unsubscribe();
  return value;
};

/**
 * A fresh identity per test.
 *
 * `User.cache` is global and keyed by pubkey, and vitest does not re-evaluate externalized
 * dependencies on `resetModules`, so reusing a pubkey would hand back a cast still bound to a
 * previous test's event store.
 */
const identity = () => {
  const secret = generateSecretKey();
  return (created: number, relays: readonly string[]) => finalizeEvent({
    kind: 10_002, created_at: created, content: "", tags: relays.map((relay) => ["r", relay])
  }, secret);
};

describe("reactive relay sources", () => {
  it("falls back to the settings list while signed out", async () => {
    const { fallbackRelays$, writeRelays$ } = await freshServices();
    fallbackRelays$.next(["wss://backup.test/"]);
    await expect(settle(writeRelays$)).resolves.toEqual(["wss://backup.test/"]);
  });

  it("prefers the account's own list over the settings fallback", async () => {
    const { accountManager, fallbackRelays$, ingress, writeRelays$ } = await freshServices();
    fallbackRelays$.next(["wss://backup.test/"]);
    const mailboxes = identity();
    const event = mailboxes(1, ["wss://own.test/"]);
    ingress.admit(event, "local:test");
    accountManager.addAccount(ReadonlyAccount.fromPubkey(event.pubkey) as never);
    accountManager.setActive(accountManager.accounts[0]!.id);
    await expect(settle(writeRelays$)).resolves.toEqual(["wss://own.test/"]);
  });

  it("returns to the fallback when the account signs out", async () => {
    const { accountManager, fallbackRelays$, ingress, writeRelays$ } = await freshServices();
    fallbackRelays$.next(["wss://backup.test/"]);
    const mailboxes = identity();
    const event = mailboxes(1, ["wss://own.test/"]);
    ingress.admit(event, "local:test");
    accountManager.addAccount(ReadonlyAccount.fromPubkey(event.pubkey) as never);
    accountManager.setActive(accountManager.accounts[0]!.id);
    await expect(settle(writeRelays$)).resolves.toEqual(["wss://own.test/"]);
    accountManager.clearActive();
    await expect(settle(writeRelays$)).resolves.toEqual(["wss://backup.test/"]);
  });

  it("keeps the fallback when the account publishes an empty list", async () => {
    const { accountManager, fallbackRelays$, ingress, writeRelays$ } = await freshServices();
    fallbackRelays$.next(["wss://backup.test/"]);
    const mailboxes = identity();
    const event = mailboxes(1, []);
    ingress.admit(event, "local:test");
    accountManager.addAccount(ReadonlyAccount.fromPubkey(event.pubkey) as never);
    accountManager.setActive(accountManager.accounts[0]!.id);
    await expect(settle(writeRelays$)).resolves.toEqual(["wss://backup.test/"]);
  });

  it("tracks a newer list published for the same account", async () => {
    const { accountManager, fallbackRelays$, ingress, outboxes$ } = await freshServices();
    fallbackRelays$.next([]);
    const mailboxes = identity();
    const first = mailboxes(1, ["wss://first.test/"]);
    ingress.admit(first, "local:test");
    accountManager.addAccount(ReadonlyAccount.fromPubkey(first.pubkey) as never);
    accountManager.setActive(accountManager.accounts[0]!.id);
    await expect(settle(outboxes$)).resolves.toEqual(["wss://first.test/"]);
    ingress.admit(mailboxes(2, ["wss://second.test/"]), "local:test");
    await expect(settle(outboxes$)).resolves.toEqual(["wss://second.test/"]);
  });
});
