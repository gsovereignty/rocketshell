import type { Runtime, ServiceHandler } from "@kehto/runtime";
import type { ShellBridge } from "@kehto/shell";
import { createIdentityService, createOutboxService, createRelayPoolOutboxRouter, createRelayPoolService } from "@kehto/services";
import type { NostrEvent as CoreNostrEvent } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import { DEFAULT_PUBLISH_TIMEOUT_MS, accounts, eventStore, ingress, openRelayStream, publisher, relayPolicy, relayPool, telemetry, validateFilters } from "@platform/nostr-engine";
import { verifyEvent } from "nostr-tools/pure";
import { createRelayConfiguration, type PlatformRelayConfiguration } from "./relay-configuration.js";
import { castUser } from "applesauce-common/casts";
import { createIdentityProviders } from "./identity-providers.js";
import type { IdentityProviders } from "./identity-providers.js";
import { limitServiceSubscriptions } from "./subscription-limit.js";

/** How long to wait for another user's NIP-65 list before routing without it. */
const RELAY_LIST_TIMEOUT_MS = 4_000;

export interface CoreServiceOptions { readonly discoveryRelays?: readonly string[]; readonly directReadRelays: readonly string[]; readonly directWriteRelays: readonly string[]; readonly relayConfiguration?: PlatformRelayConfiguration; readonly lookupRelays?: string[] }
export interface CoreServiceRegistration { readonly identity: IdentityProviders; close(): void }

export function createOutboxRelayPool(readRelays: readonly string[], writeRelays: readonly string[]) {
  return {
    subscribe(filters: Filter[], relayUrls: string[], callback: (item: CoreNostrEvent | "EOSE") => void) {
      const selected = relayPolicy.select(relayUrls, "read");
      const handle = openRelayStream(relayPool, ingress, selected, validateFilters(filters), { event: callback, eose: () => callback("EOSE") }, 15_000, telemetry);
      return { unsubscribe: () => handle.close() };
    },
    async publish(event: CoreNostrEvent, relayUrls: string[]) {
      if (!ingress.verify(event)) throw new Error("invalid-event");
      const selected = relayPolicy.select(relayUrls, "write");
      const outcomes = await relayPool.publish(selected, event, { retries: false, timeout: DEFAULT_PUBLISH_TIMEOUT_MS });
      for (const outcome of outcomes) telemetry.record("publication.outcome", outcome.ok ? 1 : 0, { relay: outcome.from });
      if (!outcomes.some((outcome) => outcome.ok)) telemetry.record("publication.failed", 1, { relayCount: selected.length });
      const accepted = outcomes.find((outcome) => outcome.ok);
      if (accepted) ingress.admit(event, accepted.from);
      return Object.fromEntries(outcomes.map((outcome) => [outcome.from, outcome.ok]));
    },
    isAvailable: () => readRelays.length > 0 || writeRelays.length > 0
  };
}

export function registerCoreServices(shell: Pick<ShellBridge, "runtime" | "publishIdentityChanged">, options: CoreServiceOptions): CoreServiceRegistration {
  const { runtime } = shell;
  const configuration = options.relayConfiguration ?? createRelayConfiguration(relayPolicy, {
    discovery: [...(options.discoveryRelays ?? [])], super: [...options.directReadRelays], outbox: [...options.directWriteRelays]
  });
  const readRelays = configuration.values("super");
  const writeRelays = configuration.values("outbox");
  const discoveryRelays = configuration.values("discovery");
  const relayService = limitServiceSubscriptions(createRelayPoolService({
    subscribe(filters, callback, relayUrls) {
      const selected = relayPolicy.select(relayUrls?.length ? relayUrls : readRelays, "read");
      const handle = openRelayStream(relayPool, ingress, selected, validateFilters(filters as Filter[]), {
        event: (event) => callback(event), eose: () => callback("EOSE")
      }, 15_000, telemetry);
      return { unsubscribe: () => handle.close() };
    },
    async publish(event) { await publisher.publishSigned(writeRelays, event as CoreNostrEvent); },
    selectRelayTier() { return [...readRelays]; },
    isAvailable() { return readRelays.length > 0 || writeRelays.length > 0; }
  }), { subscribe: "relay.subscribe", close: "relay.close", closed: "relay.closed" });
  runtime.registerService("relay", relayService);
  const identityProviders = createIdentityProviders(readRelays);
  runtime.registerService("identity", createIdentityService({
    getSigner: () => accounts.manager.active ? {
      getPublicKey: () => accounts.manager.signer.getPublicKey(),
      getRelays: () => identityProviders.getRelays(accounts.publicKey)
    } : null,
    getProfile: (pubkey) => identityProviders.getProfile(pubkey),
    getFollows: (pubkey) => identityProviders.getFollows(pubkey),
    getList: (type, pubkey) => identityProviders.getList(type, pubkey),
    getZaps: (pubkey) => identityProviders.getZaps(pubkey),
    getMutes: (pubkey) => identityProviders.getMutes(pubkey),
    getBlocked: (pubkey) => identityProviders.getBlocked(pubkey),
    getBadges: (pubkey) => identityProviders.getBadges(pubkey)
  }));
  const outboxPool = createOutboxRelayPool(readRelays, writeRelays);
  const outboxRouter = createRelayPoolOutboxRouter({
    relayPool: outboxPool,
    // Freshness, deduplication and the network fetch all live in the event store and its loader
    // now; this used to be a hand-rolled TTL cache with its own discovery query.
    loadRelayLists: async (pubkeys) => {
      const entries = await Promise.all([...new Set(pubkeys)].map(async (pubkey): Promise<[string, { read: string[]; write: string[] }]> => {
        const user = castUser(pubkey, eventStore);
        const [read, write] = await Promise.all([
          user.inboxes$.$first<string[]>(RELAY_LIST_TIMEOUT_MS, []),
          user.outboxes$.$first<string[]>(RELAY_LIST_TIMEOUT_MS, [])
        ]);
        return [pubkey, { read: [...read], write: [...write] }];
      }));
      return new Map(entries.filter(([, list]) => list.read.length > 0 || list.write.length > 0));
    },
    fallbackRelays: readRelays,
    signEvent: (template) => accounts.sign(template),
    verifyEvent: (event) => verifyEvent({ id: event.id, pubkey: event.pubkey, created_at: event.created_at, kind: event.kind, tags: event.tags.map((tag) => [...tag]), content: event.content, sig: event.sig }),
    isRelayAllowed: (url) => { try { relayPolicy.normalize(url, "explicit"); return true; } catch { return false; } },
    defaultTimeoutMs: 4_000
  });
  const outboxService = limitServiceSubscriptions(createOutboxService({ router: outboxRouter }), {
    subscribe: "outbox.subscribe", close: "outbox.close", closed: "outbox.closed"
  });
  runtime.registerService("outbox", outboxService);
  const accountSensitiveServices: ServiceHandler[] = [relayService, outboxService];
  let initialAccount = true; let closed = false;
  const accountChanges = accounts.manager.active$.subscribe(() => {
    if (initialAccount) { initialAccount = false; return; }
    for (const entry of runtime.sessionRegistry.getAllEntries()) {
      for (const service of accountSensitiveServices) service.onWindowDestroyed?.(entry.windowId);
    }
    shell.publishIdentityChanged(accounts.publicKey);
  });
  return { identity: identityProviders, close() {
    if (closed) return;
    closed = true; accountChanges.unsubscribe();
  } };
}
