import type { Runtime, ServiceHandler } from "@kehto/runtime";
import type { ShellBridge } from "@kehto/shell";
import { createIdentityService, createOutboxService, createRelayPoolOutboxRouter, createRelayPoolService } from "@kehto/services";
import type { NostrEvent as CoreNostrEvent } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import type { NostrEngine } from "@platform/nostr-engine";
import { createRelayListResolver, createRelayPublisher, openRelayStream } from "@platform/nostr-engine";
import { verifyEvent } from "nostr-tools/pure";

export interface CoreServiceOptions { readonly discoveryRelays?: readonly string[]; readonly directReadRelays: readonly string[]; readonly directWriteRelays: readonly string[] }
export interface CoreServiceRegistration { close(): void }

export function createOutboxRelayPool(engine: NostrEngine, readRelays: readonly string[], writeRelays: readonly string[]) {
  return {
    subscribe(filters: Filter[], relayUrls: string[], callback: (item: CoreNostrEvent | "EOSE") => void) {
      const selected = engine.relayPolicy.select(relayUrls, "read");
      const handle = openRelayStream(engine.relayPool, engine.ingress, selected, filters, { event: callback, eose: () => callback("EOSE") }, 15_000, engine.telemetry);
      return { unsubscribe: () => handle.close() };
    },
    async publish(event: CoreNostrEvent, relayUrls: string[]) {
      const selected = engine.relayPolicy.select(relayUrls, "write");
      const outcomes = await engine.relayPool.publish(selected, event, { retries: false });
      for (const outcome of outcomes) engine.telemetry.record("publication.outcome", outcome.ok ? 1 : 0, { relay: outcome.from });
      if (!outcomes.some((outcome) => outcome.ok)) engine.telemetry.record("publication.failed", 1, { relayCount: selected.length });
      return Object.fromEntries(outcomes.map((outcome) => [outcome.from, outcome.ok]));
    },
    isAvailable: () => readRelays.length > 0 || writeRelays.length > 0
  };
}

export function registerCoreServices(shell: Pick<ShellBridge, "runtime" | "publishIdentityChanged">, engine: NostrEngine, options: CoreServiceOptions): CoreServiceRegistration {
  const { runtime } = shell;
  const readRelays = engine.relayPolicy.select(options.directReadRelays, "read");
  const writeRelays = engine.relayPolicy.select(options.directWriteRelays, "write");
  const discoveryRelays = engine.relayPolicy.select(options.discoveryRelays ?? [], "discovery");
  const publisher = createRelayPublisher(engine.relayPool, engine.accounts, engine.ingress, 1, engine.telemetry);
  const relayService = createRelayPoolService({
    subscribe(filters, callback, relayUrls) {
      const selected = engine.relayPolicy.select(relayUrls?.length ? relayUrls : readRelays, "read");
      const handle = openRelayStream(engine.relayPool, engine.ingress, selected, filters as Filter[], {
        event: (event) => callback(event), eose: () => callback("EOSE")
      }, 15_000, engine.telemetry);
      return { unsubscribe: () => handle.close() };
    },
    async publish(event) { await publisher.publishSigned(writeRelays, event as CoreNostrEvent); },
    selectRelayTier() { return [...readRelays]; },
    isAvailable() { return readRelays.length > 0 || writeRelays.length > 0; }
  });
  runtime.registerService("relay", relayService);
  runtime.registerService("identity", createIdentityService({
    getSigner: () => engine.accounts.manager.active ? {
      getPublicKey: () => engine.accounts.manager.signer.getPublicKey(),
      getRelays: async () => Object.fromEntries([...new Set([...readRelays, ...writeRelays])].map((url) => [url, { read: readRelays.includes(url), write: writeRelays.includes(url) }]))
    } : null
  }));
  const relayLists = createRelayListResolver(engine.eventStore, engine.ingress, engine.relayPolicy, discoveryRelays, async (relays, authors) => {
    if (relays.length === 0 || authors.length === 0) return [];
    return new Promise((resolve) => {
      const events: CoreNostrEvent[] = [];
      let handle: { close(): void } | undefined;
      handle = openRelayStream(engine.relayPool, engine.ingress, relays, [{ kinds: [10002], authors: [...authors] }], {
        event: (event) => events.push(event), eose: () => { resolve(events); handle?.close(); }
      }, 15_000, engine.telemetry);
    });
  }, { telemetry: engine.telemetry });
  const outboxPool = createOutboxRelayPool(engine, readRelays, writeRelays);
  const outboxRouter = createRelayPoolOutboxRouter({
    relayPool: outboxPool,
    loadRelayLists: async (pubkeys) => {
      const resolved = await relayLists.resolve(pubkeys); const result = new Map<string, { read: string[]; write: string[] }>();
      for (const [pubkey, list] of resolved) if (list) result.set(pubkey, { read: [...list.read], write: [...list.write] });
      return result;
    },
    fallbackRelays: [...readRelays],
    signEvent: (template) => engine.accounts.sign(template),
    verifyEvent: (event) => verifyEvent({ id: event.id, pubkey: event.pubkey, created_at: event.created_at, kind: event.kind, tags: event.tags.map((tag) => [...tag]), content: event.content, sig: event.sig }),
    isRelayAllowed: (url) => { try { engine.relayPolicy.normalize(url, "explicit"); return true; } catch { return false; } },
    defaultTimeoutMs: 4_000
  });
  const outboxService = createOutboxService({ router: outboxRouter });
  runtime.registerService("outbox", outboxService);
  const accountSensitiveServices: ServiceHandler[] = [relayService, outboxService];
  let initialAccount = true; let closed = false;
  const accountChanges = engine.accounts.manager.active$.subscribe(() => {
    if (initialAccount) { initialAccount = false; return; }
    for (const entry of runtime.sessionRegistry.getAllEntries()) {
      for (const service of accountSensitiveServices) service.onWindowDestroyed?.(entry.windowId);
    }
    shell.publishIdentityChanged(engine.accounts.publicKey);
  });
  return { close() {
    if (closed) return;
    closed = true; accountChanges.unsubscribe();
  } };
}
