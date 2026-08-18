import type { NostrEvent } from "applesauce-core/helpers/event";
import { NostrIDB, openDB } from "nostr-idb";
import type { Subscription } from "rxjs";
import { PLATFORM_DATABASE_NAMES } from "@project/platform-nap-contract";
import { createNostrEngine, type EngineOptions, type NostrEngine } from "./engine.js";

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
    ingress: engine.ingress, relayPolicy: engine.relayPolicy, telemetry: engine.telemetry,
    async close() {
      if (closed) return; closed = true;
      for (const subscription of subscriptions) subscription.unsubscribe();
      await Promise.allSettled([...pending]); await cache.stop(); await engine.close();
    }
  };
}

export interface PersistentEngineOptions extends EngineOptions { readonly maximumCachedEvents?: number; readonly hydrateLimit?: number; readonly databaseName?: string }

export async function createPersistentNostrEngine(options: PersistentEngineOptions = {}): Promise<NostrEngine> {
  const engineOptions: EngineOptions = {
    ...(options.verifyEvent ? { verifyEvent: options.verifyEvent } : {}),
    ...(options.relayPolicy ? { relayPolicy: options.relayPolicy } : {}),
    ...(options.telemetry ? { telemetry: options.telemetry } : {})
  };
  const engine = createNostrEngine(engineOptions);
  const database = await openDB(options.databaseName ?? PUBLIC_EVENT_DATABASE_NAME);
  const cache = new NostrIDB<NostrEvent>(database, { maxEvents: options.maximumCachedEvents ?? 100_000 });
  const persistent = await attachEventCache(engine, cache, options.hydrateLimit ?? 10_000);
  let closed = false;
  return {
    ...persistent,
    async close() {
      if (closed) return;
      closed = true; await persistent.close(); database.close();
    }
  };
}
