import type { NostrEvent } from "applesauce-core/helpers/event";
import { NostrIDB, openDB } from "nostr-idb";
import type { Subscription } from "rxjs";
import { PLATFORM_DATABASE_NAMES } from "@project/platform-nap-contract";
import { createPersistentAccountManager, openIndexedDbAccountSnapshotStore } from "../account-persistence.js";
import { accountManager } from "./accounts.js";
import { eventStore } from "./event-store.js";
import { ingress } from "./ingress.js";

export interface EventCache {
  start(): Promise<void>;
  stop(): Promise<void>;
  add(event: NostrEvent): Promise<boolean>;
  query(filters: object | object[]): Promise<NostrEvent[]>;
}

export const PUBLIC_EVENT_DATABASE_NAME = PLATFORM_DATABASE_NAMES.publicEvents;

function plainEvent(event: NostrEvent): NostrEvent {
  return { id: event.id, pubkey: event.pubkey, created_at: event.created_at, kind: event.kind, tags: event.tags.map((tag) => [...tag]), content: event.content, sig: event.sig };
}

/**
 * Hydrates the shared store from a cache and writes every later insert back to it.
 * Returns the detach function; it settles outstanding writes before stopping the cache.
 */
export async function attachEventCache(cache: EventCache, hydrateLimit = 10_000): Promise<() => Promise<void>> {
  await cache.start();
  for (const event of await cache.query([{ since: 0, limit: hydrateLimit }])) ingress.admit(event, "cache:indexeddb");
  const pending = new Set<Promise<unknown>>();
  const persist = (event: NostrEvent): void => {
    const operation = cache.add(plainEvent(event)).finally(() => pending.delete(operation));
    pending.add(operation);
  };
  const subscriptions: Subscription[] = [eventStore.insert$.subscribe(persist), eventStore.update$.subscribe(persist)];
  let detached = false;
  return async () => {
    if (detached) return;
    detached = true;
    for (const subscription of subscriptions) subscription.unsubscribe();
    await Promise.allSettled([...pending]);
    await cache.stop();
  };
}

export interface NostrPersistenceOptions {
  readonly maximumCachedEvents?: number;
  readonly hydrateLimit?: number;
  readonly databaseName?: string;
}

export interface NostrPersistence { close(): Promise<void> }

/**
 * Backs the shared store and account manager with IndexedDB.
 *
 * Kept out of module scope on purpose: the services above are pure memory and stay importable in
 * Node, while this half needs a browser and must be started explicitly by the shell.
 */
export async function startNostrPersistence(options: NostrPersistenceOptions = {}): Promise<NostrPersistence> {
  const database = await openDB(options.databaseName ?? PUBLIC_EVENT_DATABASE_NAME);
  let accountStore: Awaited<ReturnType<typeof openIndexedDbAccountSnapshotStore>>;
  try { accountStore = await openIndexedDbAccountSnapshotStore(); }
  catch (error) { database.close(); throw error; }
  let persistentAccounts: Awaited<ReturnType<typeof createPersistentAccountManager>>;
  try { persistentAccounts = await createPersistentAccountManager(accountStore, accountManager); }
  catch (error) { accountStore.close(); database.close(); throw error; }
  const cache = new NostrIDB<NostrEvent>(database, { maxEvents: options.maximumCachedEvents ?? 100_000 });
  let detach: () => Promise<void>;
  try { detach = await attachEventCache(cache, options.hydrateLimit ?? 10_000); }
  catch (error) { await persistentAccounts.close(); database.close(); throw error; }
  let closed = false;
  return {
    async close() {
      if (closed) return;
      closed = true;
      try { await detach(); }
      finally {
        try { await persistentAccounts.close(); }
        finally { database.close(); }
      }
    }
  };
}
