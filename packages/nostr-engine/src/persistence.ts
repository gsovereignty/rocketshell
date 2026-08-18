import type { NostrEvent } from "applesauce-core/helpers/event";
import { NostrIDB } from "nostr-idb";
import type { Subscription } from "rxjs";
import { createNostrEngine, type EngineOptions, type NostrEngine } from "./engine.js";

export interface EventCache {
  start(): Promise<void>;
  stop(): Promise<void>;
  add(event: NostrEvent): Promise<boolean>;
  query(filters: object | object[]): Promise<NostrEvent[]>;
}

function plainEvent(event: NostrEvent): NostrEvent {
  return { id: event.id, pubkey: event.pubkey, created_at: event.created_at, kind: event.kind, tags: event.tags.map((tag) => [...tag]), content: event.content, sig: event.sig };
}

export async function attachEventCache(engine: NostrEngine, cache: EventCache, hydrateLimit = 10_000): Promise<NostrEngine> {
  await cache.start();
  for (const event of await cache.query([{ since: 0, limit: hydrateLimit }])) engine.ingress.admit(event, "cache:indexeddb");
  const pending = new Set<Promise<unknown>>();
  const subscriptions: Subscription[] = [];
  const persist = (event: NostrEvent): void => {
    const operation = cache.add(plainEvent(event)).finally(() => pending.delete(operation));
    pending.add(operation);
  };
  subscriptions.push(engine.eventStore.insert$.subscribe(persist), engine.eventStore.update$.subscribe(persist));
  let closed = false;
  return {
    relayPool: engine.relayPool, eventStore: engine.eventStore, accounts: engine.accounts,
    ingress: engine.ingress, relayPolicy: engine.relayPolicy,
    async close() {
      if (closed) return; closed = true;
      for (const subscription of subscriptions) subscription.unsubscribe();
      await Promise.allSettled([...pending]); await cache.stop(); await engine.close();
    }
  };
}

export interface PersistentEngineOptions extends EngineOptions { readonly maximumCachedEvents?: number; readonly hydrateLimit?: number }

export async function createPersistentNostrEngine(options: PersistentEngineOptions = {}): Promise<NostrEngine> {
  const engineOptions: EngineOptions = {
    ...(options.verifyEvent ? { verifyEvent: options.verifyEvent } : {}),
    ...(options.relayPolicy ? { relayPolicy: options.relayPolicy } : {})
  };
  const engine = createNostrEngine(engineOptions);
  const cache = new NostrIDB<NostrEvent>(undefined, { maxEvents: options.maximumCachedEvents ?? 100_000 });
  return attachEventCache(engine, cache, options.hydrateLimit ?? 10_000);
}
